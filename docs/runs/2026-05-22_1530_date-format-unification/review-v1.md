# Review v1 — 2026-05-22_1530_date-format-unification

Reviewing the diff for the implementation against `design-v2.md` (final approved) + `validation-v2.md` (go, 5 cosmetic minors).

## Diff scope

- Diff command: `git diff f949f0177e734b914cc9d7ab253f6ed808f6bd7f...HEAD` (baseline recorded in `state.md`). The implementation is uncommitted; review covered `git diff HEAD` for the in-flight working tree.
- Source files in scope: 13 (1 new helper + 1 new test + 12 edits across `src/`, `app/`, `tests/`).
- `npm run typecheck` (sanity): PASSED — "TypeScript: No errors found".

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| Helper signatures `formatDisplayDate(date, opts?)` + `formatShortDate(date, opts?)`. `Date | string` accepted; invalid → `"—"` or ISO slice. | yes | `src/utils/format-display-date.ts:48-65` (`parseInput`), `:86-114` (long), `:129-149` (short). |
| `formatShortDate.yearFormat` default `"2-digit"`; `weekly-volume-strip.tsx` per-bar passes `"numeric"`. | yes | `src/utils/format-display-date.ts:143`; `src/components/weekly-volume-strip.tsx:287-289`. |
| F5 carryover on `session-summary-row.tsx`: `formatDisplayDate(session.started_at, { includeWeekday: true })` — equivalent options to prior inline `formatDate`. | yes | `src/components/session-summary-row.tsx:45`. Diff shows the inline `formatDate` used the exact same `{weekday, month, day, year-when-prior}` shape. Byte-for-byte equivalent. |
| `formatDateTime` thin wrapper to `formatDisplayDate(iso, { includeWeekday: true, includeTime: true })`. | yes | `src/utils/format-session-times.ts:16-18`. Consumed by `session-times-editor.tsx:18,124` (transitive `app/(app)/history/[id].tsx`). |
| Visible-range pill regression for single-year window accepted: `"Apr 27 – Jun 21"`. | yes | `src/components/weekly-volume-strip.tsx:65-67`. |
| `measurements-chart.test.ts` + `progress-page-math.test.ts` pinned with `vi.useFakeTimers + vi.setSystemTime("2026-05-22T12:00:00-03:00")` in `beforeEach`, `vi.useRealTimers` in `afterEach`. | yes | `tests/unit/measurements-chart.test.ts:9-16`; `tests/unit/progress-page-math.test.ts:42-49`. |
| A11y body-header on `history/week/[isoWeek].tsx` with `"Week range: ..."`. E2E uses `getByLabel(/Week range:/)`. | yes | `app/(app)/history/week/[isoWeek].tsx:177`; `tests/e2e/week-drill-down.spec.ts:239`. |
| No new `any`, no new `// @ts-ignore`, no stray `console.log`. | yes | Pre-existing `console.log` lines in `week-drill-down.spec.ts` are screenshot-tracers, unchanged by this diff. |
| `formatShortDate` uses `toLocaleDateString("en-US", …)` instead of manual `${m}/${d}` concat (documented deviation). | yes | `src/utils/format-display-date.ts:145`. Documented in `implementation.md` § "Deviations from design". Justifiable — robust against Intl shape changes and stays honest to the design's "en-US locked" rule. |

## Issues

### Blockers

None.

### Majors

- **[MAJ-1]** `tests/unit/dates.test.ts:108-113` and `tests/unit/dates.test.ts:140-147`: two unpinned year-stability assertions on `IsoWeek.label` were missed by MAJ-1 in design-v2 (which only listed `measurements-chart.test.ts` + `progress-page-math.test.ts`).
  - Line 111 asserts `expect(w.label).toMatch(/^\d{1,2}\/\d{1,2}$/)` on the labels returned by `lastNIsoWeeks(8)` with the default `now = new Date()`. Once the host calendar enters early January 2027 (and the last 8 ISO weeks straddle the year boundary), some labels will be `"12/29/26"` and the regex fails.
  - Line 145 asserts the same regex on `isoWeekContaining(new Date(2026, 4, 13)).label`. This is a fixed prior-year input; the test will fail deterministically the moment the host year != 2026 (label becomes `"5/11/26"`).
  - Same year-rollover regression class as MAJ-1 in design-v2; the Implementer fixed 2 of 3 affected test files. The mirror to MAJ-1 design intent ("Pin them with `vi.setSystemTime(...)` ... Keeps the existing fixtures stable across calendar years.") applies verbatim here.
  - **Fix**: add `beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00")); }); afterEach(() => vi.useRealTimers());` at top-level of `tests/unit/dates.test.ts`; or tighten the two regexes to `/^\d{1,2}\/\d{1,2}(\/\d{2})?$/` to accept the optional 2-digit-year suffix. Pinning is consistent with how the design tackled the same class of regression in the other two test files.

