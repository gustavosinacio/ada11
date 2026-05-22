/**
 * Display formatters for human-facing calendar dates.
 *
 * Two helpers, one shared rule: append the year only when the date is NOT in
 * the current local year. Centralises the year-conditional rule that was
 * originally shipped on `<SessionSummaryRow>` (`session-summary-row.tsx`) so
 * every screen renders dates the same way.
 *
 * - `formatDisplayDate(date, opts?)`: body-text / headline / row labels.
 *   Honours the device locale via `Intl.DateTimeFormat` defaults.
 * - `formatShortDate(date, opts?)`: chart axes / small pills / a11y labels.
 *   Locked to en-US numeric M/D so axis-tick width stays predictable
 *   regardless of device locale.
 *
 * Both accept either a `Date` or an ISO 8601 string. Invalid inputs fall back
 * gracefully — see `safeDisplay`.
 */

/** Optional shape for `formatDisplayDate`. All fields default to `false`. */
export type FormatDisplayDateOptions = {
  /** Prepend the short weekday (e.g. `"Sat, May 24"`). */
  includeWeekday?: boolean;
  /**
   * Append a locale-formatted time (e.g. `"Mon, May 18, 4:30 PM"` in en-US).
   * The exact time shape is locale-dependent; pt-BR / fr-FR devices will get
   * their own 24h conventions.
   */
  includeTime?: boolean;
};

/** Optional shape for `formatShortDate`. */
export type FormatShortDateOptions = {
  /**
   * How to render the year suffix on prior-year dates.
   * - `"2-digit"` (default): `"11/8/25"` — chart axes / pill labels.
   * - `"numeric"`: `"11/8/2025"` — accessibility labels (full year).
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

/**
 * Long-form display date. Year is appended only when the date is NOT in the
 * current local year.
 *
 * Examples (current year = 2026, device locale en-US):
 *   formatDisplayDate("2026-05-24T10:00:00Z")
 *     → "May 24"
 *   formatDisplayDate("2026-05-24T10:00:00Z", { includeWeekday: true })
 *     → "Sat, May 24"
 *   formatDisplayDate("2019-11-08T10:00:00Z", { includeWeekday: true })
 *     → "Fri, Nov 8, 2019"
 *   formatDisplayDate("2026-05-18T19:30:00Z",
 *                     { includeWeekday: true, includeTime: true })
 *     → "Mon, May 18, 4:30 PM"   // time format is locale-dependent
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
    const fmt: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
    };
    if (opts.includeWeekday) fmt.weekday = "short";
    if (d.getFullYear() !== new Date().getFullYear()) {
      fmt.year = "numeric";
    }
    if (opts.includeTime) {
      fmt.hour = "numeric";
      fmt.minute = "2-digit";
      return d.toLocaleString(undefined, fmt);
    }
    return d.toLocaleDateString(undefined, fmt);
  } catch {
    // Truly exceptional path (broken Intl). Match the existing inline
    // formatters: fall back to the raw input when the formatter explodes.
    return typeof date === "string" ? date : String(date);
  }
}

/**
 * Short-form numeric display date for chart axes / small pills / a11y labels.
 *
 * Locale: en-US numeric ordering (M/D) regardless of device locale, because
 * chart axes need stable terse labels that fit under 9-10pt SVG text and the
 * existing inline `shortDate` clones already produced M/D unconditionally.
 *
 * Examples (current year = 2026):
 *   formatShortDate("2026-05-24T10:00:00Z")                        → "5/24"
 *   formatShortDate("2019-11-08T10:00:00Z")                        → "11/8/19"
 *   formatShortDate("2019-11-08T10:00:00Z", { yearFormat: "numeric" })
 *                                                                  → "11/8/2019"
 */
export function formatShortDate(
  date: Date | string,
  opts: FormatShortDateOptions = {},
): string {
  const parsed = parseInput(date);
  if (!parsed.ok) return parsed.fallback;
  const d = parsed.d;

  try {
    const fmt: Intl.DateTimeFormatOptions = {
      month: "numeric",
      day: "numeric",
    };
    if (d.getFullYear() !== new Date().getFullYear()) {
      fmt.year = opts.yearFormat ?? "2-digit";
    }
    return d.toLocaleDateString("en-US", fmt);
  } catch {
    return typeof date === "string" ? date : String(date);
  }
}
