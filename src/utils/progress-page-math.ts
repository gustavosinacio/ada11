import type { WeeklyVolumeRow } from "~/api/stats";
import type { ExerciseRow, MuscleGroup } from "~/db/types";
import { MUSCLE_GROUPS } from "~/db/types";
import { isoWeekStart, parseISO, weekKeyOf } from "~/utils/dates";
import { formatShortDate } from "~/utils/format-display-date";

/**
 * Pure math helpers for the Progress page. All inputs are plain data; no I/O,
 * no React. Mirrors the kernel used by `weekly-volume-strip.tsx` and
 * `volume-target.ts` so every "volume" number in the app comes from the same
 * arithmetic.
 *
 * Volume kernel: `parseFloat(weight) * reps`, guarded `w > 0 && r > 0`.
 * Warmups are assumed already filtered server-side.
 *
 * `WeeklyVolumeRow.completed_at` is non-null per BLK-3 (server filter +
 * runtime assert + TS narrow), so loops here do not need a defensive skip.
 */

// ---------------------------------------------------------------------------
// bucketLifetimeWeeklyVolumes
// ---------------------------------------------------------------------------

/**
 * Buckets `rows` into `weekKeyOf(parseISO(completed_at))`. Returns a
 * Map<weekKey, totalKg>. Insertion order is preserved (callers depend on this
 * for "oldest tied week wins" tie-breaking in `findBestWeek`).
 */
