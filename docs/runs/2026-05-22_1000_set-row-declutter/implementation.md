# Implementation — 2026-05-22_1000_set-row-declutter

Based on: `design-v3.md` (final approved) and `validation-v3.md` (matching `go`, 0 blockers / 0 majors / 2 cosmetic minors).

## Files changed

### Source (7 files)

- `src/api/sets.ts` (edited) — Switched `updateSet` to partial-spread payload with empty-patch short-circuit. Return type widened to `Promise<SetRow | null>`. Added `updateSetMeta(id, patch)` and `UpdateSetMetaInput` exported type. Both writers share the tri-state contract (`undefined` = absent, `null` = clear, value = write). JSDoc blocks document the contract on both functions and both input types.
- `src/hooks/use-sets.ts` (edited) — `useUpdateSet.onSuccess(result)` now skips invalidation when `result === null` (empty-patch short-circuit). Added `useUpdateSetMeta(sessionId)` mutation that invalidates only `["sets", sessionId]` (drops `["stats"]` per design — RPE/notes are not stat inputs). JSDoc documents the intentional divergence.
- `src/components/set-row-menu.tsx` (new) — Bottom-sheet menu mirroring `plate-calculator.tsx:69-153`. Props: `{ onClose, setNumber, exerciseName, initialRpe, initialNotes, previousRpe, onSubmit }` (no `visible` prop — parent gates mount). Hosts 12-chip RPE selector (`—, 5.0, 5.5, …, 10.0`) with horizontal scroll and emerald-tinted selected state, plus a 4-line multi-line notes `<TextInput>`. RPE commits immediately on chip tap; notes commits on close/backdrop dismiss. `parseFloat().toFixed(1)` normalizes legacy `"9"` to `"9.0"` for chip equality. KeyboardAvoidingView with `behavior="padding"` (iOS) / `"height"` (Android). The "—" chip dispatches `{rpe: null}` (explicit clear), not `{rpe: undefined}`. Previous-set RPE renders as a dashed-border hint chip when current RPE is unset.
- `src/components/set-input.tsx` (edited) — Removed inline RPE `<TextInput>` column, removed `MessageSquare` notes toggle + inline notes input, removed `rpe`/`notes`/`notesOpen` state and their `useEffect` syncs. Narrowed `onCommit` payload to `{reps, weight}`. Added `onUpdateMeta(patch)` and `exerciseName` props. New `MoreHorizontal` trigger (`h-11 w-11` tap target, accessibility label `"Open set details"`) with blue tint (`#3b82f6`) when `row.rpe != null || row.notes?.trim()`, gray (`#9ca3af`) otherwise. Menu is JSX-gated by `{menuOpen ? <SetRowMenu .../> : null}` — fresh mount on every open, no idle JSX trees.
- `src/components/exercise-block.tsx` (edited) — Narrowed `onUpdateSet` prop type to `{reps, weight}`. Added `onUpdateSetMeta(id, patch)` prop. Header row: dropped the `w-14 RPE` label and one trailing `w-7` spacer; replaced with a single `w-11` spacer for the menu trigger. Added `items-center gap-2` to the header row to match the data row's flex layout. Forwarded `exerciseName={exercise.name}` and `onUpdateMeta` to each `<SetInput>`.
- `app/(app)/workout/[sessionId].tsx` (edited) — Wired `useUpdateSetMeta(sessionId)` and forwarded `onUpdateSetMeta={async (id, patch) => updateSetMeta.mutateAsync({id, patch})}` to each `<ExerciseBlock>`.
- `app/(app)/history/[id].tsx` (edited) — Same wiring as workout. History detail remains fully editable for RPE + notes through the menu.

### Tests (4 files)

