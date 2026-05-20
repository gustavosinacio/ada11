/**
 * Display formatters for session start time + duration. Extracted from
 * `app/(app)/history/[id].tsx` so the same logic is reused inside
 * `SessionTimesEditor`.
 */

/** "Mon, May 18, 4:30 PM" using the device locale. */
export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
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