export function bucketLifetimeWeeklyVolumes(
  rows: WeeklyVolumeRow[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = weekKeyOf(parseISO(row.completed_at));
    const w = row.weight ? parseFloat(row.weight) : 0;
    const r = row.reps ?? 0;
    if (Number.isFinite(w) && w > 0 && r > 0) {
      totals.set(key, (totals.get(key) ?? 0) + w * r);
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------
// findBestWeek
// ---------------------------------------------------------------------------

export type BestWeek = {
  isoWeekKey: string;
  /** "M/d" of the local Monday of this week. */
  weekStartLabel: string;
  totalKg: number;
};

/**
 * Returns the (key, kg, label) of the highest-volume bucket. Returns `null`
 * for empty input OR all-zero buckets.
 *
 * TIE BEHAVIOUR: iterate buckets in insertion order using strict `>`.
 * Server-side `.order("completed_at", { ascending: true })` means insertion
 * order is oldest→newest, so the OLDEST tied week wins. See MIN-7.
 */
export function findBestWeek(buckets: Map<string, number>): BestWeek | null {
  let bestKey: string | null = null;
  let bestKg = 0;
  for (const [key, kg] of buckets) {
    if (kg > bestKg) {
      bestKey = key;
      bestKg = kg;
    }
  }
  if (bestKey === null || bestKg <= 0) return null;
  // Reconstruct the Monday label from the ISO-week key. The key is
  // `RRRR-'W'II`; we derive the Monday by parsing the key directly via
  // date-fns's ISO week tokens. Easier path: store buckets keyed by Monday
  // instead — but we already have the key string, so reconstruct.
  //
  // The cheap correct approach: re-derive Monday from the key. ISO week
  // 1 of any year starts the week containing Jan 4. We use a small helper
  // here rather than pulling in date-fns/parse with custom tokens (which
  // is brittle). Instead, callers reconstruct labels client-side from a
  // known Monday — but the design wants the label in the return value.
  //
  // Pragmatic approach: we accept that we can't perfectly invert without a
  // sample Date. The strip + Progress page already have access to Date
  // objects via `parseISO(row.completed_at)`. Here we fall back to using
  // the key as the label when we cannot derive a Monday — but the design's
  // expected label format is "M/d" of the local Monday. To deliver that,
  // we keep a second pass via `bucketLifetimeWeeklyVolumes` is impractical;
  // instead, callers should compose label themselves OR we accept the
  // limitation. To honour the design contract, we re-extract the Monday
  // from the key via a small reverse-lookup helper.
  const label = weekKeyToMondayLabel(bestKey);
  return { isoWeekKey: bestKey, weekStartLabel: label, totalKg: bestKg };
}

/**
 * Reverse `RRRR-'W'II` → "M/d" of the local Monday of that ISO week.
 *
 * We parse the components, walk to Jan 4 of the ISO week year (which is
 * always in ISO week 1), find that week's Monday, then shift by
 * `(weekNumber - 1) * 7` days. All math happens in local time so the label
 * matches every other ISO-week label in the app.
 */
function weekKeyToMondayLabel(key: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match) return key;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // Jan 4 is always in ISO week 1 (per ISO-8601). Get its local Monday.
  const jan4 = new Date(year, 0, 4);
  const week1Monday = isoWeekStart(jan4);
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  return formatShortDate(monday);
}

// ---------------------------------------------------------------------------
// computeCurrentWeekVolume
// ---------------------------------------------------------------------------

/**
 * Sums volume across all rows that fall in the ISO week containing `now`.
 * Same kernel as `bucketLifetimeWeeklyVolumes`.
 */
export function computeCurrentWeekVolume(
  rows: WeeklyVolumeRow[],
  now: Date,
): number {
  const targetKey = weekKeyOf(now);
  let total = 0;
  for (const row of rows) {
    if (weekKeyOf(parseISO(row.completed_at)) !== targetKey) continue;
    const w = row.weight ? parseFloat(row.weight) : 0;
    const r = row.reps ?? 0;
    if (Number.isFinite(w) && w > 0 && r > 0) {
      total += w * r;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// computeLifetimeMaxPerExercise
// ---------------------------------------------------------------------------

/**
 * Lifetime max single-session volume per exercise.
 *
 * Algorithm:
 *   1. Group rows by (exercise_id, session_id) and reduce each group to its
 *      total volume (sum of `w * r` with `w > 0 && r > 0` guard).
 *   2. Take the per-exercise max across that group's session volumes.
 *
 * Returns Map<exercise_id, maxKg>. Used by both `usePrsThisWeek` (for
 * priorMax comparisons) and `useExercisesThisWeek` (for the per-row Max
 * value).
 */
export function computeLifetimeMaxPerExercise(
  rows: WeeklyVolumeRow[],
): Map<string, number> {
  // Step 1: group → volume per (exerciseId, sessionId).
  const sessionVols = new Map<string, Map<string, number>>(); // exId → (sessId → vol)
  for (const row of rows) {
    const w = row.weight ? parseFloat(row.weight) : 0;
    const r = row.reps ?? 0;
    if (!(Number.isFinite(w) && w > 0 && r > 0)) continue;
    const inner = sessionVols.get(row.exercise_id) ?? new Map<string, number>();
    inner.set(row.session_id, (inner.get(row.session_id) ?? 0) + w * r);
    sessionVols.set(row.exercise_id, inner);
  }

  // Step 2: per-exercise max.
  const maxes = new Map<string, number>();
  for (const [exId, inner] of sessionVols) {
    let best = 0;
    for (const v of inner.values()) {
      if (v > best) best = v;
    }
    maxes.set(exId, best);
  }
  return maxes;
}

// ---------------------------------------------------------------------------
// computePrsThisWeek
// ---------------------------------------------------------------------------

/**
 * Per-exercise PR summary for the current ISO week. Returns one entry per
 * exercise that beat its prior lifetime best at least once during the
 * current week, with both the prior baseline and the best in-week volume.
 *
 * Disambiguation: `currentMaxKg` here is the MAX of in-week per-session
 * volumes for that exercise — NOT to be confused with `SessionPr.currentKg`
 * from `session-verdict-math.ts`, which is the volume of a single specific
 * session. They coincide when the user has only one in-week session for the
 * exercise; they diverge when there are multiple in-week sessions.
 *
 * Algorithm:
 *   1. Group rows by (exercise_id, session_id) and reduce each group to its
 *      session volume + session `started_at`.
 *   2. For each exercise, sort sessions ASC by `started_at`. Walk forward
 *      maintaining a running `priorMax` (starts at 0; updated after each
 *      session). Capture `priorMaxKg` as the running prior at the moment the
 *      FIRST in-week PR session is detected (== lifetime max strictly before
 *      the current ISO week, conditional on at least one PR in-week).
 *   3. Within the current week, track the MAX session volume for the
 *      exercise as `currentMaxKg`.
 *   4. Emit `{exerciseId, priorMaxKg, currentMaxKg, overflowKg}` when the
 *      exercise had ≥1 in-week PR session AND `currentMaxKg > priorMaxKg`.
 *   5. Sort: `overflowKg` DESC, `exerciseId` ASC (deterministic).
 */
export type PrThisWeek = {
  exerciseId: string;
  /** Lifetime max single-session volume BEFORE the current ISO week. */
  priorMaxKg: number;
  /** Max single-session volume DURING the current ISO week. */
  currentMaxKg: number;
  /** currentMaxKg - priorMaxKg, strictly > 0 by construction. */
  overflowKg: number;
};

export function computePrsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
}): PrThisWeek[] {
  const { rows, currentWeekStartIso, currentWeekEndIso } = opts;
  const weekStart = parseISO(currentWeekStartIso);
  const weekEnd = parseISO(currentWeekEndIso);

  // Step 1: build (exerciseId → sessionId → { volume, startedAt }).
  type SessionAgg = { volume: number; startedAt: string };
  const grouped = new Map<string, Map<string, SessionAgg>>();
  for (const row of rows) {
    const w = row.weight ? parseFloat(row.weight) : 0;
    const r = row.reps ?? 0;
    if (!(Number.isFinite(w) && w > 0 && r > 0)) continue;
    const inner =
      grouped.get(row.exercise_id) ?? new Map<string, SessionAgg>();
    const existing = inner.get(row.session_id);
    if (existing) {
      existing.volume += w * r;
    } else {
      inner.set(row.session_id, {
        volume: w * r,
        startedAt: row.sessions.started_at,
      });
    }
    grouped.set(row.exercise_id, inner);
  }

  // Step 2-4: per-exercise running priorMax + in-week max.
  const out: PrThisWeek[] = [];
  for (const [exId, sessions] of grouped) {
    const sorted = Array.from(sessions.values()).sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    );
    let priorMax = 0;
    let priorAtFirstWeekPr = 0;
    let hadInWeekPr = false;
    let currentMaxKg = 0;
    for (const s of sorted) {
      const t = parseISO(s.startedAt);
      const inWeek = t >= weekStart && t <= weekEnd;
      const isPr = priorMax > 0 && s.volume > priorMax;
      if (isPr && inWeek && !hadInWeekPr) {
        priorAtFirstWeekPr = priorMax;
        hadInWeekPr = true;
      }
      if (inWeek && s.volume > currentMaxKg) {
        currentMaxKg = s.volume;
      }
      if (s.volume > priorMax) priorMax = s.volume;
    }
    if (hadInWeekPr && currentMaxKg > priorAtFirstWeekPr) {
      out.push({
        exerciseId: exId,
        priorMaxKg: priorAtFirstWeekPr,
        currentMaxKg,
        overflowKg: currentMaxKg - priorAtFirstWeekPr,
      });
    }
  }

  // Step 5: sort overflowKg DESC, then exerciseId ASC.
  out.sort((a, b) => {
    if (b.overflowKg !== a.overflowKg) return b.overflowKg - a.overflowKg;
    return a.exerciseId.localeCompare(b.exerciseId);
  });
  return out;
}

// ---------------------------------------------------------------------------
// computePrExerciseIdsThisWeek
// ---------------------------------------------------------------------------

/**
 * Returns the set of exercise_ids that hit a strict-PR session during the
 * current ISO week. Thin wrapper around `computePrsThisWeek`.
 *
 * Semantics (carried by the wrapped kernel):
 *   - A session "is a PR" iff `volume > priorMax` AND `priorMax > 0`.
 *     The first-ever session is NOT a PR (matches `volume-target.ts:124-126`).
 *   - An exercise is in the returned set iff it has ≥1 PR session whose
 *     `started_at` falls in [currentWeekStartIso, currentWeekEndIso].
 */
export function computePrExerciseIdsThisWeek(opts: {
  rows: WeeklyVolumeRow[];
  currentWeekStartIso: string;
  currentWeekEndIso: string;
}): Set<string> {
  return new Set(computePrsThisWeek(opts).map((p) => p.exerciseId));
}

// ---------------------------------------------------------------------------
// groupExercisesByPrimaryMuscle
// ---------------------------------------------------------------------------

/**
 * Groups `exercises` by `muscles[0]`. Exercises with empty `muscles` or with
 * a primary muscle outside `MUSCLE_GROUPS` go to the `"Other"` bucket.
 *
 * Insertion order matches `MUSCLE_GROUPS` then `"Other"`. Empty groups are
 * omitted from the returned Map.
 */
export function groupExercisesByPrimaryMuscle(
  exercises: ExerciseRow[],
): Map<MuscleGroup | "Other", ExerciseRow[]> {
  const groups = new Map<MuscleGroup | "Other", ExerciseRow[]>();
  // Initialise in canonical order. We strip empty groups before returning.
  for (const g of MUSCLE_GROUPS) groups.set(g, []);
  groups.set("Other", []);

  const validSet = new Set<string>(MUSCLE_GROUPS);
  for (const ex of exercises) {
    const muscles = ex.muscles ?? [];
    const primary = muscles[0];
    const group: MuscleGroup | "Other" =
      primary && validSet.has(primary) ? (primary as MuscleGroup) : "Other";
    groups.get(group)!.push(ex);
  }

  // Drop empty groups.
  for (const [k, v] of Array.from(groups)) {
    if (v.length === 0) groups.delete(k);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// computeStreaks
// ---------------------------------------------------------------------------

/**
 * Current + best consecutive-ISO-week streaks.
 *
 * Definitions:
 *   - Trained week = ISO week with ≥1 entry in `startedAts`.
 *   - Current streak: if the current ISO week is trained, count consecutive
 *     trained weeks ending at it. Soft-fallback: if the current week is
 *     empty AND last week qualified, `current` = the streak ending at last
 *     week (so a Tuesday-morning glance still shows the prior run).
 *   - Best streak: longest such run across full history.
 *
 * Multiple sessions in the same ISO week count once for streak purposes.
 */
export function computeStreaks(
  startedAts: { started_at: string }[],
  now: Date,
): { current: number; best: number } {
  if (startedAts.length === 0) return { current: 0, best: 0 };

  // Collect the unique set of trained ISO-week keys.
  const trained = new Set<string>();
  for (const s of startedAts) {
    trained.add(weekKeyOf(parseISO(s.started_at)));
  }
  if (trained.size === 0) return { current: 0, best: 0 };

  // Helper: convert a Date in any ISO week → numeric "week index" so we can
  // step backwards by one week. Anchor the index at this-week's Monday so
  // 0 = current week, -1 = last week, etc.
  const thisMonday = isoWeekStart(now);

  function keyForOffset(weeksBack: number): string {
    const d = new Date(thisMonday);
    d.setDate(thisMonday.getDate() - weeksBack * 7);
    return weekKeyOf(d);
  }

  // Compute best streak by scanning offsets from now backwards until we've
  // exhausted all trained weeks (bounded by 52 * 100 = ~5000 to avoid
  // pathological loops on bad data).
  const SAFETY = 52 * 100;
  // Build an ordered list of trained-week offsets so we can find the
  // earliest trained week and bound the scan tightly.
  let earliestOffset = 0;
  for (let i = 0; i < SAFETY; i++) {
    if (trained.has(keyForOffset(i))) earliestOffset = i;
  }
  // Walk from `earliestOffset` down to 0 (oldest → newest) computing runs.
  let best = 0;
  let run = 0;
  for (let i = earliestOffset; i >= 0; i--) {
    if (trained.has(keyForOffset(i))) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }

  // Current streak.
  let current = 0;
  if (trained.has(keyForOffset(0))) {
    // Count back from this week.
    for (let i = 0; i < SAFETY; i++) {
      if (trained.has(keyForOffset(i))) current += 1;
      else break;
    }
  } else if (trained.has(keyForOffset(1))) {
    // Soft-fallback: current week empty but last week qualified.
    for (let i = 1; i < SAFETY; i++) {
      if (trained.has(keyForOffset(i))) current += 1;
      else break;
    }
  }

  return { current, best };
}
