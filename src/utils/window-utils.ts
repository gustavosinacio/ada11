import { subWeeks } from "date-fns";

import type { MaxVolumeWindowWeeks } from "~/db/types";
import { isoWeekStart, parseISO } from "~/utils/dates";

/**
 * Computes the numeric millisecond threshold marking the start of the user's
 * configured "max-volume window".
 *
 * Returns `undefined` when `weeks === 0` (lifetime mode), which the windowed
 * kernels treat as "no filter, keep every row". For `weeks > 0` the threshold
 * is the UTC instant corresponding to the local Monday 00:00 of the ISO week
 * that lies `weeks` weeks before the current ISO week:
 *
 *   1. `isoWeekStart(now)`         → Monday 00:00 local of the current week.
 *   2. `subWeeks(monday, weeks)`    → Monday 00:00 local of the (now − N) week.
 *   3. `.toISOString()`             → UTC instant of that Monday.
 *   4. `parseISO(...).getTime()`    → numeric milliseconds since epoch.
 *
 * Why two steps (`toISOString` then `parseISO`): the resulting number is the
 * same UTC instant that `parseISO(row.sessions.started_at).getTime()` produces
 * for every row read from PostgREST — so kernels can do a single
 * `parseISO(...).getTime() >= windowStartMs` numeric compare. Avoids the
 * ISO-string lex-compare boundary error (`+00:00` vs `Z` offsets) flagged as
 * BLK-2 in design-v2.
 *
 * Boundary is INCLUSIVE on the lower end (`>=`): a session whose `started_at`
 * equals the threshold instant counts as in-window. Mirrors `src/api/stats.ts`'s
 * `.gte("completed_at", opts.sinceUtc)` precedent.
 *
 * Example — for `weeks = 10` and `now = 2026-05-23` (Saturday in 2026-W21):
 *   Monday of 2026-W21 = 2026-05-18 local
 *   Subtract 10 weeks → Monday 2026-03-09 local (2026-W11)
 *   The window competes for "Max" across weeks W11..W20 (the prior 10 weeks);
 *   the current week W21 sits OUTSIDE the threshold by design (its sessions
 *   populate "Now", not "Max").
 *
 * Confidence: HIGH. The helper is the single source of truth for windowing;
 * every consumer routes through `computeWindowStart(weeks, new Date())`.
 */
export function computeWindowStart(
  weeks: MaxVolumeWindowWeeks,
  now: Date,
): number | undefined {
  if (weeks === 0) return undefined;
  const currentMonday = isoWeekStart(now);
  const windowStartLocal = subWeeks(currentMonday, weeks);
  return parseISO(windowStartLocal.toISOString()).getTime();
}
