# Regression report — 2026-06-01_0941_session-finish-exercise-order

> Regression Tester, round 1 of 2 (Implement ↔ Regression). Verdict: **PASS**.
> Baseline `5985c57`; fix in the working tree (uncommitted); migration `0019`
> applied to the live Supabase project by the Conductor (column verified present
> below). All e2e ran against the live backend on the web build.

## Environment
- Build: Expo web dev server (`npm run web` @ `localhost:8081`, started by me) + live Supabase project `ykrbgpctbfvndxjnpzrg`.
- Test data: ephemeral confirmed users seeded per-test via the service-role admin client (`read-only-history.spec.ts` pattern), each deleted in a `finally`. RLS probe used two anon-key user clients (owner + attacker), self-cleaned.
- Run conditions (per the prior-run noise lesson): `workers: 1`, one spec file at a time, paced. No `createConfirmedUser` 5xx, no setup-phase `waitForURL` timeouts observed across ~20 spec runs.

## Automated checks
| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **pass** — exit 0, "No errors found". The 29 pre-existing `TS18048/TS2322` errors the Implementer noted in the Reproducer's throwaway `repro-probe*.ts` are gone (those probes were removed — `state.md:28`). |
| Lint | `npm run lint` | **pass** — 0 errors, 1 warning (the pre-existing auto-generated `.expo/types/router.d.ts` warning; baseline-unchanged). |
| Unit tests | `npm run test:unit` | **pass** — **455/455** (28 files), incl. the new `session-exercise-order.test.ts` (11/11). Matches `implementation.md:43`. |
| Web export build | `npx expo export --platform web` | **pass** — exit 0, "Exported: dist", **3150 modules** bundled. (`dist/` removed after.) |

**Build-smoke note (backstop of an Implementer-deferred gate):** the Implementer explicitly did NOT run `expo export` (`implementation.md:44`) because it needs the `session_exercise_order` column to exist. The column now exists (migration `0019` applied), so I ran it. It bundles cleanly — the new `select("*")`-read of the column in `history/[id].tsx`, the `finishSession`/`updateSessionExerciseOrder` writes in `sessions.ts`, the new `useUpdateSessionExerciseOrder` hook, the `uuid[]` Drizzle column, and the new `orderExerciseIds` helper all compile through the bundler that the typechecker doesn't fully exercise.

**Live-DB column confirmation:** an admin `select("id, session_exercise_order")` succeeds on `sessions`; a pre-existing legacy row returns `session_exercise_order: null` — confirming the additive nullable `ADD COLUMN` applied and no-backfill behavior (legacy rows stay NULL). `getSession`/`select("*")` still returns valid rows.

**`uuid[]` ↔ `string[]` round-trip (the headline Implementer TODO):** confirmed end-to-end. e2e (2) and (3) write a `string[]` via the reorder mutation and `readSessionOrder()` reads it back as a JS `string[]` equal to the expected id array (e.g. `[A,C,B]`) — the persist assertion passes on every run. The `jsonb` fallback was not needed; the `uuid[]` decision holds (matches the proven `exercises.muscles text[]` precedent).

## Replay of original reproduction

**`repro.md` symptom: History rendered exercises in a DIFFERENT order than the live screen, driven by the unspecified `set_number` tie-break (physical set-insertion order).**

Replayed via `tests/e2e/session-exercise-order.spec.ts` (authored by the Implementer; RUN by me post-migration). The seed inserts sets in physical order **C, A, B** in every case, so a tie-break-derived render would show C,A,B — the bug. The three session shapes the fix-plan calls out:

