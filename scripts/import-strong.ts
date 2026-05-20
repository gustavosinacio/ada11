/**
 * Strong CSV importer for ada11.
 *
 * Two-pass flow:
 *
 *   1) Analyze the CSV against the user's existing exercise library:
 *      npx tsx scripts/import-strong.ts analyze <csv-path>
 *      → emits <csv-dir>/strong-mapping.csv with one row per unique Strong
 *        exercise name and a suggested action (map / create-new) based on
 *        a token-overlap fuzzy match. Review and edit this file.
 *
 *   2) Import using the (reviewed) mapping:
 *      npx tsx scripts/import-strong.ts import <csv-path> <mapping-path> [--dry-run]
 *      → groups CSV rows into sessions, dedups against existing sessions
 *        using count-based recovery (MAJ-1: partial sessions are deleted
 *        and reinserted atomically — sets cascade), skips sessions with
 *        zero retained sets after mapping (MAJ-2), and bulk-inserts in
 *        batches.
 *
 * Conventions:
 *   - Dates in the Strong export are naïve datetimes; we interpret them as
 *     BRT (America/São_Paulo) and convert to UTC for storage.
 *   - Cardio rows (Distância > 0 or Segundos > 0) are dropped.
 *   - Pathological durations (e.g. "143h 49min") are clamped to MAX_DURATION_SEC.
 *   - Inserted rows are flagged with source = 'strong' so the UI can later
 *     distinguish imported from native data.
 *
 * Required env:
 *   EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ADMIN_EMAIL  (resolves to the target user_id via auth.admin.listUsers)
 *
 * Run example:
 *   set -a && . ./.env.local && set +a && \
 *     npm run import:strong -- analyze \
 *     "$HOME/.../strong_workouts_may_2026.csv"
 */

import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";
import { config as loadEnv } from "dotenv";
import Papa from "papaparse";

// Auto-load .env.local from the repo root. `npm run` sets cwd to the repo
// root, so this works without the user having to `set -a && . ./.env.local`
// first. Other scripts (e.g. scripts/create-user.ts) still expect explicit
// env sourcing per their docs — they can adopt this pattern later.
loadEnv({ path: ".env.local" });

// =============================================================================
// Constants
// =============================================================================

const TZ = "America/Sao_Paulo";
const MAX_DURATION_SEC = 6 * 60 * 60;
const FUZZY_LOW = 0.5; // < this → suggest create-new
const BATCH_SIZE = 500;
const SOURCE_KEY = "strong";

// Strong's Portuguese CSV headers. Update here if Strong ever exports
// English headers (would require an --lang flag, currently out of scope).
const H = {
  date: "Data",
  workoutName: "Nome do treino",
  duration: "Duração",
  exerciseName: "Nome do exercício",
  setOrder: "Ordem da série",
  weight: "Peso",
  reps: "Reps",
  distance: "Distância",
  seconds: "Segundos",
  notes: "Notas",
  workoutNotes: "Notas do treino",
  rpe: "RPE",
} as const;

// =============================================================================
// Types
// =============================================================================

type StrongRow = Record<string, string>;

type MappingAction = "map" | "create-new" | "drop";

type MappingEntry = {
  strong_name: string;
  action: MappingAction;
  ada11_exercise_id: string;
  ada11_exercise_name: string;
  fuzzy_score: string;
};

type ExerciseSummary = { id: string; name: string };

type SessionGroup = {
  started_at: string; // ISO UTC
  ended_at: string | null;
  name: string;
  notes: string | null;
  sets: {
    exercise_id: string;
    set_number: number;
    reps: number | null;
    weight: string | null;
    rpe: string | null;
    notes: string | null;
    completed_at: string;
  }[];
};

type Args = {
  command: "analyze" | "import" | undefined;
  csvPath?: string;
  mappingPath?: string;
  dryRun: boolean;
};

// =============================================================================
// Args + env
// =============================================================================

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const [command, csvPath, mappingPath] = positional;
  return {
    command: (command === "analyze" || command === "import"
      ? command
      : undefined) as Args["command"],
    csvPath,
    mappingPath,
    dryRun: flags.has("--dry-run"),
  };
}

