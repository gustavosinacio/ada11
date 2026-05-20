import {
  endOfWeek,
  format,
  parseISO,
  startOfWeek,
  subWeeks,
} from "date-fns";

/**
 * ISO-week bucketing helpers (Monday-Sunday, device-local).
 *
 * All getters operate on local time (`startOfWeek`/`endOfWeek` from `date-fns`
 * call `.getDay()` / `.setDate()` on the local Date). Do NOT switch to
 * `getUTCDay()` / `getUTCDate()` — a set logged at 23:30 BRT Sunday must fall
 * in that Sunday's local week, not the UTC Monday.
 */

export type IsoWeek = {
  /** Local Monday 00:00:00.000 of this week. */
  start: Date;
  /** Local Sunday 23:59:59.999 of this week. */
  end: Date;
  /** Stable map key: 'YYYY-Www' (e.g. '2026-W20'). */
  key: string;
  /** Display label for the Monday: 'M/d' (e.g. '5/12'). */
  label: string;
};

const WEEK_OPTS = { weekStartsOn: 1 as const }; // Monday

/** Returns local Monday 00:00 of the ISO week containing `d`. */
export function isoWeekStart(d: Date): Date {
  return startOfWeek(d, WEEK_OPTS);
}

/**
 * Returns 'YYYY-Www' for the ISO week containing `d`, computed against the
 * local Monday (so the key is stable for every Date inside the same week).
 */
export function weekKeyOf(d: Date): string {
  // `format` with token 'RRRR-\'W\'II' would produce ISO-8601 week-year, but
  // we prefer to derive the key from the local Monday to stay aligned with
  // `isoWeekStart` (which is what the buckets use). Using the Monday's
  // year + ISO week ensures keys never disagree with bucket boundaries.
  const monday = isoWeekStart(d);
  // 'RRRR' = ISO week-numbering year; 'II' = ISO week number, zero-padded.
  return format(monday, "RRRR-'W'II");
}

/**
 * Returns the last `n` ISO weeks, oldest → newest, where the newest is the
 * week containing `now` (defaults to current local time).
 */
export function lastNIsoWeeks(n: number, now: Date = new Date()): IsoWeek[] {
  const weeks: IsoWeek[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const anchor = subWeeks(now, i);
    const start = startOfWeek(anchor, WEEK_OPTS);
    const end = endOfWeek(anchor, WEEK_OPTS);
    weeks.push({
      start,
      end,
      key: format(start, "RRRR-'W'II"),
      label: format(start, "M/d"),
    });
  }
  return weeks;
}

/** Re-exported `parseISO` so callers don't need a second import. */
export { parseISO };
