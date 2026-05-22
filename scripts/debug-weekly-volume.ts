/**
 * Diagnostic: dump everything that contributes to "This week" in the
 * weekly-volume strip. Mirrors the production query + kernel verbatim.
 *
 * Run:
 *   npm run debug:weekly-volume
 *
 * Read-only. No mutations.
 */

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import {
  endOfWeek,
  format,
  parseISO,
  startOfWeek,
  subWeeks,
} from "date-fns";

loadEnv({ path: ".env.local" });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "gsinacio94@gmail.com";

const WEEK_OPTS = { weekStartsOn: 1 as const };
const WEEKS_WINDOW = 8;

type Row = {
  id: string;
  session_id: string;
  exercise_id: string;
  set_number: number;
  set_type: string;
  weight: string | null;
  reps: number | null;
  completed_at: string | null;
  deleted_at: string | null;
  created_at: string;
  sessions: {
    id: string;
    name: string | null;
    started_at: string;
    ended_at: string | null;
    source: string | null;
  };
};

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve target user id.
  const { data: users, error: usersErr } = await admin.auth.admin.listUsers();
  if (usersErr) throw usersErr;
  const user = users.users.find((u) => u.email === ADMIN_EMAIL);
  if (!user) throw new Error(`No user with email ${ADMIN_EMAIL}`);
  console.log(`User: ${user.email} (${user.id})\n`);

  // Build "last 8 ISO weeks" exactly like the prod hook.
  const now = new Date();
  const weeks = [];
  for (let i = WEEKS_WINDOW - 1; i >= 0; i--) {
    const anchor = subWeeks(now, i);
    const start = startOfWeek(anchor, WEEK_OPTS);
    const end = endOfWeek(anchor, WEEK_OPTS);
    weeks.push({ key: format(start, "RRRR-'W'II"), start, end });
  }
  const sinceUtc = weeks[0]!.start.toISOString();

  console.log(`Local now: ${now.toString()}`);
  console.log(`sinceUtc:  ${sinceUtc}\n`);
  console.log("Visible weeks (Monday-Sunday local):");
  for (const w of weeks) {
    console.log(
      `  ${w.key}  ${format(w.start, "yyyy-MM-dd (EEE)")} → ${format(w.end, "yyyy-MM-dd (EEE)")}`,
    );
  }
  console.log();

  // Mirror the prod query at src/api/stats.ts:21-30 — but pull more columns
  // for diagnosis (id, session_id, exercise_id, set_number, created_at,
  // source).
  const { data, error } = await admin
    .from("sets")
    .select(
      "id, session_id, exercise_id, set_number, set_type, weight, reps, completed_at, deleted_at, created_at, sessions!inner(id, name, started_at, ended_at, source)",
    )
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .not("sessions.ended_at", "is", null)
    .neq("set_type", "warmup")
    .gte("completed_at", sinceUtc)
    .order("completed_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as unknown as Row[];
  console.log(`Rows returned by prod-equivalent query: ${rows.length}\n`);

  // Bucket exactly like computeStripModel.
  const weekKeyOf = (d: Date) =>
    format(startOfWeek(d, WEEK_OPTS), "RRRR-'W'II");
  const visibleKeys = new Set(weeks.map((w) => w.key));
  const totals = new Map<string, number>();
  const rowsByWeek = new Map<string, Row[]>();
  for (const w of weeks) {
    totals.set(w.key, 0);
    rowsByWeek.set(w.key, []);
  }

  let dropped = 0;
  let droppedOutside = 0;
  for (const row of rows) {
    if (!row.completed_at) {
      dropped++;
      continue;
    }
    const key = weekKeyOf(parseISO(row.completed_at));
    if (!visibleKeys.has(key)) {
      droppedOutside++;
      continue;
    }
    const w = row.weight ? parseFloat(row.weight) : 0;
    const r = row.reps ?? 0;
    if (Number.isFinite(w) && w > 0 && r > 0) {
      totals.set(key, (totals.get(key) ?? 0) + w * r);
      rowsByWeek.get(key)!.push(row);
    } else {
      dropped++;
    }
  }

  console.log("Per-week totals (matches strip bar heights):");
  for (const w of weeks) {
    const t = totals.get(w.key) ?? 0;
    const flag = w.key === weeks[weeks.length - 1]!.key ? "  ← THIS WEEK" : "";
    console.log(`  ${w.key}  ${format(w.start, "MMM dd")}  ${(t / 1000).toFixed(2).padStart(8)}k kg${flag}`);
  }
  console.log(
    `\nDropped (NULL completed_at or guard-failed): ${dropped}  | Outside 8wk window: ${droppedOutside}\n`,
  );

  // ─── Current week deep-dive ───
  const currentWeek = weeks[weeks.length - 1]!;
  const currentRows = rowsByWeek.get(currentWeek.key) ?? [];
  console.log(
    `\n=== CURRENT WEEK BREAKDOWN: ${currentWeek.key} (${format(currentWeek.start, "MMM dd")} - ${format(currentWeek.end, "MMM dd")}) ===\n`,
  );
  console.log(`Total contributing rows: ${currentRows.length}\n`);

  // Group by session.
  type SessionGroup = {
    name: string | null;
    started_at: string;
    ended_at: string | null;
    source: string | null;
    totalKg: number;
    rows: Row[];
  };
  const sessions = new Map<string, SessionGroup>();
  for (const r of currentRows) {
    const sid = r.sessions.id;
    if (!sessions.has(sid)) {
      sessions.set(sid, {
        name: r.sessions.name,
        started_at: r.sessions.started_at,
        ended_at: r.sessions.ended_at,
        source: r.sessions.source,
        totalKg: 0,
        rows: [],
      });
    }
    const g = sessions.get(sid)!;
    const w = parseFloat(r.weight!);
    const reps = r.reps!;
    g.totalKg += w * reps;
    g.rows.push(r);
  }

  for (const [sid, g] of sessions) {
    console.log(
      `Session: ${g.name ?? "(unnamed)"}  [${sid.slice(0, 8)}]  src=${g.source ?? "native"}`,
    );
    console.log(
      `  started: ${g.started_at}  ended: ${g.ended_at}  totalKg: ${g.totalKg.toFixed(1)} (${g.rows.length} sets)`,
    );
    // Per-exercise breakdown.
    const byExercise = new Map<string, { sets: Row[]; totalKg: number }>();
    for (const r of g.rows) {
      if (!byExercise.has(r.exercise_id)) {
        byExercise.set(r.exercise_id, { sets: [], totalKg: 0 });
      }
      const e = byExercise.get(r.exercise_id)!;
      e.sets.push(r);
      e.totalKg += parseFloat(r.weight!) * r.reps!;
    }
    // Get exercise names.
    const exIds = [...byExercise.keys()];
    const { data: exData } = await admin
      .from("exercises")
      .select("id, name")
      .in("id", exIds);
    const exNames = new Map((exData ?? []).map((x) => [x.id, x.name]));
    for (const [exId, e] of byExercise) {
      console.log(
        `    ${exNames.get(exId) ?? exId.slice(0, 8)}  (${e.sets.length} sets, ${e.totalKg.toFixed(1)} kg)`,
      );
      for (const r of e.sets.sort((a, b) => a.set_number - b.set_number)) {
        const w = parseFloat(r.weight!);
        const reps = r.reps!;
        console.log(
          `      #${r.set_number} ${r.set_type.padEnd(8)} ${w.toFixed(1).padStart(6)} kg × ${reps.toString().padStart(2)} reps = ${(w * reps).toFixed(1).padStart(7)} kg  (set ${r.id.slice(0, 8)})`,
        );
      }
    }
    console.log();
  }

  // ─── Sanity probes ───
  console.log("=== SANITY PROBES ===\n");

  // 1. Sets with absurdly high weight values?
  const heavy = rows.filter((r) => {
    const w = r.weight ? parseFloat(r.weight) : 0;
    return Number.isFinite(w) && w > 500; // > 500 kg per single set
  });
  console.log(`Sets with weight > 500 kg: ${heavy.length}`);
  for (const r of heavy.slice(0, 10)) {
    console.log(`  ${r.id.slice(0, 8)} w=${r.weight} reps=${r.reps} sess=${r.sessions.name}`);
  }

  // 2. Sets with absurdly high rep counts?
  const highRep = rows.filter((r) => (r.reps ?? 0) > 100);
  console.log(`\nSets with reps > 100: ${highRep.length}`);
  for (const r of highRep.slice(0, 10)) {
    console.log(`  ${r.id.slice(0, 8)} w=${r.weight} reps=${r.reps} sess=${r.sessions.name}`);
  }

  // 3. Source breakdown (native vs imported) — sourced from sessions.source.
  const bySource = new Map<string, number>();
  let bySrcKg = new Map<string, number>();
  for (const r of rows) {
    const s = r.sessions.source ?? "native";
    bySource.set(s, (bySource.get(s) ?? 0) + 1);
    const w = r.weight ? parseFloat(r.weight) : 0;
    const reps = r.reps ?? 0;
    if (Number.isFinite(w) && w > 0 && reps > 0) {
      bySrcKg.set(s, (bySrcKg.get(s) ?? 0) + w * reps);
    }
  }
  console.log("\nSource breakdown (across all 8 weeks):");
  for (const [s, count] of bySource) {
    console.log(`  ${s.padEnd(10)} ${count.toString().padStart(5)} sets   ${(bySrcKg.get(s) ?? 0).toFixed(0).padStart(8)} kg total`);
  }

  // 4. Possible duplicates (same session/exercise/set_number)?
  const seen = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.session_id}/${r.exercise_id}/${r.set_number}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(r);
  }
  const dups = [...seen.entries()].filter(([_, rs]) => rs.length > 1);
  console.log(`\nDuplicate (session_id, exercise_id, set_number) tuples: ${dups.length}`);
  for (const [key, rs] of dups.slice(0, 10)) {
    console.log(`  ${key}  count=${rs.length}`);
    for (const r of rs) {
      console.log(`    set ${r.id.slice(0, 8)}  w=${r.weight} reps=${r.reps} created=${r.created_at}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
