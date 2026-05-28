/**
 * Display formatters for human-facing calendar dates.
 *
 * Two helpers, one shared rule:
 *   - Current-year dates render `dd/mm` (no year).
 *   - Prior-year dates render `dd/mm/yy` (2-digit year by default).
 *
 * Centralises the year-conditional rule that was originally shipped on
 * `<SessionSummaryRow>` (`session-summary-row.tsx`) so every screen renders
 * dates the same way.
 *
 * - `formatDisplayDate(date, opts?)`: body-text / headline / row labels.
 *   Optionally prepends a short weekday and/or appends a 24h time.
 * - `formatShortDate(date, opts?)`: chart axes / small pills / a11y labels.
 *   Pure numeric `dd/mm` (or `dd/mm/yy` / `dd/mm/yyyy` for prior-year via
 *   `yearFormat`).
 *
 * Locale lock: weekday + time use en-GB (English weekday short names + 24h
 * clock) so the output is deterministic across devices instead of varying
 * with the user's locale. Date numerics are built manually for absolute
 * control over `dd/mm/yy` order.
 *
 * Both accept either a `Date` or an ISO 8601 string. Invalid inputs fall back
 * gracefully — see `safeDisplay`.
 */

/** Optional shape for `formatDisplayDate`. All fields default to `false`. */
export type FormatDisplayDateOptions = {
  /** Prepend the short weekday (e.g. `"Sat, 24/05"`). */
  includeWeekday?: boolean;
  /**
   * Append a 24h time in en-GB style (e.g. `"Mon, 18/05, 16:30"`). The clock
   * is locked to 24h so the output is deterministic regardless of device
   * locale.
   */
  includeTime?: boolean;
};

/** Optional shape for `formatShortDate`. */
export type FormatShortDateOptions = {
  /**
   * How to render the year suffix on prior-year dates.
   * - `"2-digit"` (default): `"08/11/25"` — chart axes / pill labels.
   * - `"numeric"`: `"08/11/2025"` — accessibility labels (full year).
   *
   * Current-year dates never include a year regardless of this option.
   */
  yearFormat?: "2-digit" | "numeric";
};

/**
 * Normalises a `Date | string` input to a `Date` AND emits a fallback string
 * when parsing fails. Returns `null` for the date when invalid; callers
 * substitute the fallback.
 */
function parseInput(
  date: Date | string,
): { d: Date; ok: true } | { d: null; ok: false; fallback: string } {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) {
      return { d: null, ok: false, fallback: "—" };
    }
    return { d: date, ok: true };
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    // ISO slice (e.g. "2026-05-22") for strings; "—" only ever happens via
    // the `Date` branch above. Matches the existing inline fallback shape on
    // `measurement-list-item.tsx`.
    return { d: null, ok: false, fallback: date.slice(0, 10) };
  }
  return { d: parsed, ok: true };
}

/** `dd/mm` (current year) or `dd/mm/yy` (prior year). Numerics built manually
 *  so the order is independent of device locale. */
function formatDateNumeric(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  if (d.getFullYear() !== new Date().getFullYear()) {
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  }
  return `${dd}/${mm}`;
}

/**
 * Long-form display date. Year is appended only when the date is NOT in the
 * current local year (as `yy`).
 *
 * Examples (current year = 2026):
 *   formatDisplayDate("2026-05-24T12:00:00Z")
 *     → "24/05"
 *   formatDisplayDate("2026-05-24T12:00:00Z", { includeWeekday: true })
 *     → "Sat, 24/05"
 *   formatDisplayDate("2019-11-08T12:00:00Z", { includeWeekday: true })
 *     → "Fri, 08/11/19"
 *   formatDisplayDate("2026-05-18T16:30:00Z",
 *                     { includeWeekday: true, includeTime: true })
 *     → "Mon, 18/05, 16:30"
 *   formatDisplayDate(new Date(NaN))
 *     → "—"
 *   formatDisplayDate("garbage")
 *     → "garbage"  // ISO slice (first 10 chars), matches inline precedents
 */
export function formatDisplayDate(
  date: Date | string,
  opts: FormatDisplayDateOptions = {},
): string {
  const parsed = parseInput(date);
  if (!parsed.ok) return parsed.fallback;
  const d = parsed.d;

  try {
    const datePart = formatDateNumeric(d);
    const head = opts.includeWeekday
      ? `${new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(d)}, ${datePart}`
      : datePart;
    if (opts.includeTime) {
      const time = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
      return `${head}, ${time}`;
    }
    return head;
  } catch {
    // Truly exceptional path (broken Intl). Match the existing inline
    // formatters: fall back to the raw input when the formatter explodes.
    return typeof date === "string" ? date : String(date);
  }
}

/**
 * Short-form numeric display date for chart axes / small pills / a11y labels.
 *
 * Examples (current year = 2026):
 *   formatShortDate("2026-05-24T12:00:00Z")                        → "24/05"
 *   formatShortDate("2019-11-08T12:00:00Z")                        → "08/11/19"
 *   formatShortDate("2019-11-08T12:00:00Z", { yearFormat: "numeric" })
 *                                                                  → "08/11/2019"
 */
export function formatShortDate(
  date: Date | string,
  opts: FormatShortDateOptions = {},
): string {
  const parsed = parseInput(date);
  if (!parsed.ok) return parsed.fallback;
  const d = parsed.d;

  try {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    if (d.getFullYear() !== new Date().getFullYear()) {
      if ((opts.yearFormat ?? "2-digit") === "2-digit") {
        return `${dd}/${mm}/${String(d.getFullYear()).slice(-2)}`;
      }
      return `${dd}/${mm}/${d.getFullYear()}`;
    }
    return `${dd}/${mm}`;
  } catch {
    return typeof date === "string" ? date : String(date);
  }
}
