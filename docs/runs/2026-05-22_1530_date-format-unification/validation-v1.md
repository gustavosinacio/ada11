# Validation v1 — 2026-05-22_1530_date-format-unification

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## Designer claims verified

Most claims verified file:line. Notable:
- `session-summary-row.tsx:15-32` already implements the F5 rule.
- `weekly-volume-strip.tsx:56-63` `formatVisibleRange` rule (cross-year both, single-year trailing).
- Per-bar a11y at `:280-283` uses 4-digit year today.
- `format-session-times.ts:formatDateTime` consumed only by `<SessionTimesEditor>`.
- Two duplicate `shortDate` clones at `exercises/[id]/progress.tsx:21-28` + `measurements-chart.ts:7-14`.
- 11 sites total, 3 idioms.

## Issues

### Blockers

- **[BLK-1]** Design's `app/(app)/history/[id].tsx` migration row is phantom. Grep across `app/` returns zero `formatDateTime` references. The screen renders `<SessionTimesEditor>` (which is the actual consumer). Drop the row or rewrite.

### Majors

- **[MAJ-1]** Existing unit tests will break in 2027. `measurements-chart.test.ts:103` asserts `"5/20"`; `progress-page-math.test.ts:194` asserts `"5/18"`. Once helpers add year-suffix for prior-year fixtures, these become `"5/20/26"` / `"5/18/26"`. Add file-map rows for these two test files: pin wall clock with `vi.setSystemTime(...)` in `beforeEach` OR re-fixture to "always prior" year (e.g., 2024) and update assertions to include `/24`.

- **[MAJ-2]** Per-bar a11y label format silently changes. Today `weekly-volume-strip.tsx:283` emits `"View week of 5/12/2025"` (4-digit year). New `formatShortDate` per the v1 spec emits `"5/12/25"` (2-digit). Choose: (a) helper uses `year: "numeric"` (4-digit) so a11y is unchanged, OR (b) accept the change and document in Riscos. No existing e2e asserts the old shape (verified).

### Minors

- **[MIN-1]** `dates.ts:IsoWeek.label` becoming year-aware (`"11/8/25"`) tight on the 10pt `BAR_WIDTH=40` per-bar label. Inspect during Test.
- **[MIN-2]** `formatDisplayDate` fallback for `Invalid Date` returns string "Invalid Date" — uglier than the existing `.slice(0, 10)` ISO fallback. Use ISO prefix instead.
- **[MIN-3]** `formatDisplayDate` with `includeTime: true` is locale-dependent. JSDoc note.
- **[MIN-4]** E2E test update too vague. After the change, body-header AND pill may BOTH equal `"May 18 – May 24"` on single-year windows. The current `^...$` anchored regex would match both → Playwright fails. Pin a concrete locator change in the design (drop anchor, use parent class, or use accessibility-label-based selector).

## Decision

**`no-go`**

Reasoning:
- 1 blocker + 2 majors → no-go.
- All fixes are mechanical. Tight v2.

Round 1 of 3. 2 remaining.

## Counts

`{ blockers: 1, majors: 2, minors: 4 }`

## Recommendation to Conductor

`invoke Designer for re-design (v2)`. Required:
1. (BLK-1) Drop `history/[id].tsx` row from file map.
2. (MAJ-1) Add rows for the two existing test files — `vi.setSystemTime` or re-fixture.
3. (MAJ-2) Pick 4-digit vs 2-digit year on the a11y a11y label; document.
4. (MIN-4) Pin concrete e2e locator update for `week-drill-down.spec.ts:239`.
