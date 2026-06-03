import type { WeeklyVolumeRow } from "~/api/stats";
import { bodyweightKgAsOf, effectiveWeightKg } from "~/utils/bodyweight";
import {
  isoWeekStart,
  isoWeeksBetween,
  parseISO,
  weekKeyOf,
  type IsoWeek,
} from "~/utils/dates";
import type { WeeklyBodyweightInput } from "~/utils/progress-page-math";

/**
 * Pure-math helpers for `<WeeklyVolumeStrip>`. Lives outside the component
 * file so unit tests can import the kernel without dragging in `expo-router`
 * (which the component pulls via `useRouter`).
 */

export type StripBucket = {
  key: string;
  label: string;
  totalKg: number;
  isCurrent: boolean;
  /** Monday of this week — used to build the drill-down URL segment. */
  start: Date;
};

export type StripModel = {
  buckets: StripBucket[];
  /** Lifetime max across ALL buckets — drives bar-height denominator. */
  maxKg: number;
  /** Last bucket's totalKg (current week). */
  currentWeekKg: number;
  /** Earliest Monday represented in `buckets`. */
  firstSessionMonday: Date;
};

/**
 * Builds contiguous ISO-week buckets from the user's first-ever set's Monday
 * to the current week's Monday (oldest → newest), zero-filled where the user
 * did nothing, applying the standard volume kernel (`parseFloat(weight) ×
 * reps`, guarded `> 0`; warmups already filtered server-side).
 *
 * Returns `null` when `data.length === 0` — preserves the "no data" branch
 * which renders nothing without wrapper chrome.
 *
 * `now` is injectable for deterministic tests; production calls pass the
 * default `new Date()`.
 */
export function computeStripModel(
  data: WeeklyVolumeRow[],
  now: Date = new Date(),
  bodyweight?: WeeklyBodyweightInput,
): StripModel | null {
  if (data.length === 0) return null;

  // Find earliest completed_at → that week's Monday is our left edge.
  let earliestMs = Infinity;
  for (const row of data) {
    const t = parseISO(row.completed_at).getTime();
    if (t < earliestMs) earliestMs = t;
  }
  if (!Number.isFinite(earliestMs)) return null;

  const firstSessionMonday = isoWeekStart(new Date(earliestMs));
  const currentMonday = isoWeekStart(now);
  const weeks: IsoWeek[] = isoWeeksBetween(firstSessionMonday, currentMonday);
  if (weeks.length === 0) return null;

  const totals = new Map<string, number>();
  for (const w of weeks) totals.set(w.key, 0);

  // Bodyweight resolver — memoised per session_id (F-2). When `bodyweight` is
  // omitted, `bwCache`-less path: effectiveWeightKg(eq, weight, null) reduces
  // to the pre-feature addedLoad for non-bodyweight rows (byte-for-byte).
  const bwCache = new Map<string, number | null>();
  const resolveBw = (sessionId: string, startedAt: string): number | null => {
    if (!bodyweight) return null;
    if (bwCache.has(sessionId)) return bwCache.get(sessionId)!;
    const v = bodyweightKgAsOf(
      bodyweight.measurements,
      parseISO(startedAt).getTime(),
    );
    bwCache.set(sessionId, v);
    return v;
  };

  for (const row of data) {
    const key = weekKeyOf(parseISO(row.completed_at));
    if (!totals.has(key)) continue; // older than firstSessionMonday — shouldn't happen
    const bw = resolveBw(row.session_id, row.sessions.started_at);
    const w = effectiveWeightKg(
      row.exercises?.equipment,
      row.weight,
      bw,
      row.exercises?.bodyweight_factor,
    );
    const r = row.reps ?? 0;
    if (w > 0 && r > 0) {
      totals.set(key, (totals.get(key) ?? 0) + w * r);
    }
  }

  const lastIdx = weeks.length - 1;
  const buckets: StripBucket[] = weeks.map((wk, idx) => ({
    key: wk.key,
    label: wk.label,
    totalKg: totals.get(wk.key) ?? 0,
    isCurrent: idx === lastIdx,
    start: wk.start,
  }));

  const maxKg = buckets.reduce((m, b) => (b.totalKg > m ? b.totalKg : m), 0);
  const currentWeekKg = buckets[lastIdx]?.totalKg ?? 0;

  return { buckets, maxKg, currentWeekKg, firstSessionMonday };
}
