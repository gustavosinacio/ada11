# Review v1 — 2026-05-21_2225_multi-metric-strip

Reviewing: the diff for the implementation against `design-v1.md` (and folding `validation-v1.md` MAJ-1 + MIN-1…MIN-5).

## Diff scope

- Diff command: `git diff 4e30d1561a2877ae14b435e627590a99594780b8...HEAD` (baseline recorded in `state.md`).
- Files changed (touched-by-this-run): **4**.
  - `src/utils/volume-target.ts` +42 −6
  - `src/components/volume-target-slot.tsx` +22 −4
  - `tests/unit/volume-target.test.ts` (added 5 new tests + stamped `completed_at` on 10 existing chasing/surpassed cases); 13 → 18 it() blocks total
  - `tests/e2e/volume-target.spec.ts` +187 −44 (copy migration, split-text pattern adoption, MIN-1 negative regex, new toggle-lockstep test)
- Other modified paths in the working tree (PNG screenshots from prior runs, `CLAUDE.md`, etc.) are out of scope for this review — they predate the baseline and are not part of this feature.

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| Kernel split into `sumPastVolume` (no completion filter) + `sumLiveVolume` (filters `completed_at != null`) | yes | `src/utils/volume-target.ts:58-69` and `:78-90`. Both share warmup-skip + `w>0 && r>0` guards. |
| JSDoc documents the past-vs-live asymmetry (MIN-3) | yes | `src/utils/volume-target.ts:49-57`. Explicitly cites the F10 rule, migration 0007's nullable column, and the "silently corrupt historical PRs" failure mode. |
| `computeVolumeTarget` exported signature + `VolumeTargetState` union unchanged | yes | `src/utils/volume-target.ts:11-32` (union) and `:111-113` (signature). Diff confirms no exported-type lines moved. |
| `currentWeightKg` pick still by `max(set_number)` and decoupled from `completed_at` (Decision #8) | yes | `src/utils/volume-target.ts:140-147` — same reducer, no `completed_at` check. JSDoc at `:103-105` makes the intent explicit. |
| Slot chasing copy is `"Max X · Now Y · To PR Z · ≈ R reps @ Wkg"` | yes | `src/components/volume-target-slot.tsx:84-104`. Three inline bold spans (`tabular-nums text-black dark:text-white`), middle-dot separators, optional reps fragment. |
| MAJ-1 fix: `showRepsClause` includes `state.runningKg > 0` | yes | `src/components/volume-target-slot.tsx:60-63`. Comment block at `:54-59` documents the rationale. |
| Light/dark tokens preserved (`text-gray-500 dark:text-gray-400`, `text-black dark:text-white`, `border-gray-100 dark:border-gray-900`) | yes | `src/components/volume-target-slot.tsx:78, 82, 85, 89, 93, 99`. Container + wrapper + bold-span tokens all unchanged from the F11 file. |
| A11y label collapsed to 3 sentences (MIN-5 polish) | yes | `src/components/volume-target-slot.tsx:71-75` — `"Previous best X, current session Y, Z to beat your previous best. About R reps at W."` (one sentence when reps clause hidden). Within MIN-5's allowed envelope. |
| Unit-test count 13 → 18 with new checked-only block | yes | `tests/unit/volume-target.test.ts` line count via `grep -c '^\s\+it\('` = **18**. New describe block at `:384-573` adds 5 cases (drafts excluded, all-checked, draft-still-drives-currentWeight, warmup-still-excluded-when-checked, MIN-4 toggle transition). |
| MIN-4 transition test covers chasing→surpassed via check-toggle | yes | `tests/unit/volume-target.test.ts:517-572` — explicitly builds drafts that *would* exceed PR if counted, asserts `chasing` with `runningKg=0`, flips both stamps, re-asserts `surpassed` with `overflowKg=500`. |
| Reps-clause-suppression coverage when `runningKg === 0` | yes (kernel + e2e) | Unit `:449-482` (`a draft set still drives the currentWeightKg pick`) verifies the kernel returns `currentWeightKg=80` with `runningKg=300` — the kernel half. E2E `tests/e2e/volume-target.spec.ts:374-386` asserts `expect(stripText).not.toMatch(/reps/i)` when only drafts present — the slot half. Both halves of the MAJ-1 fix are exercised. |
| E2E: split-text pattern (`innerText().toContain(…)`) for prefix-bearing assertions | yes | `tests/e2e/volume-target.spec.ts:251-260, 288-297, 375-385, 487-496, 635-644`. No `getByText("Max 1,800 kg")`-style strict-text selectors remain for the new mixed-span copy. Top-level docstring at `:27-29` documents the pattern. |
| MIN-1: negative regex sites updated from `/Volume to PR:/i` to `/To PR/i` (and add `/Max\s/i`) | yes | `tests/e2e/volume-target.spec.ts:541-542` (no-pr test) and `:589-590` (history-detail test). Verified `grep -n "Volume to PR" tests/e2e/volume-target.spec.ts` returns only the one comment line at `:540` explaining the migration. |
| Golden-path phases B/C/D now stamp `completedAt` on seeded live sets | yes | `:238, 282, 319` — all three `seedLiveSet` calls pass `completedAt: new Date().toISOString()`. |
| Tie case loop stamps every seeded set | yes | `:423` inside `for` body. |
| MAJ-1 e2e regression stamps both set #1 and set #2 | yes | `:468, 479`. Set #1 at `Date.now() - 60_000` (older), set #2 at `Date.now()` (newer) — keeps `max(set_number)` as the deciding criterion while ensuring both count toward `runningKg`. Expected `Now 900 kg`, `To PR 100 kg`, `1.3 reps @ 80.0 kg` — confirmed at `:491-502`. |
| New e2e: toggle-lockstep test | yes | `:603-680`. Seeds a draft 100×5 against a 1,000 kg PR, asserts `Now 0 kg` + no reps clause, then `admin.update(completed_at)` and re-mount with cold cache. Asserts `Now 500 kg` + `5.0 reps @ 100.0 kg`. Literally proves the `Max − Now = To PR` arithmetic under a check toggle. |
| `npm run typecheck` clean | yes | Re-ran here — `tsc --noEmit` produced no output. |

## Issues

### Blockers

None.

### Majors

None. The validator's MAJ-1 ("reps clause vs `Now 0`" inconsistency) is fixed at `src/components/volume-target-slot.tsx:60-63` with the recommended option (c) and is exercised by both a kernel test and an e2e.

### Minors

- **[MIN-1]** `tests/e2e/volume-target.spec.ts:589-590` — negative-assertion regexes `/To PR/i` and `/Max\s/i` are slightly broader than strictly necessary. `/Max\s/i` would also match a hypothetical future "Max sets:" copy elsewhere on the history detail. Today there is no such conflicting copy in `history/[sessionId].tsx`, so the assertion is correct under current rendering. Fix (optional): tighten to `/^Max\s/m` or scope to the strip container. Not blocking — current behaviour is correct.

- **[MIN-2]** `src/components/volume-target-slot.tsx:54-59` — the inline comment block is six lines explaining MAJ-1's option (c). It narrates *why* (which is correct per the contract), but is longer than the surrounding comment density in the file. Optional polish: trim to two lines referencing the design Decision #8 + validator MAJ-1 by name. Severity: minor stylistic; the content is correct.

- **[MIN-3]** `tests/unit/volume-target.test.ts:152-172` — the test `"returns chasing with repsToBeat=null when no current set has a positive weight"` does NOT stamp `completed_at` on its current sets. Under the new `sumLiveVolume` filter, both sets are doubly-excluded (no weight AND no completion stamp), which makes the test pass for the wrong reason today: it intends to test the weight-guard path. The assertion `expect(state.runningKg).toBe(0)` still holds either way, but adding `completed_at: "2026-05-21T10:05:00Z"` would make the test exercise the weight-guard rather than the completion-guard. Severity: minor — coverage is preserved by the new `"a draft set still drives the currentWeightKg pick"` test (`:449-482`), which exercises the weight-guard path with a checked set.

- **[MIN-4]** `tests/e2e/volume-target.spec.ts:374-385` — assertion order on the chasing-no-weight test reads the strip text in one shot but the screenshot at `:388-391` is captured before the assertion block prints its values to the test log. Not a bug; just a minor ergonomics nit if a future failure needs the screenshot to debug. Severity: trivial.

## Security checklist

- [x] **RLS**: no new `from('table').*` calls in shipping code. The two new admin-client touches in `tests/e2e/volume-target.spec.ts` (`:356-365, :648-652`) use `SERVICE_ROLE` via the test-only `admin` client; they live in `tests/e2e/` (not under `app/` or `src/`) and follow the existing test-helper pattern. No RLS surface change.
- [x] **No `SUPABASE_SERVICE_ROLE_KEY`** referenced in any file under `src/` or `app/` touched by this diff. Verified via `grep -n "SERVICE_ROLE" src/utils/volume-target.ts src/components/volume-target-slot.tsx` → no matches.
- [x] **No raw SQL via `rpc`** — diff introduces zero `rpc()` calls.
- [x] **`EXPO_PUBLIC_*`** env vars — diff touches none.

## Style / convention checklist

- [x] No new `any` — `grep -E "\\bany\\b" src/utils/volume-target.ts src/components/volume-target-slot.tsx` returns nothing.
- [x] No new `// @ts-ignore` — confirmed empty grep.
- [x] Comments narrate *why* — the new JSDoc on `sumPastVolume` and the MAJ-1 comment in the slot both explain rationale (past-vs-live asymmetry, why suppressing the reps clause prevents UX-misleading drafts). No "what this line does" line comments.
- [x] Imports follow project style — both edited source files keep the existing `react`/`react-native` → `~/...` ordering. No new imports added that change ordering.
- [x] New files placed in conventional folder — N/A, all four touched files are edits, not new files.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 4 minors (all optional polish or non-blocking). Decision rule "0 blockers and ≤1 major → pass" satisfied.
- Validator's MAJ-1 fix (option c, `runningKg > 0` predicate on `showRepsClause`) is present at the exact site (`volume-target-slot.tsx:60-63`) with rationale comment.
- Kernel split is clean: `sumPastVolume` deliberately has no `completed_at` filter (with JSDoc justifying the asymmetry per MIN-3); `sumLiveVolume` filters `completed_at != null` ahead of the shared guards.
- Public `computeVolumeTarget` signature and `VolumeTargetState` union shape are unchanged — no kernel-signature regression.
- `currentWeightKg` decoupling (Decision #8) is preserved: `max(set_number)` over rows with `Number.isFinite(w) && w > 0`, regardless of `completed_at`. Documented in JSDoc and exercised by a new unit test.
- Test coverage matches the design + validator demands: 13 → 18 unit tests with a dedicated checked-only describe block and a chasing→surpassed-via-toggle transition (MIN-4); e2e migrates to the `innerText().toContain(…)` split-text pattern (MIN-2) and updates the two negative regex sites (MIN-1).
- Implementer's three documented deviations (MIN-5 a11y collapse, `mkSet` left unchanged, MIN-6 deferred to Tester) all match the design's accepted envelope.

Recommendation to Conductor: **invoke Tester**.

## Counts

`{ blockers: 0, majors: 0, minors: 4 }`
