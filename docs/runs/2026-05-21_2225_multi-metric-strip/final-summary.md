# Final summary — 2026-05-21_2225_multi-metric-strip

## Outcome

- **Feature**: Multi-metric per-exercise strip on live workout — `"Max X · Now Y · To PR Z · ≈ R reps @ Wkg"`. "Now" counts only checked working sets (per F10 semantic). Reps clause auto-hides when `runningKg === 0` to avoid the misleading "Now 0 · ≈ 10 reps" render.
- **Pipeline result**: **shipped**.
- **Branch / final commit**: `main`. Working tree dirty — not yet committed (per project rule). 5 production-impact files plus 7 run artifacts.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (92/92 unit, 7/7 feature e2e, 9/9 adjacent e2e, 375-wide wrap smoke clean) |
| Human interventions during run | 1 (user spec choice — folded "Volume to PR seems wrong" into multi-metric strip) |
| Total round-trips (sum of all loops) | 3 (D↔V 1, I↔R 1, I↔T 1) |
| Design ↔ Validate rounds | 1 (`go` with 1 major absorbed in implementation) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 1 (`pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~45 min (22:25 → 23:10 BRT) |
| Token cost (if known) | n/a |

## What shipped

**Edited (production code):**

- `src/utils/volume-target.ts` — kernel split into `sumPastVolume` (no `completed_at` filter; past sessions are implicitly all-committed) + `sumLiveVolume` (filters `completed_at != null`). Deliberate asymmetry documented in JSDoc. `computeVolumeTarget` exported signature unchanged.
- `src/components/volume-target-slot.tsx` — chasing copy replaced with `"Max X · Now Y · To PR Z · (optional ≈ R reps @ Wkg)"`. Reps clause suppressed when `runningKg === 0` (MAJ-1 fix). A11y label compressed (~25% shorter).

**Edited (tests):**

- `tests/unit/volume-target.test.ts` — 13 → 18 tests. 10 stamping edits to existing live-set fixtures + 5 new tests for checked-only semantics, draft vs checked variations, reps-clause suppression at `runningKg=0`, chasing→surpassed via check-toggle.
- `tests/e2e/volume-target.spec.ts` — 7 `seedLiveSet` calls now stamp `completedAt`; assertions switched to `innerText().toContain()` pattern (MIN-2); negative regexes fixed (MIN-1); new toggle-lockstep e2e for draft → checked transition.

## Decisions made during the run

1. **(A) Consistent kernel semantics** — `runningKg` becomes checked-only, reversing F11's "drafts motivate" stance. Justification: user complained the math felt wrong; consistent arithmetic resolves it.
2. **Single-line dot-separated layout** — matches `session-summary-row.tsx:56-65` precedent. Wraps at `· ≈` on iPhone 375 widths, accepted as graceful.
3. **`no-pr` still hides the slot** — "Max" without a previous best is definitionally zero; surfacing "Max 0 kg" is misleading copy, not informative.
4. **`currentWeightKg` decoupled from check state** — picked by `max(set_number)` over any positive-weight row, regardless of `completed_at`. Lets the reps-clause update as the user types. Paired with the MAJ-1 reps-clause suppression to avoid the misleading "Now 0 · ≈ 10 reps @ 100" render.

## Bugs caught by the pipeline

- **Validator MAJ-1**: Designer flagged the `currentWeightKg`/`Now` decoupling explicitly for Validator confirmation. Validator picked fix (c) — suppress reps clause when `runningKg === 0` — and Implementer folded it. Would have shipped as a confusing UX otherwise.
- **Validator MIN-1**: negative-assertion regex would have passed vacuously after the copy change. Implementer updated to `/To PR/i`.
- **Validator MIN-2**: split-text Playwright pattern. Without this guidance, naive `getByText("Max 1,800 kg")` assertions would have failed intermittently on web.

## Known debt (non-gating)

- A11y label "3 sentences" was implemented as 2-3 commas (semantic content unchanged). Tester flagged the interpretation gap; Conductor accepts as-is.
- Worst-case 4-digit `Max` copy at 375 px not directly exercised in smoke (seeded `Max 1,800`, not `Max 4,900`). Predicted wrap behavior holds; user-side post-deploy spot-check recommended.
- 4 Reviewer minors (regex breadth, comment density, one test passing for two reasons, screenshot timing) — all non-blocking polish.

## Why we stopped

Feature complete. All gates green. No round budgets used beyond the first round of each loop.

## Artifacts

- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md)
- [`validation-v1.md`](./validation-v1.md)
- [`implementation.md`](./implementation.md)
- [`review-v1.md`](./review-v1.md)
- [`test-report-v1.md`](./test-report-v1.md)
- [`transcript.md`](./transcript.md)
- `screenshots/iphone-375-strip.png` + `screenshots/iphone-375-wrap.png`

## Notes for the owner

- **Working tree uncommitted.** Combined diff includes the prior `formatVolume` change from `2026-05-21_2155_volume-math-wrong` plus this run. Suggested commit split:
  - `feat(workout): full-number volumes (no 'k' shorthand)` — `src/utils/units.ts` + the four test files updated for that.
  - `feat(workout): multi-metric volume strip (Max · Now · To PR)` — `src/utils/volume-target.ts` + `src/components/volume-target-slot.tsx` + `tests/unit/volume-target.test.ts` + `tests/e2e/volume-target.spec.ts`.
  - `docs(pipeline): archive 2026-05-21_2155 and 2026-05-21_2225 runs` — the run directories.
- **Manual visual check recommended before next deploy**: reload `ada11.expo.app`, start a live workout, confirm the new strip looks right with your actual heavy lifts (Bench ~4.9k Max, etc.).
- **`docs/features.md` backlog item #2 closed** by this run.

## Archive

- Pending Conductor archive command (final step).
