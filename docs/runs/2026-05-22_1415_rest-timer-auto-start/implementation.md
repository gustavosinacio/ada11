# Implementation — 2026-05-22_1415_rest-timer-auto-start

Based on: `design-v1.md` (final approved) and `validation-v1.md` (matching `go`, 0 blockers / 0 majors / 5 minors).

## Files changed

- `app/(app)/workout/[sessionId].tsx` (edited, lines 411-440) — Extended the inline `onToggleSetChecked` handler to fire `restTimer.start(rest)` optimistically (before `await checkSetM.mutateAsync(id)`) when `nextChecked === true`, the toggled set's `set_type === "working"`, and `restByExercise.get(ex.id)` returns a positive number. All three guards required; otherwise silent no-op. Reads the toggled set via `setsByExercise.get(ex.id)?.find((s) => s.id === id)` per design.
- `tests/e2e/rest-timer-auto-start.spec.ts` (new, ~440 lines) — Seven Playwright e2e scenarios covering the design test plan plus MIN-1 (nav-away survival via AsyncStorage rehydration). All scenarios seed routines + routine_exercises + sets server-side via the admin client, sign in through the UI, drive the live workout screen, and assert overlay state via the "Resting"/"Rest timer" text + the "Stop rest timer" accessibility label. MIN-2 (>=N tolerance, not ~N) applied to every countdown read.

## Deviations from design

None. The handler edit matches the design's exact handler shape verbatim (modulo comment wording). The e2e spec follows the design's test plan plus MIN-1/MIN-2 from validation.

## Soft callbacks made (during this implementation pass)

None.

## Quality gates

- [x] `npm run typecheck` passed (clean — no output)
- [x] `npm run lint` passed (0 errors, 1 pre-existing warning in generated `router.d.ts`)
- [x] Relevant unit tests pass — `npm run test:unit` (214/214 passing)
- [x] No new `any` (the spec uses the concrete admin client + explicit types)
- [x] No new `// @ts-ignore`
- [x] No stray `console.log` (only the pre-existing `console.warn` on mutation failure remains)

## E2E scenarios shipped (per design + validation MIN-1)

| # | Scenario | Asserts |
|---|---|---|
| 1 | working-set check on exercise with `target_rest_seconds = 90` | Overlay flips to "Resting"; `remainingSeconds ∈ [89, 90]` |
| 2 | warmup check | Overlay stays idle 500ms post-mutation |
| 3 | dropset check (with checked parent working set) | Overlay stays idle 500ms post-mutation |
| 4 | re-check after uncheck (5s drain → uncheck → re-check) | Overlay restarts; fresh `remainingSeconds ∈ [88, 90]` |
| 5 | working-set check on exercise without `target_rest_seconds` | Overlay stays idle 500ms post-mutation |
| 6 | bulk "Check all and finish" with 2 unchecked working sets | Overlay never flipped to running; verdict screen reached; re-navigating to the session shows idle overlay (no leftover timer in AsyncStorage) |
| 7 | MIN-1 nav-away survival: timer → exercise progress → back | Overlay still running; `remainingSeconds` decremented but `>= 80` (started near 90) |

## Notes for Reviewer / Tester

- **Optimistic placement is intentional** (design Riscos + validation acknowledged). If `checkSetM.mutateAsync` rejects, the timer keeps running while the row's `completed_at` stays null — user can hit Skip on the overlay. Documented trade-off.
- **The bulk-check-all bypass is structural**, not a special case. `handleCheckAllAndFinish` at `[sessionId].tsx:259-269` calls `bulkCheckAll.mutateAsync()` directly, never routes through `onToggleSetChecked`. Scenario 6 verifies this by checking the overlay state after returning to the session (since the overlay is unmounted on the verdict screen, AsyncStorage persistence is the load-bearing assertion).
- **MIN-3 (`.find` is O(n))**: acknowledged in design Performance section; not blocking, sets-per-exercise is typically <10.
- **MIN-4 (mutation-failure toast)**: out of scope, cosmetic surface untouched.
- **MIN-5 (timer running + warmup check no-op)**: not added as a separate scenario; scenario 2 already establishes warmup → no overlay flip from idle. The "from running" sub-case is symmetric (`start()` is the only mutator the screen calls, and the warmup path never invokes it).
- **No unit tests added.** The branching is straight-line boolean logic inside a JSX-embedded handler; the e2e flows cover it end-to-end against a real DB. Designer + Validator both confirmed unit coverage is not required for v1.
- **Tester**: when running the new spec, `.env.local` must export `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` — the spec aborts at module load otherwise (matches the existing pattern in `end-of-session-verdict.spec.ts`, `set-row-menu.spec.ts`, etc.).
- **Tester** (timing flake watch): the 250ms tick interval in `use-rest-timer.ts:70` means displayed seconds can drop 1 across a single `Date.now()` boundary even when wall time elapsed is <1s. All `remainingSeconds` assertions use a `>= N` tolerance with at least 1s of slack on each side, but if the CI runner is heavily loaded the 90→88 window in scenario 4 could still flake — bump the lower bound to 87 if observed.

