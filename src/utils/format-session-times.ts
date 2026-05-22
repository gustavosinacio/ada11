/**
 * Display formatters for session start time + duration. Extracted from
 * `app/(app)/history/[id].tsx` so the same logic is reused inside
 * `SessionTimesEditor`.
 */

import { formatDisplayDate } from "~/utils/format-display-date";

/**
 * "Mon, May 18, 4:30 PM" using the device locale. Year is appended only when
 * the date is NOT in the current local year (e.g. `"Mon, Nov 4, 2019, 4:30 PM"`).
 *
 * Thin wrapper around `formatDisplayDate` so every screen uses the same
 * year-conditional rule.
 */
export function formatDateTime(iso: string): string {
  return formatDisplayDate(iso, { includeWeekday: true, includeTime: true });
}

/** "1h 12m" or "12m" — em-dash when no end time. */
export function formatDuration(
  startIso: string,
  endIso: string | null,
): string {
  if (!endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
