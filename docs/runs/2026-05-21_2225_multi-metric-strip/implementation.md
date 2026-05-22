# Implementation — 2026-05-21_2225_multi-metric-strip

Based on: `design-v1.md` (final approved) and `validation-v1.md` (matching `go`, 0 blockers / 1 major / 7 minors).

## Files changed

- `src/utils/volume-target.ts` (edited) — Split the internal `sumVolume` into two named helpers: `sumPastVolume` (no completion filter — past sessions are loaded by `listSetsForExercise` and are implicitly all committed) and `sumLiveVolume` (filters `completed_at != null` before the warmup/guard predicates). `computeVolumeTarget` now calls `sumPastVolume` over each `pastSessions[i].sets` and `sumLiveVolume` over `currentSessionSets`. Public `VolumeTargetState` union, `ComputeVolumeTargetInput`, and the exported function signature unchanged. JSDoc on `sumPastVolume` documents the deliberate past-vs-live asymmetry (MIN-3).
- `src/components/volume-target-slot.tsx` (edited) — `chasing` branch render swapped from `"Volume to PR: X kg · ≈ R reps @ Wkg"` to `"Max X kg · Now Y kg · To PR Z kg · ≈ R reps @ Wkg"`. Three inline bold spans, single `Text` row, middle-dot separators (matches `session-summary-row.tsx:56-65` precedent). `showRepsClause` gained a third predicate `state.runningKg > 0` (MAJ-1 fix per validator option c — suppresses the misleading `"Now 0 kg · ≈ 10 reps @ 100 kg"` render when only drafts are present). `accessibilityLabel` updated to read all three numbers; folded in the MIN-5 collapse (3 sentences, comma-joined, not 4 — same information, ~25% shorter). `no-pr` and `surpassed` branches untouched.
- `tests/unit/volume-target.test.ts` (edited) — Stamped `completed_at: "2026-05-21T10:05:00Z"` (or a sibling minute-offset timestamp) on every `mkSet` call in the chasing/surpassed/warmup tests whose volume must count toward `runningKg` under the new checked-only semantics (10 stamping edits). Added a new `describe("computeVolumeTarget — checked-only running volume")` block with 5 tests: drafts excluded, all-checked sums, draft-still-drives-currentWeightKg (Decision #8), warmup-still-excluded-when-checked, and the MIN-4 chasing→surpassed transition via check-toggle. Unit-test count went from 13 → 18.
- `tests/e2e/volume-target.spec.ts` (edited) — Stamped `completedAt: new Date().toISOString()` on every `seedLiveSet` call whose volume must count: golden-path phases B/C/D (3 sets), tie case loop (3 sets), MAJ-1 set #1. Replaced literal `"Volume to PR:"` text selectors with `/To PR/i` and switched all prefix-bearing assertions (`Max …`, `Now …`) to the `getByText(/Max|Now|To PR/i).first().innerText()` + `.toContain(value)` pattern per validator MIN-2 (mixed inline `<Text>` nodes render as separate spans on web). Updated the two negative-assertion sites at the no-pr and history-detail tests to assert `/To PR/i` and `/Max\s/i` absence instead of the now-removed `/Volume to PR:/i` (MIN-1). Added one new e2e: `"checked-only running volume: toggling a set's check updates Now, gap, and reps in lockstep"` — seeds a draft 100×5 against a 1,000 kg PR, asserts `Now 0 kg` + no reps clause, then UPDATEs `completed_at` via admin client and asserts `Now 500 kg` + `5.0 reps @ 100.0 kg`. Header docstring rewritten to reflect the new copy.

## Deviations from design

- **A11y label — MIN-5 fold-in (optional polish accepted)**: design specified 4 sentences ("Previous best X. Current session Y. Z to beat your previous best. About R reps at W."). I shipped the MIN-5 3-sentence comma-joined variant ("Previous best X, current session Y, Z to beat your previous best. About R reps at W.") because it preserves all information while cutting ~25% of the screen-reader announcement time across 6-8 exercise mounts. Validator flagged this as optional; the shorter version is what was already documented as acceptable in MIN-5.
- **`mkSet` factory left unchanged**: design plan §Test plan implied "stamp `completed_at` on every test that needs running volume," and that's exactly what I did per-call. I considered changing `mkSet`'s default to a timestamp, but per the F11 MAJ-1 regression pattern (which uses explicit `completed_at: null` to flag draft sets in-line), the explicit-per-test approach is clearer and was the design's recommendation in the table at design-v1.md:208. No deviation in spirit, just confirming the design's chosen pattern.
- **No update to `design-v1.md` Decision #3 (MIN-7)**: kept entirely optional and skipped. The Decision #3 rationale is already sufficient for a future reader (it cites the `VolumeTargetState["no-pr"]` union shape and the UX-contract argument). Adding "Max without a previous best is definitionally zero" would be a stylistic clarification only.
- **iPhone Safari smoke check (MIN-6)**: flagged for the Tester instead of executed locally per the Conductor's instruction. See "Notes for Reviewer / Tester" below.

## Soft callbacks made (during this implementation pass)

- None.

## Quality gates

- [x] `npm run typecheck` passed (`tsc --noEmit` — clean, no output)
- [x] `npm run lint` passed (0 errors, 1 pre-existing warning on `.expo/types/router.d.ts`, autogenerated, not in my touched files)
- [x] Relevant unit tests pass — `npm run test:unit` (92/92, including `volume-target.test.ts` 18/18)
- [x] No new `any`
- [x] No new `// @ts-ignore`
- [x] No stray `console.log`

## Notes for Reviewer / Tester

- **MIN-6 (iPhone Safari 320-375 px wrap)**: Tester should verify the new max-line at `text-sm` (~64 chars worst case: `"Max 4,900 kg · Now 1,200 kg · To PR 3,700 kg · ≈ 7.2 reps @ 60.0 kg"`) wraps cleanly on a 375-wide viewport in the Playwright run. The single-line layout uses the same RN `Text` wrap behaviour as before; if it overflows the container, the design predicted this and accepted graceful wrap as the existing behaviour.
- **MAJ-1 fix verification**: Reviewer please confirm the `state.runningKg > 0` guard at `volume-target-slot.tsx:60-63` correctly suppresses the reps clause in the no-weight-logged e2e (the assertion at the chasing-no-weight test now asserts `not.toMatch(/reps/i)` against the strip text — this is the visible behavioural check for the fix).
- **Past-vs-live asymmetry**: the JSDoc on `sumPastVolume` in `src/utils/volume-target.ts` documents the intentional split. If a future migration 0008 re-introduces `NOT NULL` on `completed_at` or backfills the legacy nulls, the asymmetry becomes redundant but harmless — `sumPastVolume` will still produce the same totals because every past row will then have a stamp.
- **`currentWeightKg` decoupling (Decision #8)**: the reps clause weight is still picked by `max(set_number)` regardless of check state. The new MAJ-1 fix only suppresses the *clause's render*, not the underlying pick — the kernel still returns a `currentWeightKg` value when a draft has weight but Now is zero. Reviewer: validate this is the intended semantic by reading the new unit test `"a draft set still drives the currentWeightKg pick when it has the highest set_number (Decision #8)"`.
- **E2E `gotoLiveSession` purges the cache** between the draft and checked-state assertions in the new toggle-lockstep test, so the post-toggle refetch is cold. The TanStack cascade (`useCheckSet` invalidates `["sets", sessionId]` → `setsByExercise` rebuilds → slot re-runs `useMemo`) is not exercised by this e2e — that's the in-app behaviour that the unit MIN-4 test covers at the kernel level. If Tester wants a UI-event-driven version of the toggle, they can click the check button instead of UPDATEing via admin; both paths converge on the same `completed_at` stamp.