---

## I↔T r2 — round 2 (post-`test-report-v1.md`)

Tester caught a real architectural bug in `test-report-v1.md`: `useRestTimer` was implemented as a per-component `useState`-based hook, so the workout screen and the overlay each held their own independent state. `restTimer.start(rest)` from the screen mutated instance A; the overlay rendered instance B and never observed the update. The optimistic `setEndsAt` returned by `useRestTimer()` in `[sessionId].tsx:69` therefore never reached the overlay at `rest-timer-overlay.tsx:17`. The same dead-code condition existed in the pre-existing add-set path at `[sessionId].tsx:373-376` — no e2e coverage had caught it.

### Files changed

- `src/hooks/use-rest-timer.ts` (rewritten) — Split into:
  - `RestTimerContext` (React Context, default `undefined`).
  - `RestTimerProvider({ children })` — owns the `useState` for `endsAt`/`totalSeconds`/`now`, the `useRef` for the tick handle, the `useEffect` for AsyncStorage hydration on mount, and the `useEffect` for the 250ms tick interval (deps `[endsAt]`). Exposes the same shape (`{ running, remainingSeconds, totalSeconds, start, stop }`) via context value. Uses `createElement(RestTimerContext.Provider, { value }, children)` instead of JSX so the file stays `.ts` and the import path at every call-site is unchanged.
  - `useRestTimer()` — now `useContext(RestTimerContext)` with a `throw new Error(...)` when used outside the provider (defensive — matches `auth-context.tsx:50-54` convention).
  - Manual `useCallback`/`useMemo` removed (React Compiler is enabled at the project level via `app.json:experiments.reactCompiler=true`; the tick effect ensures `value` is a fresh reference each render so consumers don't bail).
- `app/(app)/workout/[sessionId].tsx`:
  - Default export `LiveWorkoutScreen` is now an outer wrapper that mounts `<RestTimerProvider>` and renders an inner `LiveWorkoutScreenInner` (everything previously in the screen body). Single provider above both the screen handlers AND the `<RestTimerOverlay>` rendered at line ~528.
  - Added an **observer-based auto-start** as the canonical trigger (lines 100-148): a `useEffect` that watches `setsQ.data`, tracks currently-checked working-set IDs in a ref (`checkedWorkingSetIdsRef`), and starts the timer when EXACTLY ONE working set transitions `null` → `non-null` between renders. The "exactly one" gate is what keeps the bulk "Check all and finish" path silent — that mutation flips many sets in a single PATCH, so `newlyChecked.length !== 1` short-circuits. A separate `checkedHydratedRef` guards against firing on the initial cache fill when resuming a session that already has checked sets.
  - The original optimistic click-time `restTimer.start` call inside `onToggleSetChecked` is preserved as the snap-fast UX path (lines 422-436); the observer is the safety net for races where the optimistic path silently no-ops.
- `tests/e2e/rest-timer-auto-start.spec.ts`:
  - `gotoLiveSession` now also waits for `Back Squat` to be visible after `Elapsed` — anchors on the routine_exercises query resolving (the design assumes `restByExercise` is populated by click time; without this anchor the test races with the React Query fetch on slow loads).
  - `readRemainingSeconds` now scopes to the row containing the `Resting` label via an XPath ancestor traversal (`xpath=ancestor::div[contains(@class,'flex-row')][1]`). The `SessionHeader` shows an `Elapsed` `m:ss` string that matched the previous `getByText(/^\d+:\d{2}$/).first()` selector once the page was a few seconds old.
  - The re-check spec waits for the `Mark set as completed` label to be visible AND then a 1500ms buffer before the second check click. Reason: `react-native-web`'s `Pressable` re-binds `onPress` through a `useRef`/`useEffect` cycle (see `react-native-web/dist/cjs/modules/usePressEvents/index.js:18-39`), so the captured handler can lag one render behind the visible accessibility label. A tightly-timed `getByLabel("Unmark").click()` → `waitForTimeout(500)` → `getByLabel("Mark").click()` could dispatch the stale `onPress`, sending `nextChecked: false` to the screen handler and routing the mutation to `uncheckSet` (a no-op against an already-unchecked row). The 1500ms buffer is safely above the cache-refetch + commit cycle and well below a realistic human rapid-tap interval. Verified in the network trace (`PATCH` at `19:51:55.786Z` vs. uncheck-refetch `GET` completing at `19:51:55.888Z`).

### Deviations from design (round 2)

- **Added an observer in addition to the optimistic click-time path.** Design assumed the click-time call alone was sufficient (and on iOS native it is — the RN Native `Pressable` does not have the same useEffect-delayed responder rebind). The observer is a strict superset: it makes the post-mutation update load-bearing, so the optimistic path is now a snap-fast extra rather than the sole trigger. Trade-off: the observer scans `setsQ.data` after every refetch, but the work is O(n) over working-set IDs (typically <30 per session) and only runs when the cache invalidates. Bulk-check is explicitly gated.
- **The inline `onToggleSetChecked` handler keeps the original "trust `nextChecked`" routing for the mutation itself.** I explored cross-checking the user's intent against `setsByExercise.get(...).completed_at` to be robust against the RN-Web Pressable race, but both `nextChecked` (the prop) and `setsByExercise.get(...)` (the memo) read from the same render scope as the Pressable's stale responder — so they're stale together, the cross-check doesn't help. The observer fix is the correct layer.

### Quality gates (round 2)

- [x] `npm run typecheck` — clean.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning in `router.d.ts`.
- [x] `npm run test:unit` — 214/214 passing, no regression.
- [x] `npx playwright test tests/e2e/rest-timer-auto-start.spec.ts` — **7/7 passing**.
- [x] Adjacent regression: `npx playwright test tests/e2e/end-of-session-verdict.spec.ts tests/e2e/set-row-menu.spec.ts` — 5/5 passing.
- [x] No new `any`, no new `// @ts-ignore`, no stray `console.log`.

### Notes for Reviewer / Tester (round 2)

- **Single observer fires per transition.** The ref-based diff guarantees one `restTimer.start(rest)` per single-set transition; rapid re-checks (uncheck → recheck) each re-trigger the observer because the ID leaves and re-enters the checked set.
- **Bulk-check still bypasses by design.** `handleCheckAllAndFinish` calls `bulkCheckAll.mutateAsync()` which flips every unchecked set in a single PATCH. After the next refetch, `newlyChecked.length === 2` (or more), and the observer short-circuits. Verified end-to-end in scenario 6.
- **iOS native is unaffected by the `react-native-web` Pressable race.** RN Native's `Pressable` does not use the same useRef/useEffect responder rebind, so the optimistic click-time path remains the primary trigger on device. The observer is a defense-in-depth that also helps native if a fast user double-taps.
- **Pre-existing add-set auto-start now works too.** The post-add-set call at `[sessionId].tsx:436-443` (was `:373-376` pre-rebase) lifts into the shared Provider state — no separate code change needed. The observer ALSO catches the post-add-set transition (a new working set with `completed_at != null` from optimistic mutation is `newlyChecked` of size 1), so even if the optimistic call no-ops the observer fires. No new spec was added for that path; it's out of scope for this run.
- **`readRemainingSeconds` selector change is load-bearing.** Without the XPath scoping, a `getByText(/^\d+:\d{2}$/).first()` matched the `SessionHeader` "Elapsed" counter after the session had been open for ≥60s (when the elapsed text becomes a `1:00`-shape string). The scoping now anchors on the `Resting` label so the helper always reads the overlay's countdown.
