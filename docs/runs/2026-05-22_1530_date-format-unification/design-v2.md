# Design v2 — 2026-05-22_1530_date-format-unification

> Tight delta from `design-v1.md`. Conductor-written (Designer subagent pacing). Sections tagged `[v1-carryover]` / `[changed-v2]` / `[new-v2]`.

## Approach `[changed-v2]`

v1 direction holds — central `src/utils/format-display-date.ts` with `formatDisplayDate` (locale, written month, optional weekday + time) + `formatShortDate` (en-US locked, numeric M/D). v2 closes 4 issues:

1. **BLK-1**: drop the phantom `app/(app)/history/[id].tsx` migration row. The screen consumes `formatDateTime` only transitively through `<SessionTimesEditor>` — that edit already lives in the file map.

2. **MAJ-1**: add migration rows for the existing unit tests that assert literal `"5/20"` / `"5/18"` strings. Pin them with `vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00"))` in `beforeEach` + `vi.useRealTimers()` in `afterEach`. Keeps the existing fixtures stable across calendar years.

3. **MAJ-2**: a11y label keeps **4-digit year** for prior-year bars. Add a new short-helper variant or accept a `{yearFormat?: "2-digit" | "numeric"}` option on `formatShortDate` (default `"2-digit"` for chart axes; pass `"numeric"` for the a11y label). Document in Riscos.

4. **MIN-4**: e2e at `week-drill-down.spec.ts:239` switches from anchored regex to an accessibility-label-based selector that scopes to the body-header (e.g., `getByLabel(/Week range/i)` if we add a label, OR `locator('[data-testid="week-range"]')` if we add a testid). v2 picks the testid path: add `accessibilityLabel="Week range: ..."` to the body-header Text element, then update the test to `page.getByLabel(/Week range:/)`.

## `formatShortDate` signature `[changed-v2]`

```ts
export function formatShortDate(
  date: Date | string,
  opts?: { yearFormat?: "2-digit" | "numeric" }
): string;
// Current year, default → "5/24"
// Current year, numeric → "5/24"
// Prior year, default → "11/8/25"
// Prior year, numeric → "11/8/2025"
```

Callers:
- Chart axes (exercise progress, measurements, isoweek label, best-week label): default (2-digit year on prior).
- `weekly-volume-strip.tsx` per-bar a11y label: `{yearFormat: "numeric"}` (preserves current "View week of 5/12/2025" shape exactly).

## File map `[changed-v2]`

**Drop:** `app/(app)/history/[id].tsx` row from v1.

**Add (test pinning, MAJ-1):**
- `tests/unit/measurements-chart.test.ts` — add `vi.useFakeTimers()` + `vi.setSystemTime(...)` in `beforeEach`, `vi.useRealTimers()` in `afterEach`. Keep assertions `expect(out[0]!.label).toBe("5/20")` unchanged.
- `tests/unit/progress-page-math.test.ts` — same pattern around test #11/best-week.

**Add (a11y a11y label sourcing, MIN-4):**
- `app/(app)/history/week/[isoWeek].tsx` — add `accessibilityLabel="Week range: {body header text}"` to the body-header `<Text>`.
- `tests/e2e/week-drill-down.spec.ts` — line 239 swap regex anchor for `page.getByLabel(/Week range:/)`.

**Otherwise v1 carryover.**

## `formatDisplayDate` Invalid Date fallback `[changed-v2]`

Per MIN-2:
```ts
function safeDisplay(date: Date | string): string {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    return date.toLocaleDateString(...);
  }
  // string input
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    return typeof date === "string" ? date.slice(0, 10) : "—";
  }
  return d.toLocaleDateString(...);
}
```

## What did NOT change from v1

- Central helper location + two-function shape.
- Body-text locale device-default; chart axes en-US locked.
- Weekday keep/drop policy (keep on session/measurement lists, drop on chart axes).
- 9 (now 9) migration sites.
- `formatDateTime` thin-wrapper approach.
- Visible-range pill regression (`"Apr 27 – Jun 21, 2026"` → `"Apr 27 – Jun 21"` on single-year windows) accepted, called out in Riscos.

## Confidence / Risk `[new-v2]`

- **Confidence**: ALTA. v2 is four 1-line fixes to v1 + JSDoc polish.
- **Risk**: BAIXO. No behavior change for the 4-digit-year a11y label (intentionally preserved); test pinning makes existing assertions year-stable.
