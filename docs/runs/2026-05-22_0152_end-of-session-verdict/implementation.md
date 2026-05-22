# Implementation — 2026-05-22_0152_end-of-session-verdict

Based on: `design-v2.md` (final approved) and `validation-v2.md` (`go`).

## Files changed

### New

- `app/(app)/workout/verdict/[sessionId].tsx` (new) — One-shot verdict screen mounted via `router.replace` from `finishAfterMutation`. Renders the `+N PRs · Y kg · Zh Wm` headline, PR list (with skeleton while lifetime refetch is in-flight), zero/non-zero empty-state copy, and sticky Done button. Reads from already-warm caches: `useSession`, `useSetsForSession`, `useAllExercises`, `useLifetimeWeeklyVolume`. No mutations.
- `src/utils/session-verdict-math.ts` (new) — Pure helpers: `computeCurrentSessionVolumeByExercise` groups `SetRow[]` by `exercise_id` and reduces each group via the shared `sumLiveVolume` kernel (MIN-1 — no duplicated predicate). `computePrsForSession` filters lifetime rows by `session_id !== currentSessionId`, runs `computeLifetimeMaxPerExercise`, then emits `SessionPr[]` for each exercise with strict `current > priorMax && priorMax > 0`, sorted by `overflowKg` DESC with `exerciseId` ASC tiebreaker.
- `tests/unit/session-verdict-math.test.ts` (new) — 21 unit cases covering both helpers (cases #1-#20 mirror v1's plan; case #21 is the new MIN-1 reuse-faithfulness check confirming the per-(exercise_id) sum equals `sumLiveVolume` restricted to that exercise's rows).
- `tests/e2e/end-of-session-verdict.spec.ts` (new) — Two e2e cases. Case A (finish-with-PR via bulk-check-all): seeds prior 500 kg bench, logs unchecked 600 kg current bench, opens ChooseActionModal → "Check all and finish" branch, asserts verdict URL, headline contains `+1 PRs` AND `600 kg` (load-bearing MAJ-2 regression guard — would render `0 kg` pre-fix), PR row `+100 kg (was 500 kg)`, Done → `/workout$`. Case B (finish-with-no-sets): empty session, Finish → verdict, headline `0 PRs · 0 kg`, zero-volume empty-state copy "No sets logged — your next session counts.", no PR pill, Done → `/workout$`. Each case registers `page.on("dialog", d => d.accept())` BEFORE the first Finish click (MIN-2).

### Edited

- `app/(app)/workout/[sessionId].tsx:229` (edited) — `finishAfterMutation` now `router.replace`s to `/(app)/workout/verdict/${sessionId}` instead of `/(app)/workout`. Single line covers all three Finish branches (zero-unchecked, check-all, discard-unchecked) since they all funnel through the helper.
- `src/utils/volume-target.ts:78` (edited) — Added `export` keyword to the previously module-private `sumLiveVolume`. One keyword, no signature or behavior change. Reused by `session-verdict-math.ts` (MIN-1) and directly by the verdict screen for the total-volume headline.
- `src/hooks/use-sets.ts:115-126` (edited) — `useBulkCheckAllInSession.onSuccess` switched from fire-and-forget `qc.invalidateQueries` to `async`/`await qc.refetchQueries({ queryKey: KEYS.forSession(sessionId) })`. Makes the mutation's `mutateAsync` Promise resolve only AFTER the sets cache is fresh. Fixes MAJ-2 — the verdict no longer reads pre-bulk-check sets and under-counts volume. Sole caller (`[sessionId].tsx:257-267` `handleCheckAllAndFinish`) benefits transparently with no caller change.
- `tests/e2e/crud.spec.ts:184-194` (edited) — The `"workout: start ad-hoc, finish, see in history"` test post-Finish flow now waits for `/workout/verdict/`, asserts `0 PRs` headline (load-bearing — without it a race could resolve the next URL wait before the verdict actually rendered), taps "Done", then asserts `/workout$`. Existing `page.on("dialog", d => d.accept())` at line 184 preserved.

## Deviations from design

None of substance. Two micro-decisions worth surfacing:

- **PR-row sub-line copy.** Design v2 (page-composition copy delta) keeps v1's `+X kg (was Y kg)` shape but doesn't pin a leading word. I prefixed it with `PR! ` so the row reads `PR! +100 kg (was 500 kg)`, matching the in-session live-strip celebration (`volume-target-slot.tsx:117` — `"New PR! +X over your previous"`) for continuity. The `PR` emerald pill on the same row already signals the achievement, so `PR!` is mild reinforcement, not redundancy. The e2e Case A assertion looks for the substrings `+100 kg` and `(was 500 kg)` separately, so the prefix is non-load-bearing for the test.
- **Verdict error-state fallback.** Design v2 inherits v1's "render the inline error pattern as `[sessionId].tsx:316-326` plus a Done button so the user isn't trapped". My implementation does exactly that — a centered red error message plus a `<Button label="Done" />` that replaces back to `/(app)/workout`. No deviation, but flagging for the Reviewer to confirm the visual treatment matches what they expect for the soft-deleted-session deep-link edge case.

## Soft callbacks made (during this implementation pass)

None.

## Quality gates

- [x] `npm run typecheck` passed — clean.
- [x] `npm run lint` passed — 0 errors, only the pre-existing `router.d.ts` warning (1 issue, untouched by this run).
- [x] Relevant unit tests pass — `npm run test:unit` → 179 passed (158 prior + 21 new from `session-verdict-math.test.ts`). Matches the design's expected count exactly.
- [x] No new `any` — verified by grep on the four new/edited files.
- [x] No new `// @ts-ignore` — verified by grep.
- [x] No stray `console.log` — verified by grep on new files. The pre-existing `console.warn` calls in `[sessionId].tsx` are untouched.

## Known notes (from Validator v2, minors not blocking)

Surfaced verbatim from `validation-v2.md` so the Reviewer/Tester can confirm or escalate:

- **MIN-1-v2** Optional unit cases 22-23 (hook-level test for the awaited-refetch contract) **skipped**. The user's spec marked them optional and pointed at E2E Case A step 10's `600 kg` assertion as the load-bearing MAJ-2 regression guard. Honored — Case A has that assertion at the headline level.
- **MIN-2-v2** Optional E2E Case C (non-zero-volume no-PR copy) **skipped**. Unit tests cover the copy-selection ternary (`totalVolumeKg === 0` switch); the design v2 plan also marked Case C as optional.
- **MIN-3-v2** Eager `+0 PRs` is briefly wrong for ~200ms when there IS a PR (lifetime read still in flight). Acknowledged tradeoff documented in design v2:215. Implementation follows the eager-headline rule via `useMemo` short-circuit on `lifetimeQ.data === undefined → prs = []`.
- **MIN-4-v2** Latency uptick in `handleCheckAllAndFinish` from the awaited refetch (~50-200ms). Hidden behind the existing Finish spinner. Per design — acceptable.
- **MIN-5-v2** Verdict imports math from 3 modules (`session-verdict-math`, `volume-target`, transitive `progress-page-math`). Polish-only; no consolidation done.

## Notes for Reviewer / Tester

- The MAJ-2 fix (`useBulkCheckAllInSession.onSuccess` awaited refetch) changes the mutation hook's external contract: `mutateAsync()` now resolves AFTER the sets cache is refreshed. Sole caller is `handleCheckAllAndFinish` (verified by Validator v2's grep). If a future caller relies on fire-and-forget semantics for performance, it would need to opt out — none exists today.
- The verdict screen is reachable via deep-link (`/workout/verdict/<sessionId>`) and is idempotent against the persisted session — refreshing the page or sharing the URL renders correctly because the option-(c) `session_id !== currentSessionId` filter works regardless of whether the current session's rows are already in the lifetime read. Reviewer please confirm this is the intended behavior (design v1/v2 explicitly allowed it).
- E2E Case A's `600 kg` headline assertion is the load-bearing MAJ-2 regression guard. If the Tester sees this fail with `0 kg`, the `use-sets.ts` `awaited refetch` change has been reverted or shadowed.
- E2E specs use the existing admin seeding pattern from `volume-target.spec.ts` (admin client + `seedFinishedSession` / `seedLiveSet` / `gotoLiveSession` helpers). Cache purge via `window.localStorage.removeItem("ada11-query-cache")` is required so TanStack refetches cold after seeding.
- `formatDuration` is imported from `~/utils/format-session-times` (the existing public helper); the private copy in `session-summary-row.tsx` is intentionally NOT touched per MAJ-1 v2 resolution. The `"—"` null-end fallback is unreachable in the verdict path because `useFinishSession.onSuccess` synchronously cache-seeds the row with `ended_at` set.
