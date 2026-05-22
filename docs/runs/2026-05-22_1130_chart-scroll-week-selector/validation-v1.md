# Validation v1 — 2026-05-22_1130_chart-scroll-week-selector

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## Summary

Data consolidation around `useLifetimeWeeklyVolume` is correct; overlay-inside-scroller decision aligns with the prompt; `<WeeklyVolumeStrip>` public API stays untouched. But 1 blocker (false claim — test #43 imports the `sinceUtc` signature) + 3 majors (missing helper, modal mockup vs cited pattern, scroll re-render perf) force `no-go`.

## Issues

### Blockers

- **[BLK-1]** Designer claims "no test imports the `sinceUtc` signature". **False**: `tests/unit/progress-page-math.test.ts:807-813` (test #43) calls `await listWeeklyVolumeRows({ sinceUtc: "2026-04-01T00:00:00Z" })` directly and asserts the server filter includes `completed_at/is`. Dropping the `sinceUtc` branch makes this test compile-error or runtime-fail.
  - **Fix**: pick one — (a) keep signature as `opts?: {sinceUtc?: string}` (no-arg call goes through lifetime branch — backward compat, dead-but-harmless branch), or (b) delete the branch AND delete test #43 (and update #42/#44/#45). Recommend (a) for v1 lower-risk.

### Majors

- **[MAJ-1]** `isoWeeksBetween` helper is missing. Discovery flagged it; Designer ignored. Without it, no way to produce the contiguous oldest→newest bucket array from `firstSessionMonday` to `now`. Empty-data case (`data = []`) → `firstSessionMonday` undefined → broken pipeline.
  - **Fix**: add `isoWeeksBetween(startMonday: Date, endMondayInclusive: Date): IsoWeek[]` to `src/utils/dates.ts` change row + signature in §Contratos. Spec `computeStripModel` early-return `null` when `data.length === 0`. Add a unit test "5 weeks of data → 5 contiguous buckets oldest→newest".

- **[MAJ-2]** Modal mockup contradicts cited pattern. Design cites `<SetRowMenu>` (bottom-docked, `justify-end`, no `[X]` header) but the mockup shows a centered card with `[X]` row at top (that's `<ChooseActionModal>`'s shape).
  - **Fix**: pick one. Recommend bottom-sheet (matches the cited file + established "open from header" pattern). Redraw mockup accordingly OR switch citation to `<ChooseActionModal>` and keep centered shape.

- **[MAJ-3]** `onScroll` triggers full strip re-render of 260+ bars on every frame. Design says state updates throttle to 16ms — that's the math timing, not the React render cost. 60fps × 260 nodes reconciling = 15,600 ops/sec on a flick. Janks on low-end Android.
  - **Fix**: spec the de-coupling — either (a) wrap bars in `React.memo`, (b) move `visibleRange` state into a child component (the selector pill) via `useImperativeHandle` so the strip parent doesn't re-render, or (c) use `useRef` + `requestAnimationFrame` to update only the pill DOM directly. Pick one.

### Minors

- **[MIN-1]** Empty-data behavior for `firstSessionMonday` unspecified (subsumed by MAJ-1's fix).
- **[MIN-2]** Cross-year visible-range label format unspecified (Jan boundary).
- **[MIN-3]** History page `refetchWeekly` redundant after swap (TanStack dedupes; cosmetic).
- **[MIN-4]** History first-mount cold-start cost climbs to ~2.96s (lifetime read). Worth a Riscos note + fallback trigger.
- **[MIN-5]** `contentOffset` honored only on mount; new week roll-over while page mounted doesn't auto-scroll to new edge.
- **[MIN-6]** Selector edge: picking a month with zero sessions scrolls to zero-volume bars. Acceptable; confirm in design.
- **[MIN-7]** `weekKeyToMondayLabel` (existing) vs new `isoWeekContaining` partial overlap. Future cleanup.

## Decision

**`no-go`**

Round 1 of 3. 2 rounds remaining.

## Counts

`{ blockers: 1, majors: 3, minors: 7 }`

## Recommendation to Conductor

`invoke Designer for re-design (v2)`. Fix BLK-1 + MAJ-1/2/3 explicitly. Minors absorbed.
