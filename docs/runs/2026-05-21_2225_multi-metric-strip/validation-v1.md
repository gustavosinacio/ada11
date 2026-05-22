# Validation v1 — 2026-05-21_2225_multi-metric-strip

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## Verification of Designer's claims

| Claim | Verified? | Evidence |
|---|---|---|
| `volume-target-slot.tsx:74` renders the single `Volume to PR: ...` Text with the gap and optional reps clause | yes | `src/components/volume-target-slot.tsx:67-89` (chasing branch); a11y label at 61-65 is 2 sentences. |
| `computeVolumeTarget` only called from `<VolumeTargetSlot>` + tests | yes | Grep → `src/components/volume-target-slot.tsx`, `src/utils/volume-target.ts`, `tests/unit/volume-target.test.ts`. No other call sites. |
| `sumVolume` at `volume-target.ts:48-59` skips warmups, parses `weight`, guards `w>0 && r>0`. No `completed_at` filter today. | yes | Confirmed. |
| `pastSessions` from `listSetsForExercise` loads only finished sessions (`ended_at IS NOT NULL`) | yes (caveat) | `src/api/progress.ts:10-39`. Caveat: migration 0007 dropped `NOT NULL` on `completed_at`; a finished session could technically contain unchecked rows. Practically rare; see MIN-3. |
| `seedFinishedPRSession` stamps `completed_at` for every seeded past row | yes | `tests/e2e/volume-target.spec.ts:126-128`. |
| `seedLiveSet` defaults `completedAt` to `null` | yes | `tests/e2e/volume-target.spec.ts:168`. |
| Designer's math sanity-check for MAJ-1 / golden phases / surpassed / tie | yes | All ✓. |
| `formatVolume` rounds to integer with en-US thousands separator | yes | `src/utils/units.ts:33-40`. |
| `<ExerciseBlock>` mounts the slot only when `showVolumeTarget` is true; only the live screen passes it | yes | `src/components/exercise-block.tsx:181-186`. |

## Issues found

### Blockers

None.

### Majors

- **[MAJ-1]** `design-v1.md` Decision #8: the design ships a known inconsistency between "Now" semantics (checked-only) and `currentWeightKg`/`repsToBeat` semantics (draft-inclusive). Concretely: one draft `100 × 5` (unchecked) renders as `"Max 1,000 kg · Now 0 kg · To PR 1,000 kg · ≈ 10.0 reps @ 100.0 kg"`. The reps clause's denominator comes from a set that is explicitly excluded from the displayed Now. Internal arithmetic `Max − Now = To PR` holds, but the reps clause becomes a forward-looking projection rather than a derived consequence of the displayed Now. Designer flagged for Validator confirmation; I am not confirming silently.
  - **Suggested fix (Validator's choice)**: option (c) — suppress the reps clause when `runningKg === 0`. Smallest behavioral patch. Two-line guard in the slot's render: `showRepsClause = state.repsToBeat != null && state.currentWeightKg != null && state.runningKg > 0`. Removes the strongest UX inconsistency without disturbing Decision #8.

### Minors

- **[MIN-1]** Negative assertions at `tests/e2e/volume-target.spec.ts:496` and `:542` still use `/Volume to PR:/i`. After copy change these would always pass `toHaveCount(0)` vacuously. Implementer must update to `/To PR/i` and ideally also assert "Max " label absence.

- **[MIN-2]** Split-text Playwright assertions: the slot renders inline mixed child `<Text>` nodes (parent text wraps with nested bold children). `page.getByText("Max 1,800 kg")` will not find a single text node matching the substring — `"Max "` and `"1,800 kg"` live in separate spans on web. Direct Implementer to use `.first().innerText()` + `.toContain(…)` for prefix-bearing assertions (same pattern as e2e line 348-353).

- **[MIN-3]** Designer's "past-session rows are implicitly all checked" argument is effectively true but not strictly guaranteed (migration 0007 dropped `NOT NULL`). Add a one-sentence JSDoc note in `sumPastVolume` documenting the deliberate past-vs-live asymmetry.

- **[MIN-4]** Test plan completeness: no dedicated test for the chasing → surpassed transition triggered by a check-toggle (only via "add a new checked set"). Add either a unit case (kernel returns `surpassed` after the same sets flip from unchecked → checked) or one e2e covering "check an existing draft that pushes you over previousMax".

- **[MIN-5]** A11y label verbosity. 4 sentences vs today's 2. ~3-4s per VoiceOver pass × 6-8 exercises = announcement burden. Optional collapse: `"Previous best ${maxDisplay}, current session ${nowDisplay}, ${gapDisplay} to beat your previous best."` (3 sentences).

- **[MIN-6]** Line wrap on iPhone Safari narrow widths (320-375 px). New max-line ≈ 64 chars at `text-sm`; current is ≈ 47. Wrap will be more frequent. Designer acknowledges in design-v1.md:20. Not a blocker — RN wrap is graceful and content remains legible. Implementer should smoke-test on a 375-wide viewport.

- **[MIN-7]** Strengthen `no-pr` rationale: add a one-liner in Decision #3 explaining that "Max" without a previous best is definitionally zero — surfacing "Max 0 kg · Now X kg" is misleading copy, not informative copy.

## Decision

**`go`**

Reasoning:
- 0 blockers, 1 major (known + documented + has a clean fix), 7 minors absorbable in implementation.
- Decision rule: "0 blockers and ≤1 major → `go` (note the lingering major as known debt)" — satisfied.

## Counts

`{ blockers: 0, majors: 1, minors: 7 }`

## Recommendation to Conductor

`invoke Implementer`. Pass MAJ-1 fix (c) as primary in-flight guidance + MIN-1, MIN-2, MIN-3, MIN-4 as must-do absorbed items. MIN-5, MIN-6, MIN-7 are optional polish.
