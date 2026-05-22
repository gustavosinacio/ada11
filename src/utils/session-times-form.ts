/**
 * Pure helpers for the edit-session-times form on History detail.
 *
 * - `composeIso` / `decomposeIso` translate between device-local
 *   `YYYY-MM-DD` + `HH:mm` strings and stored UTC ISO 8601.
 * - `validateTimes` enforces strict component shape, valid Date,
 *   `end >= start`, and `end <= now()`.
 * - `countSetsOutsideRange` is a soft-warning helper for the editor — it
 *   counts how many of the session's sets fall outside the drafted range
 *   using ms-since-epoch (UTC-vs-UTC) so the comparison is TZ-agnostic.
 *
 * NOTE: parsing uses `date-fns/parse` (mirror of `src/utils/measurements-form.ts:128-137`)
 * so component rollovers (`2026-02-30`, 13th month, leap-day on a non-leap year)
 * become Invalid Date instead of being silently corrected by `new Date()`.
 */

import { parse } from "date-fns";

// Strict regexes reject 25:99, 09:60, 2026-13-45, etc. BEFORE parse runs.
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^(2[0-3]|[01]\d):([0-5]\d)$/;

/**
 * Mask incoming text into a partial `HH:mm` string while the user types on a
 * numeric keyboard. Bypasses while deleting so the user can step backward
 * through the colon without it being re-inserted.
 *
 * Examples:
 *   "" → "1" → "18" → "183" => "18:3" → "1830" => "18:30"
 *   Pasting "18:30" → "18:30"
 *   Pasting "1830" → "18:30"
 *   Backspace from "18:30" → "18:3" → "18:" → "18" → "1" → ""
 */
export function maskTimeInput(prev: string, next: string): string {
  if (next.length < prev.length) return next;
  const digits = next.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export type TimesDraft = {
  startDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm (24h)
  endDate: string;
  endTime: string;
};

export type ValidationErrorKind =
  | "start-date-invalid"
  | "start-time-invalid"
  | "end-date-invalid"
  | "end-time-invalid"
  | "end-before-start"
  | "end-in-future";

export type ValidationError = { kind: ValidationErrorKind };

export type ValidateTimesResult =
  | { ok: true; started_at: string; ended_at: string }
  | { ok: false; error: ValidationError };

/**
 * Compose local date + time strings into a UTC ISO 8601 string.
 * Throws RangeError if the combined string fails strict parsing.
 */
export function composeIso(localDate: string, localTime: string): string {
  const d = parse(
    `${localDate} ${localTime}`,
    "yyyy-MM-dd HH:mm",
    new Date(),
  );
  if (Number.isNaN(d.getTime())) {
    throw new RangeError("Invalid date or time");
  }
  return d.toISOString();
}

/** Split a UTC ISO into device-local date + time strings for display. */
export function decomposeIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Cross-field validation. Returns composed UTC ISO pair or first error. */
export function validateTimes(
  draft: TimesDraft,
  now: Date,
): ValidateTimesResult {
  if (!DATE_RE.test(draft.startDate)) {
    return { ok: false, error: { kind: "start-date-invalid" } };
  }
  if (!TIME_RE.test(draft.startTime)) {
    return { ok: false, error: { kind: "start-time-invalid" } };
  }
  if (!DATE_RE.test(draft.endDate)) {
    return { ok: false, error: { kind: "end-date-invalid" } };
  }
  if (!TIME_RE.test(draft.endTime)) {
    return { ok: false, error: { kind: "end-time-invalid" } };
  }

  let started_at: string;
  let ended_at: string;
  try {
    started_at = composeIso(draft.startDate, draft.startTime);
  } catch {
    return { ok: false, error: { kind: "start-date-invalid" } };
  }
  try {
    ended_at = composeIso(draft.endDate, draft.endTime);
  } catch {
    return { ok: false, error: { kind: "end-date-invalid" } };
  }

  const startMs = new Date(started_at).getTime();
  const endMs = new Date(ended_at).getTime();
  if (endMs < startMs) {
    return { ok: false, error: { kind: "end-before-start" } };
  }
  if (endMs > now.getTime()) {
    return { ok: false, error: { kind: "end-in-future" } };
  }
  return { ok: true, started_at, ended_at };
}

/**
 * Count sets whose `completed_at` falls outside [composedStartIso, composedEndIso].
 * Both inputs are UTC ISO strings; comparison is in ms-since-epoch to avoid
 * any local-vs-UTC string-comparison mismatch. `null` completed_at entries are
 * ignored (a still-pending set can't be "outside" anything).
 */
export function countSetsOutsideRange(
  composedStartIso: string,
  composedEndIso: string,
  setsCompletedAt: readonly (string | null)[],
): number {
  const startMs = new Date(composedStartIso).getTime();
  const endMs = new Date(composedEndIso).getTime();
  let count = 0;
  for (const c of setsCompletedAt) {
    if (!c) continue;
    const t = new Date(c).getTime();
    if (t < startMs || t > endMs) count += 1;
  }
  return count;
}

/** Human-readable message for each validation error kind. */
export function messageFor(kind: ValidationErrorKind): string {
  switch (kind) {
    case "start-date-invalid":
      return "Start date must be YYYY-MM-DD.";
    case "start-time-invalid":
      return "Start time must be HH:MM (24h).";
    case "end-date-invalid":
      return "End date must be YYYY-MM-DD.";
    case "end-time-invalid":
      return "End time must be HH:MM (24h).";
    case "end-before-start":
      return "End must be the same or after start.";
    case "end-in-future":
      return "End can't be in the future.";
  }
}