function getSupabase() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      "Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env",
    );
  }
  return createClient(url, serviceRole, {
    auth: { persistSession: false },
  });
}

async function resolveUserId(): Promise<string> {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    throw new Error(
      "ADMIN_EMAIL is required to identify the import target user.\n" +
        "  Add to .env.local:  ADMIN_EMAIL=your-account@example.com\n" +
        "  Or pass inline:     ADMIN_EMAIL=your-account@example.com npm run import:strong -- ...",
    );
  }
  const supabase = getSupabase();
  // listUsers() returns up to 50 users by default; for a personal account
  // that's plenty. If the org has more, paginate.
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  const found = data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!found) {
    throw new Error(`User ${email} not found in Supabase auth`);
  }
  return found.id;
}

// =============================================================================
// CSV parse + helpers
// =============================================================================

function parseCsv(p: string): StrongRow[] {
  const text = fs.readFileSync(p, "utf8");
  const parsed = Papa.parse<StrongRow>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  if (parsed.errors.length > 0) {
    console.warn(
      `CSV parse warnings: ${parsed.errors.length}; first: ${JSON.stringify(
        parsed.errors[0],
      )}`,
    );
  }
  return parsed.data;
}

function uniqueExerciseNames(rows: StrongRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const name = r[H.exerciseName]?.trim();
    if (name) set.add(name);
  }
  return [...set].sort();
}

function normalizeTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[()\[\]]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni === 0 ? 0 : inter / uni;
}

function fuzzyScore(strong: string, ada11: string): number {
  return jaccard(normalizeTokens(strong), normalizeTokens(ada11));
}

function parseStrongDateToUtc(s: string): Date {
  // "2019-11-08 06:39:19" → Date object in UTC; the input is interpreted as TZ.
  const iso = s.replace(" ", "T");
  return fromZonedTime(iso, TZ);
}

function parseDurationSec(s: string): number {
  // Handles "10min", "1h", "1h 23min", "1h 23s", "1h 23min 4s".
  // Pathological values (e.g. "143h 49min" from a workout the user never
  // finished) are clamped to MAX_DURATION_SEC.
  const re = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?\s*(?:(\d+)\s*s)?/i;
  const m = s.trim().match(re);
  if (!m) return 0;
  const h = parseInt(m[1] ?? "0", 10);
  const mm = parseInt(m[2] ?? "0", 10);
  const ss = parseInt(m[3] ?? "0", 10);
  const total = h * 3600 + mm * 60 + ss;
  return Math.min(total, MAX_DURATION_SEC);
}

function isCardioRow(r: StrongRow): boolean {
  const dist = parseFloat(r[H.distance] ?? "0");
  const secs = parseFloat(r[H.seconds] ?? "0");
  return (Number.isFinite(dist) && dist > 0) ||
    (Number.isFinite(secs) && secs > 0);
}

async function fetchExercises(
  supabase: ReturnType<typeof getSupabase>,
  userId: string,
): Promise<ExerciseSummary[]> {
  const { data, error } = await supabase
    .from("exercises")
    .select("id,name")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as ExerciseSummary[];
}

function writeMappingCsv(p: string, entries: MappingEntry[]) {
  const csv = Papa.unparse({
    fields: [
      "strong_name",
      "action",
      "ada11_exercise_id",
      "ada11_exercise_name",
      "fuzzy_score",
    ],
    data: entries.map((e) => [
      e.strong_name,
      e.action,
      e.ada11_exercise_id,
      e.ada11_exercise_name,
      e.fuzzy_score,
    ]),
  });
  fs.writeFileSync(p, csv);
}

function parseMappingCsv(p: string): Map<string, MappingEntry> {
  const text = fs.readFileSync(p, "utf8");
  const parsed = Papa.parse<MappingEntry>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const map = new Map<string, MappingEntry>();
  for (const m of parsed.data) {
    if (m.strong_name) {
      // Coerce action to allowed values; default to 'create-new' if unknown.
      if (
        m.action !== "map" &&
        m.action !== "create-new" &&
        m.action !== "drop"
      ) {
        console.warn(
          `Mapping row '${m.strong_name}' has unknown action '${m.action}'; defaulting to 'create-new'`,
        );
        m.action = "create-new";
      }
      map.set(m.strong_name, m);
    }
  }
  return map;
}