| Shape | e2e | Observed | Verdict |
|---|---|---|---|
| **Routine / persisted-order session** (`[A,B,C]` persisted, sets inserted C,A,B) | test (1) | History renders **A above B above C** (the persisted order), NOT the C,A,B insertion order. Passed **every run** (full-file A/B, isolation). | **GONE** |
| **Ad-hoc session** (B's set logged before A — modelled by the same physical-insertion-≠-persisted-order seed) | tests (1)/(3) | persisted order wins over insertion order. | **GONE** |
| **Manually-reordered session** (reorder via chevrons in History edit → persist) | tests (2)/(3) | the reordered array persists and governs the render. | **GONE** |

**Result: the original symptom no longer reproduces.** History now orders by the persisted `session_exercise_order` (with the deterministic first-occurrence fallback for legacy NULL), not the tie-broken set query. The read-side (`orderExerciseIds`) is unit-tested 11/11 and the screen wiring (`derivedOrderIds → effectiveOrderIds → renderedExercises`, `history/[id].tsx:142-171`) renders by it.

**Evidence (e2e test (1) — the canonical replay, passed 100% across all runs):**
```
PASS :: (1) History renders the PERSISTED order, not the set-insertion tie-break [passed]
  (sets inserted physically C,A,B; persisted [A,B,C]; assert yA < yB < yC — i.e. the
   persisted order wins, not the insertion tie-break)
```

## Reorder feature + legacy-session recovery

- **Chevrons appear ONLY in edit mode:** e2e (2) asserts the read-only view has `count(0)` of `Move <name> up/down`; after tapping the Pencil ("Edit workout"), chevrons appear (`count(1)`). Pass.
- **Each tap persists (uuid[] round-trip):** e2e (2)/(3) move an exercise, then `readSessionOrder()` returns the exact expected id array (e.g. `[A,C,B]`) — the persisted `session_exercise_order` equals the expected `uuid[]`. This assertion passed on **every** run (it precedes the flaky reopen-render step described below).
- **Legacy-session recovery (NULL → uuid[]):** e2e (2) seeds a session with the column `NULL` (`readSessionOrder == null` asserted), renders the fallback order, enters edit, moves A up, and the column persists from `NULL → [A,C,B]`. The write succeeds on every run. **Working.**
- **Within-exercise set order unchanged:** e2e (3) asserts 3 weight inputs before AND after a reorder — set count/order intact (`set_number` ASC preserved; `setsByExercise` untouched, `history/[id].tsx:190-198`). The prior "checked set bubbles above unchecked" fix stays in place. Pass.

**One flaky e2e assertion — investigated, attributed to a TEST-HARNESS artifact, NOT a fix defect.** e2e (2)'s final step reopens the session via `page.goto` (same browser context) and immediately asserts the persisted `[A,C,B]` render. This step **intermittently** fails (passed: 3/3 in isolation, full-run A; failed: full-run B, the first full run — same line 273 `toBeLessThan`, same values yA=391/yC=229 = the stale legacy order). Root cause, proven empirically:
- The column WRITE is correct — the `readSessionOrder == [A,C,B]` assertion (line 256) passes on **every** run before line 273 is reached.
- The app uses `PersistQueryClientProvider` (7-day `maxAge`, AsyncStorage→localStorage persister — `app/_layout.tsx:41-46`, `src/lib/query-client.ts:19`). On `page.goto` reopen within the SAME browser context, localStorage survives, so the persisted React Query cache **rehydrates the pre-reorder `session.data` (legacy order) synchronously on mount** before the invalidation-triggered background refetch lands. The test reads the first stable paint and can catch the stale rehydration in the race window.
- **Proof:** I built a throwaway copy of test (2) that wraps the reopen assertion in Playwright `expect(...).toPass({timeout:15s})` (poll until the refetch resolves). It passed **3/3** — i.e. the persisted order DOES render on reopen once the cache settles. (A second throwaway that `localStorage.clear()`-ed before reopen over-cleared auth and was discarded.) Both throwaways were deleted and the tree re-verified clean.
- **Conclusion:** the legacy-recovery feature works (write correct, read honors the column once the persisted-cache rehydration resolves). The flaky assertion is the e2e reading the first paint without tolerating the app's known cache-rehydration race on reopen. This is a robustness gap in the assertion, not in the fix — flagged for the Conductor as a follow-up to wrap that one reopen assertion in `toPass` (matches the pattern the spec already uses elsewhere, e.g. lines 248-252, 309-313). It does NOT count against the fix.

## Adjacent regression checks
- **`read-only-history.spec.ts` (the sibling History detail read/edit screen — the most directly-shared code path):** **pass — 5/5.** Read-only default (no inputs/affordances), Pencil→Done toggle, edited-value persistence (MAJ-2 blur path), per-screen edit scope all intact. The screen the fix modified most heavily is unregressed.
- **`end-of-session-verdict.spec.ts` (PR list + the modified Finish write path):** **pass — 2/2.** Case A (finish-with-PR via bulk-check-all) exercises the `finishSession({ id, exerciseOrder })` snapshot write; Case B (zero-set Finish) confirms the empty-list Finish path completes without error and (per the diff, `sessions.ts:17-21`) OMITS the column key so it does not clobber. Verdict PR list order-independent, unchanged.
- **`progress-page.spec.ts` (aggregates — group by exercise_id):** **pass — 8/8.** Hero, bars, list, streak, PR badge, per-row nav, 5-tab regression all render unchanged.
- **`e1rm-strength.spec.ts`:** **pass — 3/3.** e1RM lines (order-independent) unchanged; bodyweight-only produces no line.
- **`weekly-muscle-volume.spec.ts`:** **pass — 4/4.** Per-muscle chart + check-all toggles unchanged; volume numbers order-independent, unaffected.
- **`remove-exercise.spec.ts` (the SHARED `<ExerciseBlock>` component — the fix now wires its chevron props in History edit mode too):** **pass — 2/2.** The live screen's use of the same component (remove-with-sets, remove-without-sets, empty state, history-hides, cancel) is unregressed — adding reorder props to the History edit-mode block did not change the component's existing behavior.
- **RLS (new write path — `updateSessionExerciseOrder`):** **pass.** Two-user probe (owner seeded `session_exercise_order: [exId]`; attacker signed in via anon key): attacker READ returned **0 rows** (`BLOCKED`); attacker UPDATE affected **0 rows** and the owner's column was verifiably **unchanged**. The new reorder UPDATE inherits `sessions`' `auth.uid() = user_id` policy for both SELECT and UPDATE — no new policy needed, no cross-user read or write.

## Pre-existing failures (out-of-scope, NOT attributable to this fix)
- **`chart-scroll-week-selector.spec.ts`: 2/4 fail** ("default mount … current-week visible" and "default mount on narrow viewport" — both `toBeVisible` on the chart-strip mount). **Confirmed pre-existing** per the contract: I `git stash`-ed the fix code files (reverting to baseline `5985c57`) and replayed the spec — it failed the **same 2 tests with the same error** against baseline. Then `git stash pop` restored the fix (tree re-verified). These touch the Progress chart-strip, a screen this fix does not modify in any file (the diff is History detail / workout finish / sessions API+hooks / db schema+types / the new helper+migration). Out-of-scope.

## Code-level confirmation
| File | Behavior | Verified |
|---|---|---|
| `src/utils/session-exercise-order.ts` | `orderExerciseIds` — persisted-order-with-fallback | 11/11 unit + read-side render correct (e2e 1) |
| `app/(app)/history/[id].tsx:103-188` | read by persisted order; `moveExercise` per-tap persist; chevrons edit-mode-only | e2e 1/2/3 + read-only-history 5/5 |
| `src/api/sessions.ts` | `finishSession(id, exerciseOrder?)` writes-or-omits; `updateSessionExerciseOrder` parameterized | verdict 2/2 + RLS probe + diff-scan |
| `supabase/migrations/0019_session_exercise_order.sql` | additive nullable `uuid[]`, no backfill | live column present; legacy rows NULL |

## Out-of-scope confirmation (per `fix-plan-v2.md` §"Out of scope")
- Stale comments in `src/utils/volume-target.ts` — untouched (doc-only follow-up). Volume aggregates pass 8/8.
- Live mid-session reorder persistence — still snapshot-at-Finish only; live screen unchanged (verdict Finish path passes).
- Read-only History chevrons — confirmed ABSENT (e2e 2 asserts count 0).
- Drag-and-drop — not added (chevrons only).
- Remove-exercise control in History — confirmed not present/not added; the live-screen remove path (shared component) still passes 2/2.
- Auto-backfill of historical sessions — none; legacy rows read NULL (confirmed live) and recover only on manual reorder.
- Pruning never-logged added-exercise ids — covered by the helper's "ignore stale ids" unit case (passes).
- `listSetsForSession` sort (`set_number` ASC, within-exercise) — untouched; e2e 3 confirms set order/count intact after a reorder.

## Security re-check
`security_relevant: no`, carried from `diagnosis.md` → `fix-plan-v2.md:3, 286-287` and re-assessed there for the v2 new write path (no new endpoint, no auth-path change, no credential handling, no untrusted-input acceptance — the array is the user's own owned `exercise_id`s, RLS-scoped). The full security checklist is therefore skipped per contract. Two confirmatory gates run anyway (above-bar diligence):
- **RLS cross-user read+write** (the gate `fix-plan-v2.md:287` designated as the bar): **BLOCKED** for both read and write — see Adjacent checks. Pass.
- **Confirmatory diff-scan of shipped code:** zero `SERVICE_ROLE`/`service_role`/`sb_secret`/`eval(`/`.raw(`/`child_process` tokens in the shipped diff or the new `session-exercise-order.ts`. The new write path uses the supabase-js query builder (`.update({ session_exercise_order: order })`) — parameterized, no string concatenation. The `no` holds against the shipped code.

## Manual verification checklist (UI/ordering bug — owner eyeballs on web + one native run)
This is an ordering/visual bug; the data-level + e2e evidence is strong, but the owner asked for pixels eventually. On the deployed web build (and ideally one native run):
1. **Routine session matches live order:** start a routine workout (≥2 exercises, e.g. Squat → Bench → Deadlift), log a set per exercise in any order, tap Finish → open it in History → confirm History shows the SAME top-to-bottom order as the live screen.
2. **Reorder persists:** open any finished session in History → Pencil (edit) → tap an up/down chevron to move an exercise → exit edit, navigate away, reopen → confirm the new order STICKS. (On a real device with a warm cache, give the screen a beat to refetch on reopen — the order resolves to the persisted one; this is the only spot the e2e showed a first-paint race.)
3. **Legacy session recovers:** open a session finished BEFORE this change (column NULL) → reorder it once in edit mode → reopen → confirm it now holds a stable order.
4. **Edit-mode boundaries:** first exercise's "up" and last exercise's "down" are disabled; the read-only (non-edit) view shows NO chevrons; within-exercise set rows keep their order after a reorder.
5. **Add-exercise still works** in History edit and the added exercise is reorderable (appears appended, then movable).

A History-order screenshot was not captured in this run (the e2e asserts vertical Y-ordering programmatically, which is stronger than a single fragile permutation screenshot); the owner can capture one during step 1 above if pixels are wanted for the record.

## Decision

**pass** — recommend **finalize**.

Reasoning:
- All four static gates green (typecheck 0, lint 0 errors, unit 455/455, web export 3150 modules) — including the `expo export` gate the Implementer deferred, which I backstopped after the column was applied.
- The original symptom is **GONE** across all three session shapes (routine/persisted, ad-hoc, manually-reordered): History now orders by the persisted `session_exercise_order`, proven by e2e (1) passing 100% and the unit-tested read helper.
- The v2 reorder feature works: chevrons are edit-mode-only, each tap persists the full `uuid[]` (round-trip confirmed against the live DB), and the **legacy NULL→uuid[] recovery write succeeds on every run**.
- **0 adjacent regressions:** read-only-history 5/5, verdict 2/2, progress 8/8, e1rm 3/3, weekly-muscle 4/4, remove-exercise 2/2; RLS cross-user read AND write blocked.
- **Limitations / flags for the Conductor (non-blocking):**
  1. e2e (2)'s reopen-render assertion is flaky due to the app's `react-query-persist-client` cache-rehydration race on `page.goto` reopen (NOT a fix defect — write is correct, render resolves once the refetch wins; proven via a `toPass`-wrapped throwaway). Suggest wrapping that one assertion (spec lines 270-274) in `expect(...).toPass(...)` to match the spec's own pattern. The feature is correct.
  2. `chart-scroll-week-selector.spec.ts` 2 failures are pre-existing (confirmed via baseline replay), out-of-scope.
  3. Owner to run the manual checklist on the deployed build (and one native run) for final pixel confirmation.

## Post-deploy manual verification (filled in after user confirms)
- Verified by user on <environment>: <pass | fail>.
- Confirmation timestamp (BRT): <YYYY-MM-DD HH:mm>.
- User statement: "<verbatim>"