- `tests/unit/api-sets.updateSet.test.ts` (new) — 7 cases per the Test plan (authoritative over the design-v3 table's "six"): reps-only, weight-only, rpe-only, rpe-clear (`null`), full 4-key patch, empty patch short-circuit, all-undefined short-circuit. Mocks `~/lib/supabase` via `vi.mock` with a fluent chain (`from → update → eq → select → single`). Asserts the exact `.update(...)` payload shape and that empty patches skip the network call entirely.
- `tests/unit/api-sets.updateSetMeta.test.ts` (new) — 7 cases covering rpe-only, rpe-clear (`null`), rpe-undefined short-circuit, full `{rpe, notes}`, notes-clear (`null`), empty patch, all-undefined short-circuit.
- `tests/unit/use-sets.useUpdateSetMeta.test.ts` (new) — 5 cases: invalidates only `["sets", sessionId]`, does NOT invalidate `["stats"]`, skips invalidation when the underlying API returns `null`, plus 2 cases for `useUpdateSet`'s null-tolerance (BLK-1 fix). Uses `MutationObserver` from `@tanstack/react-query` against a real `QueryClient` since `@testing-library/react-hooks` isn't installed.
- `tests/e2e/set-row-menu.spec.ts` (new) — Three Playwright specs: (1) RPE chip selection persists across reopen; (2) notes commit on dismiss and survive reopen; (3) BLK-1 regression — editing reps after setting RPE preserves the saved RPE.

## Deviations from design

- **Test count (MIN-10-v3)**: design-v3 table said "Six cases" for `tests/unit/api-sets.updateSet.test.ts` but the Test plan listed 7. Validator marked Test plan authoritative — landed 7. Resolving the v3 internal inconsistency in favor of the brief's explicit direction.
- **`patch-type` narrowing on `useUpdateSet` (MIN-11-v3)**: Validator noted `UpdateSetInput` was already idiomatic `{X?: T | null}`. Implemented as JSDoc-only on `UpdateSetInput` + `UpdateSetMetaInput` — no shape change, per Validator's recommendation.
- **`MoreHorizontal` icon styling**: design-v3 spec'd `text-blue-500 dark:text-blue-400` className. `lucide-react-native` icons take a hex `color` prop and ignore NativeWind className on the SVG itself (verified against existing usages — `CheckSquare`/`Square`/`Trash2`/`ChevronDown` all use `color="#hex"`, never className). Used `color="#3b82f6"` (blue-500) when meta data is present and `color="#9ca3af"` (gray-400) otherwise. Matches the existing notes-icon precedent at the now-removed `set-input.tsx:180`. Dark-mode tinting is intentionally omitted because the gray/blue tones read identically against both backgrounds (same call the codebase already makes for `Trash2` `#ef4444`). Documented inline.
- **`useUpdateSetMeta` test approach**: design Test plan referenced "@tanstack/react-query test harness". No `@testing-library/react-hooks` is installed in the repo. Used `MutationObserver` from `@tanstack/react-query` directly against a real `QueryClient`, mirroring the hook's `mutationFn` + `onSuccess` options. The behavior under test (invalidation surface, null-tolerance) is identical between the observer and the React-bound hook. Test file documents the rationale at the top.
- **`SetRowMenu` backdrop-dismiss wiring**: design-v2 specified backdrop tap fires `onClose`. To make the notes-commit-on-dismiss work consistently (the spec'd "notes commits on close" semantic), the backdrop Pressable wires to `commitNotesAndClose` — the same handler the X-button and `onRequestClose` use. Inner-card taps are intercepted by an inner `<Pressable onPress={() => {}}>` so a tap on the card itself doesn't bubble to the backdrop. No deviation from the spec's intent; just spelling out the no-op-inner-press shield.

## Soft callbacks made (during this implementation pass)

- None.

## Quality gates

- [x] `npm run typecheck` passed — clean (0 errors).
- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning in generated file `router.d.ts`.
- [x] Relevant unit tests pass — `npm run test:unit`: 13 files, **198 tests passed** (179 prior + 7 `updateSet` + 7 `updateSetMeta` + 5 `useUpdateSetMeta`). Brief expected ~190+.
- [x] No new `any` types.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log`.

## Notes for Reviewer / Tester

- **BLK-1 root-cause fix landed**: `updateSet` no longer clobbers `rpe`/`notes` columns when callers pass only `{reps, weight}`. The two existing callers (`app/(app)/workout/[sessionId].tsx` and `app/(app)/history/[id].tsx`) already forward `{reps, weight}` verbatim, so the v2 footgun is closed at the root with zero behavior change for any current caller. `tests/unit/api-sets.updateSet.test.ts` covers the regression directly; `tests/e2e/set-row-menu.spec.ts` Test 3 is the integration backup.
- **`["stats"]` asymmetry is intentional**: `useUpdateSet` keeps the `["stats"]` invalidation (reps/weight feed volume/PR stats); `useUpdateSetMeta` drops it (RPE/notes are not stat inputs). JSDoc on both hooks documents the divergence. Verified `src/api/stats.ts` SELECT excludes rpe/notes (per Validator audit).
- **Tester (existing suite)**: existing e2e specs (`crud.spec.ts`, `remove-exercise.spec.ts`, `soft-deleted-exercises-in-history.spec.ts`, `exercise-progress-ia.spec.ts`) don't touch the old inline RPE input or `Toggle set notes` label — verified by Discovery and confirmed during implementation. Should pass unchanged.
- **Tester (e2e gate)**: I did NOT run the e2e suite per the brief. The new `tests/e2e/set-row-menu.spec.ts` is ready but should be exercised by Tester against a running dev server with `.env.local` configured. The `aria-selected` attribute assertions rely on the chip Pressable's `accessibilityState={{ selected: ... }}` mapping to `aria-selected` on web via React Native Web. If that mapping has shifted in a recent RN Web release, the fallback is to check chip text + the `bg-emerald-500` class on the selected chip.
- **Follow-up debt** (logged, out of scope): trash icon tap-target inflation (`rounded p-1` ≈ 24pt, below the 44pt iOS HIG floor) — pre-existing on this row, unchanged here.

## I↔T r2 — Test harness fixes (round 2 of 2)

Tester returned `fail` on v1 with the BLK-1 fix verified working at the data layer (PATCH bodies + GET cache row confirmed via Playwright trace). The 3 failures were entirely inside the e2e harness — production code was unchanged in this round.

### Files changed

- `tests/e2e/set-row-menu.spec.ts` (edited, test-only) — two surgical fixes:
  1. **Lines 121-124 + 183-186 (v1) → swap `aria-selected` for `bg-emerald-500` class match.** React Native Web 0.21 does NOT translate `accessibilityState={{ selected }}` to an `aria-selected` HTML attribute on the rendered DOM element. The Tester's fiber-walking probe verified the chip *is* visually selected (the `bg-emerald-500` Tailwind class is on the element when the cache is fresh) — that class is the actual source of truth for "selected" in `<SetRowMenu>` (set-row-menu.tsx:183-184). Replaced both `toHaveAttribute("aria-selected","true")` calls with `toHaveClass(/bg-emerald-500/)`. The same `implementation.md:50` note from v1 foresaw this fallback verbatim. Added inline comments above each assertion explaining why we don't use `aria-selected` here.
  2. **Notes test (lines 142-156 v1) → await PATCH + GET round-trip before reopening.** The Tester trace showed the test closing the menu 11 ms after `fill()` and reopening it 28 ms after that, while the actual notes-write PATCH + cache-invalidation GET takes >300 ms. The menu re-mounted with stale `initialNotes = null` (mount-gated `useState` only seeds from props once — intentional design), so the textarea read empty. Armed two `page.waitForResponse` listeners *before* clicking Close — one for `PATCH /rest/v1/sets?id=eq.<uuid>` (the notes write), one for `GET /rest/v1/sets?...session_id=eq.<uuid>` (the cache refresh) — then `await Promise.all([...])` after the close, before reopening. URL filter patterns mirror the existing `soft-deleted-exercises-in-history.spec.ts:265-278` style (substring `includes` checks, method gate, no full regex).

### Why test-only and not source-side

Tester offered both routes and recommended the test-only path for both fixes. Reasons we agree:

- **Fix 1**: pushing `aria-selected={isSelected}` into `<Pressable>` works against RN-Web only by relying on unknown-prop pass-through, and would still leave the `bg-emerald-500` class as the visible signal. The class is already the design's source of truth — asserting on it matches user-visible reality. No production behavior changes either way.
- **Fix 2**: the race only triggers under bot-cadence (~40 ms between fill → close → reopen). Real users hit natural debounce. Adding `useEffect(() => setNotes(initialNotes ?? ""), [initialNotes])` would re-introduce the mid-edit cache-clobber footgun that v2-design explicitly rejected. Wrong tradeoff for the size of the bug.

### Deviations from Tester's brief

- None. Both fixes landed exactly as Tester described under "What the Implementer must change" → option 1 (test-only) for each.

### Quality gates (post-fix)

- [x] `npm run typecheck` — exit 0, clean.
- [x] `npm run lint` — `ESLint: 0 errors, 1 warnings in 1 files` (pre-existing `router.d.ts` warning, unchanged from v1).
- [x] `npm run test:unit` — 13 files, **198 tests passed** (unchanged from v1).
- [x] No new `any` types.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log`.
- [ ] e2e not run by Implementer (per brief — Tester will re-run on round 2).

### Notes for Tester (round 2)

- The `bg-emerald-500` Tailwind class is appended to the chip's `className` whenever `normalizeRpe(rpe) === normalizeRpe(initialRpe)` is true and `rpe != null`. After the cache settles, the Tester probe already confirmed it lands on the DOM. The class-match regex `/bg-emerald-500/` will tolerate the surrounding `css-view-…` prefix Playwright sees.
- The notes test now awaits both network legs before reopening. If the PATCH listener doesn't resolve, that's a real bug (the notes commit isn't firing); if the GET listener doesn't resolve, the invalidation isn't being triggered. Both 10s timeouts should be ample on a healthy dev server.
- BLK-1 evidence remains valid — production code untouched in this round.
