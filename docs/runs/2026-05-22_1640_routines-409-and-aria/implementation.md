# Implementation — 2026-05-22_1640_routines-409-and-aria

Based on: `fix-plan.md` (pre-approved by user with "finish it"). Baseline commit: `b51dd01` (branch `main`).

## Files changed

- `src/components/exercise-picker.tsx` (edited) — Added per-row `pickingId` in-flight guard for Bug 1 (409 race); added `onShow` handler that blurs `document.activeElement` on web for Bug 2 (aria-hidden warning); widened `onPick` prop type from `(ex) => void` to `(ex) => void | Promise<void>` so the picker can `await` the caller's mutation without TS noise.
- `tests/e2e/routines-add-exercise-race.spec.ts` (new) — E2E asserting that a rapid double-click on the same exercise picker row fires exactly one POST and inserts exactly one row, with no 4xx in the network log.

### Detailed change anchors

- `src/components/exercise-picker.tsx:24` — `onPick: (exercise: ExerciseRow) => void | Promise<void>` (widened from `=> void`).
- `src/components/exercise-picker.tsx:31` — `const [pickingId, setPickingId] = useState<string | null>(null);`
- `src/components/exercise-picker.tsx:54-60` — `<Modal onShow>` callback blurs `document.activeElement` (web-only via `typeof document !== "undefined"` guard).
- `src/components/exercise-picker.tsx:106-152` — `renderItem` updates: `isPicking` / `isBusy` derived, `onPress` is now `async`, sets `pickingId` then awaits `onPick(item)` inside try/finally; `disabled = already || isBusy`; row gets `opacity-50` while another row is mid-pick (visual cue); active row shows an `<ActivityIndicator>` in place of the "added" badge.

## Deviations from plan

- **Prop type signature widening (`onPick: (ex) => void` → `(ex) => void | Promise<void>`)**: not called out in the fix plan explicitly, but required so the picker can `await onPick(item)` without TS lying about the return value. The two real callers (`routines/[id]/index.tsx:266` and `workout/[sessionId].tsx:549`) already return either a `Promise<void>` or `void`, so this is strictly a more accurate type. Justified as a non-deviation in spirit — the fix plan §Contratos de I/O says the picker now `await`s the prop; widening the prop type is the typed way to express that.
- **Visual feedback choice**: the plan said "Designer's call; recommend `opacity-50` on the row." Implemented as: `opacity-50` on non-active picking rows (the busy ones the user can't tap), plus an `<ActivityIndicator>` in place of the trailing "added" label on the row that's actually mid-pick. The active row stays at full opacity so the user still sees what they tapped.
- **No changes to call sites**: confirmed `routines/[id]/index.tsx` and `workout/[sessionId].tsx` are untouched. Both still compile and their existing `onPick` shapes satisfy the new prop type.

## Soft callbacks made

- None. Fix plan was complete and unambiguous; no escalation needed.

## Quality gates

- [x] `npm run typecheck` — pass (exit 0).
- [x] `npm run lint` — pass (0 errors, 1 pre-existing warning in `router.d.ts`, unrelated to this change).
- [x] `npm run test:unit` — 229/229 passed across 14 files (1.48s).
- [ ] `npx expo export --platform web` — not run (out of scope per task: "Don't run e2e"; web export is similarly out of scope for this pipeline pass).
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log`.

## Process notes (for retro)

- Symmetry with the F6 add-set debounce paid off — the `pickingId: string | null` shape mirrors `isAddingSet` and required only one state hook + try/finally to land cleanly.
- The aria-hidden fix is a 4-line `onShow` callback; cleaner than chasing a focus-trap library or `inert` polyfill. The `typeof document !== "undefined"` guard keeps it web-only without needing `Platform.OS === "web"` (which would still pull in the RN runtime check).

## Notes for Regression Tester

- **Reproduce the original repros**:
  - Bug 1: open `/routines/{id}`, open picker, rapid double-tap any exercise → expect 1 POST + 1 row (the new e2e `routines-add-exercise-race.spec.ts` automates this).
  - Bug 2: navigate workout tab → Edit on a routine → Add exercise → check browser DevTools console for the `Blocked aria-hidden on an element...` warning. Should be absent.
- **Adjacent screens / flows to smoke-check**:
  - `tests/e2e/remove-exercise.spec.ts` — uses the same `<ExercisePicker>` on the live workout screen; the new guard applies but the workout caller is sync `void`, so behavior should be visually identical.
  - `tests/e2e/set-row-menu.spec.ts` — similar Modal pattern, unaffected (no changes to that surface).
- **Limitation**: the aria-hidden fix is web-only by guard. Native (iOS / Android) is untouched and unaffected.