### Minors

- **[MIN-1]** `src/components/weekly-volume-strip.tsx:60-63`: JSDoc on `formatVisibleRange` is inaccurate for the cross-year and fully-prior-year cases. Given the implementation `${formatDisplayDate(start)} – ${formatDisplayDate(end)}` and the year-conditional rule:
  - Cross-year window with prior start + current end renders as `"Dec 29, 2025 – Jan 11"` (no trailing `, 2026`), not `"Dec 29, 2025 – Jan 11, 2026"` as documented.
  - Fully-prior-year window renders as `"Nov 4, 2019 – Nov 10, 2019"` (year on both ends), not `"Nov 4 – Nov 10, 2019"` as documented.
  - **Fix**: update the JSDoc examples to reflect actual output of the per-end year-conditional rule.
- **[MIN-2]** `src/utils/format-display-date.ts:109-113`: the outer `try/catch` is effectively dead code now that `parseInput` upstream catches `Invalid Date` and returns the fallback. The catch is reachable only if `Intl.DateTimeFormat` itself throws — which the JSDoc/implementation comment acknowledges, but the surface area of this dead branch is tested implicitly by no test. Minor — leave or replace with a comment-only note that the path is "Intl explosion guard, not Invalid Date guard". Not a defect; flagged because reviewer's first reading mistakenly thought it duplicated `parseInput`'s job.
- **[MIN-3]** Carry-forward from validation-v2: `formatDisplayDate({includeTime})` locale-dependence is now JSDoc'd at `src/utils/format-display-date.ts:23-28`. Acceptable, noted for the Tester.

## Security checklist

- [x] RLS: no new `from('table').*` calls. The diff is purely client-side display formatting + tests; zero data-access surface.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` or other service-role token in client-bundled code.
- [x] No new `rpc` calls; no user input concatenated into SQL.
- [x] No new `EXPO_PUBLIC_*` env vars.

## Style / convention checklist

- [x] No new `any`. Confirmed via `grep -n "any\b"` over modified files.
- [x] No new `// @ts-ignore`. Confirmed via `grep -n "@ts-ignore"`.
- [x] Comments narrate *why*, not *what*. The helper docblocks (e.g. `:5-17`, `:23-28`, `:33-41`, `:43-46`, `:67-85`, `:116-128`) explain rationale ("centralises the year-conditional rule…", "locked to en-US numeric ordering because chart axes need stable terse labels…"); the MIN-1 JSDoc bug is one localised counter-example narrating wrong-what, not wrong-why.
- [x] Imports follow project style. Package imports first, then `~/`-rooted relatives; alphabetical within each group; `date-fns/format` removed from files where it became unused.
- [x] New files placed in conventional folders: `src/utils/format-display-date.ts`, `tests/unit/format-display-date.test.ts`. Match existing utility + test layout.

## Decision

**fail**

Reasoning:
- 0 blockers, 1 major (`MAJ-1`), 3 minors. The threshold says ≤1 major still passes — but MAJ-1 is in the **same class** as the design-v2 MAJ-1 the Implementer was explicitly asked to fix. Leaving the third affected test file unpinned means the year-stability regression the design called out is still present in the suite. Treating this as a pass on the "≤1 major" rule would let a known-incomplete fix ship; the cleaner call is to bounce it back, have the Implementer pin `dates.test.ts` the same way, and re-validate.
- The other items are minor / cosmetic and not gating.

Recommended next step: return to Implementer with MAJ-1 and MIN-1 (the JSDoc inaccuracy is a 30-second fix and worth bundling).
