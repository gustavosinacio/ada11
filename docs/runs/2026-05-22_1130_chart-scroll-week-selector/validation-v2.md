# Validation v2 — 2026-05-22_1130_chart-scroll-week-selector

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## v1 issues — verification

| Issue | v2 fix | Verified |
|---|---|---|
| BLK-1 (`listWeeklyVolumeRows` signature drop) | Signature preserved as `opts?: {sinceUtc?: string}`; test #43 untouched; §Mudanças for `src/api/stats.ts` says "No signature change". | ✓ design-v2:78-86 |
| MAJ-1 (`isoWeeksBetween` + empty data) | Helper added to file map + §Contratos with empty-case spec; `computeStripModel` early-returns `null` on `data.length === 0`; unit tests added in dates + bucketing test files. | ✓ design-v2:24, 113-116, 137 |
| MAJ-2 (modal pattern alignment) | Mockup redrawn as bottom-sheet, citation `set-row-menu.tsx:110-225`, classes match the actual file. | ✓ design-v2:39-61 |
| MAJ-3 (scroll re-render avoidance) | `<VisibleRangePill>` child with `useImperativeHandle`. Parent never `setState`s on scroll. Handle shape documented. | ✓ design-v2:153-156, 170 |
| MIN-2 (cross-year label format) | `"MMM d – MMM d, yyyy"` single-year, `"MMM d, yyyy – MMM d, yyyy"` cross-year. | ✓ design-v2:188-190 |
| MIN-4 (cold-start fallback) | Note added. | ✓ design-v2:205 |
| MIN-5 (right-edge pin auto-scroll on rollover) | `useEffect` with pinned-check + `scrollToEnd` on `buckets.length` change. | ✓ design-v2:174-184 |
| MIN-6 (zero-session month) | Gray-stub bars, no special copy. | ✓ design-v2:236 |

**All v1 issues fixed.**

## Issues found in v2 (all minors — implementation nits, not blockers)

- **[MIN-A]** `listWeeklyVolumeRows` signature widening (`opts` → `opts?`) needs a defensive default — currently the body reads `opts.sinceUtc` at line 51. Add `opts: {...} = {}` or guard `opts?.sinceUtc`.
- **[MIN-B]** Design's "delete `WEEK_OPTS`" reference is imprecise — actual thing to delete is `WEEKS_WINDOW` constant + the `sinceUtc` derivation in `use-stats.ts:17-27`.
- **[MIN-C]** E2E test `weekly-volume-strip.spec.ts:197` asserts "≥8 bars" — under lifetime data this passes trivially without catching regressions. Optional tightening, not load-bearing.
- **[MIN-D]** `<VisibleRangePill>` initial label source unclear — strip parent must compute the rightmost window's label at mount and pass as `initialLabel` prop.
- **[Scrutiny-1]** `useImperativeHandle` has no precedent in the repo. `forwardRef` is at `ui/input.tsx:9` + `ui/textarea.tsx:9`. Implementer note worth adding for canonical shape.
- **[Scrutiny-2]** `pillRef.current?.setRange(...)` on `onScroll` may set the same label on consecutive frames — cheap dedupe guard worth adding.

## Decision

**`go`**

- 0 blockers + 0 majors → go.
- All v1 issues resolved; new minors are implementation-quality nits absorbable in Implement / Review.

## Counts

`{ blockers: 0, majors: 0, minors: 6 }`

## Recommendation to Conductor

`invoke Implementer`. Pass MIN-A through MIN-D + Scrutiny-1/2 nits as implementer-facing notes.