// =============================================================================
// Commands
// =============================================================================

async function analyzeCommand(csvPath: string) {
  const supabase = getSupabase();
  const userId = await resolveUserId();
  const rows = parseCsv(csvPath);
  const exNames = uniqueExerciseNames(rows);
  const existing = await fetchExercises(supabase, userId);

  const mapping: MappingEntry[] = exNames.map((strongName) => {
    const candidates = existing
      .map((e) => ({ ...e, score: fuzzyScore(strongName, e.name) }))
      .sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const score = best?.score ?? 0;
    const action: MappingAction = score >= FUZZY_LOW ? "map" : "create-new";
    return {
      strong_name: strongName,
      action,
      ada11_exercise_id: action === "map" && best ? best.id : "",
      ada11_exercise_name: action === "map" && best ? best.name : "",
      fuzzy_score: score.toFixed(2),
    };
  });

  const mappingPath = path.join(path.dirname(csvPath), "strong-mapping.csv");
  writeMappingCsv(mappingPath, mapping);

  console.log(`\nAnalyzed ${rows.length} CSV rows.`);
  console.log(`Found ${exNames.length} unique Strong exercise names.`);
  console.log(`Existing ada11 exercises: ${existing.length}.`);
  const counts: Record<MappingAction, number> = {
    map: 0,
    "create-new": 0,
    drop: 0,
  };
  for (const m of mapping) counts[m.action]++;
  console.log(`Mapping suggestions:`);
  console.log(`  map (≥ ${FUZZY_LOW} fuzzy): ${counts.map}`);
  console.log(`  create-new (< ${FUZZY_LOW} fuzzy): ${counts["create-new"]}`);
  console.log(`\nWrote ${mappingPath}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open ${mappingPath} in your editor.`);
  console.log(`  2. Review each row. The 'action' column accepts:`);
  console.log(`     'map'        — use the matched ada11_exercise_id`);
  console.log(
    `     'create-new' — create a new ada11 exercise with name = strong_name`,
  );
  console.log(
    `     'drop'       — skip every CSV row referencing this exercise`,
  );
  console.log(
    `  3. Run: npm run import:strong -- import "${csvPath}" "${mappingPath}"`,
  );
}

async function importCommand(
  csvPath: string,
  mappingPath: string,
  dryRun: boolean,
) {
  const supabase = getSupabase();
  const userId = await resolveUserId();

  const allRows = parseCsv(csvPath);
  const beforeCardio = allRows.length;
  const rows = allRows.filter((r) => !isCardioRow(r));
  console.log(
    `Parsed ${beforeCardio} rows; dropped ${
      beforeCardio - rows.length
    } cardio rows; ${rows.length} remaining.`,
  );

  const mapping = parseMappingCsv(mappingPath);

  // Phase 1: create-new exercises
  const toCreate = [...mapping.values()]
    .filter((m) => m.action === "create-new")
    .map((m) => ({
      user_id: userId,
      name: m.strong_name,
      muscles: [],
      source: SOURCE_KEY,
    }));

  if (toCreate.length > 0) {
    if (dryRun) {
      console.log(`[dry-run] would create ${toCreate.length} exercises`);
    } else {
      console.log(`Creating ${toCreate.length} new exercises...`);
      const { data: created, error } = await supabase
        .from("exercises")
        .insert(toCreate)
        .select("id,name");
      if (error) throw error;
      for (const e of (created ?? []) as ExerciseSummary[]) {
        const m = mapping.get(e.name);
        if (m) {
          m.action = "map";
          m.ada11_exercise_id = e.id;
          m.ada11_exercise_name = e.name;
        }
      }
    }
  }

  // Phase 2: build session groups
  const groups = new Map<string, SessionGroup>();

  for (const r of rows) {
    const strongDate = r[H.date]?.trim();
    const workoutName = r[H.workoutName]?.trim();
    if (!strongDate || !workoutName) continue;

    const strongExerciseName = r[H.exerciseName]?.trim();
    if (!strongExerciseName) continue;
    const m = mapping.get(strongExerciseName);
    if (!m) continue;
    if (m.action === "drop") continue;
    if (m.action === "create-new" && dryRun) continue; // no id yet in dry-run
    if (!m.ada11_exercise_id) continue;

    const startedAt = parseStrongDateToUtc(strongDate).toISOString();
    const durationSec = parseDurationSec(r[H.duration] ?? "");
    const endedAt =
      durationSec > 0
        ? new Date(
            new Date(startedAt).getTime() + durationSec * 1000,
          ).toISOString()
        : null;

    const key = `${startedAt}|${workoutName}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        started_at: startedAt,
        ended_at: endedAt,
        name: workoutName,
        notes: r[H.workoutNotes]?.trim() || null,
        sets: [],
      };
      groups.set(key, group);
    }

    const setNumberRaw = parseInt(r[H.setOrder] ?? "1", 10);
    const setNumber = Number.isFinite(setNumberRaw) ? setNumberRaw : 1;

    const weightStr = r[H.weight]?.trim() ?? "";
    const weightNum = parseFloat(weightStr);
    const weight =
      Number.isFinite(weightNum) && weightNum > 0
        ? weightNum.toFixed(2)
        : null;

    const repsStr = r[H.reps]?.trim() ?? "";
    const repsNum = parseFloat(repsStr);
    const reps =
      Number.isFinite(repsNum) && repsNum > 0 ? Math.round(repsNum) : null;

    const rpeStr = r[H.rpe]?.trim() ?? "";
    const rpeNum = parseFloat(rpeStr);
    const rpe = Number.isFinite(rpeNum) && rpeNum > 0 ? rpeNum.toFixed(1) : null;

    group.sets.push({
      exercise_id: m.ada11_exercise_id,
      set_number: setNumber,
      reps,
      weight,
      rpe,
      notes: r[H.notes]?.trim() || null,
      completed_at: startedAt,
    });
  }

  // MAJ-2: drop sessions whose retained-set count is zero.
  const beforeFilter = groups.size;
  for (const [k, g] of groups) {
    if (g.sets.length === 0) groups.delete(k);
  }
  const afterFilter = groups.size;
  console.log(
    `Built ${beforeFilter} session candidates; ${
      beforeFilter - afterFilter
    } skipped (zero retained sets); ${afterFilter} remain.`,
  );

  // Phase 3: fetch existing sessions for dedup + count-based recovery (MAJ-1)
  const { data: existingSessions, error: existErr } = await supabase
    .from("sessions")
    .select("id,started_at,name")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (existErr) throw existErr;

  const existingMap = new Map<string, string>();
  for (const s of existingSessions ?? []) {
    existingMap.set(`${s.started_at}|${s.name ?? ""}`, s.id);
  }

  const setCountByExisting = new Map<string, number>();
  const existingIds = [...existingMap.values()];
  // Supabase's PostgREST .in() handles up to a few thousand IDs comfortably,
  // but we slice defensively for safety.
  for (let i = 0; i < existingIds.length; i += 1000) {
    const slice = existingIds.slice(i, i + 1000);
    if (slice.length === 0) break;
    const { data: setRows, error: scErr } = await supabase
      .from("sets")
      .select("session_id")
      .in("session_id", slice)
      .is("deleted_at", null);
    if (scErr) throw scErr;
    for (const row of setRows ?? []) {
      const sid = (row as { session_id: string }).session_id;
      setCountByExisting.set(sid, (setCountByExisting.get(sid) ?? 0) + 1);
    }
  }

  const toInsert: SessionGroup[] = [];
  const toReinsert: { existing_id: string; group: SessionGroup }[] = [];
  let skipped = 0;
  for (const [key, group] of groups) {
    const existingId = existingMap.get(key);
    if (!existingId) {
      toInsert.push(group);
      continue;
    }
    const existingCount = setCountByExisting.get(existingId) ?? 0;
    if (existingCount === group.sets.length) {
      skipped++;
    } else {
      toReinsert.push({ existing_id: existingId, group });
    }
  }

  console.log(
    `\nDedup: ${toInsert.length} new sessions, ${toReinsert.length} partial sessions (will delete and reinsert), ${skipped} already complete (skipped).`,
  );

  if (dryRun) {
    const totalSets = [...toInsert, ...toReinsert.map((r) => r.group)].reduce(
      (acc, g) => acc + g.sets.length,
      0,
    );
    console.log(
      `[dry-run] would insert ~${totalSets} sets across ${
        toInsert.length + toReinsert.length
      } sessions.`,
    );
    return;
  }

  // Phase 4: delete partial sessions (sets cascade via FK onDelete='cascade')
  if (toReinsert.length > 0) {
    const ids = toReinsert.map((r) => r.existing_id);
    const { error: delErr } = await supabase
      .from("sessions")
      .delete()
      .in("id", ids);
    if (delErr) throw delErr;
    console.log(
      `Deleted ${ids.length} partial sessions (sets cascaded).`,
    );
  }

  // Phase 5: insert sessions in batches
  const allToInsert = [...toInsert, ...toReinsert.map((r) => r.group)];
  const sessionInserts = allToInsert.map((g) => ({
    user_id: userId,
    name: g.name,
    started_at: g.started_at,
    ended_at: g.ended_at,
    notes: g.notes,
    source: SOURCE_KEY,
  }));

  type InsertedSession = { id: string; started_at: string; name: string | null };
  const insertedSessions: InsertedSession[] = [];
  for (let i = 0; i < sessionInserts.length; i += BATCH_SIZE) {
    const slice = sessionInserts.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("sessions")
      .insert(slice)
      .select("id,started_at,name");
    if (error) throw error;
    insertedSessions.push(...((data ?? []) as InsertedSession[]));
    console.log(
      `Inserted sessions ${i + slice.length} / ${sessionInserts.length}`,
    );
  }

  // Phase 6: insert sets, keyed off inserted session id
  const sessionIdByKey = new Map<string, string>();
  for (const s of insertedSessions) {
    sessionIdByKey.set(`${s.started_at}|${s.name ?? ""}`, s.id);
  }

  type SetInsert = {
    user_id: string;
    session_id: string;
    exercise_id: string;
    set_number: number;
    reps: number | null;
    weight: string | null;
    rpe: string | null;
    set_type: "working";
    parent_set_id: null;
    notes: string | null;
    completed_at: string;
  };

  const allSets: SetInsert[] = [];
  for (const g of allToInsert) {
    const key = `${g.started_at}|${g.name}`;
    const sessionId = sessionIdByKey.get(key);
    if (!sessionId) {
      console.warn(
        `Could not find inserted session id for ${key}; skipping its sets`,
      );
      continue;
    }
    for (const s of g.sets) {
      allSets.push({
        user_id: userId,
        session_id: sessionId,
        exercise_id: s.exercise_id,
        set_number: s.set_number,
        reps: s.reps,
        weight: s.weight,
        rpe: s.rpe,
        set_type: "working",
        parent_set_id: null,
        notes: s.notes,
        completed_at: s.completed_at,
      });
    }
  }

  for (let i = 0; i < allSets.length; i += BATCH_SIZE) {
    const slice = allSets.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("sets").insert(slice);
    if (error) throw error;
    console.log(`Inserted sets ${i + slice.length} / ${allSets.length}`);
  }

  console.log(
    `\nDone. Imported ${allToInsert.length} sessions and ${allSets.length} sets.`,
  );
}

// =============================================================================
// Entrypoint
// =============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || !args.csvPath) {
    console.error("Usage:");
    console.error(
      "  npm run import:strong -- analyze <csv-path>",
    );
    console.error(
      "  npm run import:strong -- import <csv-path> <mapping-path> [--dry-run]",
    );
    process.exit(1);
  }
  if (args.command === "analyze") {
    await analyzeCommand(args.csvPath);
  } else if (args.command === "import") {
    if (!args.mappingPath) {
      console.error(
        "import requires a mapping CSV path. Run `analyze` first.",
      );
      process.exit(1);
    }
    await importCommand(args.csvPath, args.mappingPath, args.dryRun);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
