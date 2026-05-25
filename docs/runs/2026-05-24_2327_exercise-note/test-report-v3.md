# Test report v3 — 2026-05-24_2327_exercise-note

Round 3 Implement↔Test cycle. INDEPENDENT verification of the Implementer's round-3 debt payoff. The user authorized this round specifically to clear the round-2 known flake; the bar is genuine stability across two independent dev-server boots.

## Environment
- Commands used to run app: `npm run web` (Expo web on `http://localhost:8081`). Killed (`kill -9` on PID owning :8081) and restarted between boot 1 and boot 2.
- Browser / device: Playwright headless Chromium (engine bundled with playwright `1.59.1`).
- Test data: shared e2e auth fixture (seeded via the project's standard Supabase env wired through `.env.local`).
- Node: v23.10.0.

## Scope of this verification
The new feature (`exercise_notes` table, API, hook, slot component, and three host-screen mounts) and its supporting unit/e2e tests already passed Reviewer round-2 and were merged into `main` (commit `23cb87c feat(notes): personal per-(user, exercise) exercise note`). Round-3 was an E2E-only debt payoff: a single golden test in `tests/e2e/exercise-note.spec.ts` was flaky at ~33-50% pass rate due to a React-Query in-memory cache race priming an empty `sets` cache during a now-removed `/workout/{id}` step.

This report verifies the round-3 fix delivers genuine stability and does not regress the rest of the suite or the source tree.

## Stability bar (the headline gate)

**Spec**: `npx playwright test tests/e2e/exercise-note.spec.ts -g "golden" --repeat-each=10` must be 10/10 PASS, executed on TWO independent dev-server boots (server killed between batches).

### Boot 1 — stability bar
**Result**: **PASS 10/10**

Command:
```
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/v3-boot1-stability.json \
  npx playwright test tests/e2e/exercise-note.spec.ts -g "golden" --repeat-each=10 --reporter=json
```

Parsed evidence (from `/tmp/v3-boot1-stability.json` `stats` block):
```
expected: 10  unexpected: 0  flaky: 0  skipped: 0
test results count: 10
statuses: passed,passed,passed,passed,passed,passed,passed,passed,passed,passed
durations_ms: [10431, 9252, 9061, 9463, 7473, 8888, 9199, 8958, 9064, 9411]
```

Duration spread 7.5-10.4 s (mean ≈ 9.1 s). No flake spike, no slow-tail outlier.

### Boot 2 — stability bar (independent dev-server boot)
After boot 1's runs completed, the dev server was killed (`kill -9` on PID owning :8081, port confirmed free) and a fresh `npm run web` boot was launched. Server was confirmed serving HTTP 200 on `/` before re-running.

**Result**: **PASS 10/10**

Command:
```
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/v3-boot2-stability.json \
  npx playwright test tests/e2e/exercise-note.spec.ts -g "golden" --repeat-each=10 --reporter=json
```

Parsed evidence (from `/tmp/v3-boot2-stability.json` `stats` block):
```
expected: 10  unexpected: 0  flaky: 0  skipped: 0
test results count: 10
statuses: passed,passed,passed,passed,passed,passed,passed,passed,passed,passed
durations_ms: [9668, 9269, 8545, 8868, 8895, 8358, 8839, 8837, 8835, 8695]
```

Duration spread 8.4-9.7 s (mean ≈ 8.9 s) — tighter than boot 1 because the build cache was already warm before any runs started.

### Combined stability total
**20/20 golden invocations PASS across two independent dev-server boots.** Zero failures, zero flakes, zero retries.

## Full suite — boot 1
**Spec**: `npx playwright test tests/e2e/exercise-note.spec.ts` must be 6/6 PASS.

**Result**: **PASS 6/6**

Command:
```
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/v3-boot1-fullsuite.json \
  npx playwright test tests/e2e/exercise-note.spec.ts --reporter=json
```

Parsed evidence:
```
expected: 6  unexpected: 0  flaky: 0  skipped: 0
spec count: 6
  passed 10646 ms — golden: progress screen edit → history read-only surfaces the note
  passed  6829 ms — live workout: + Add note collapsed → tap → expand → blur empty does NOT mutate
  passed  4965 ms — history read-only: exercise with no note renders nothing for the slot
  passed  4605 ms — 2000-char cap: <Textarea maxLength> truncates input
  passed  6102 ms — soft-deleted exercise: progress screen still surfaces the note
  passed  5888 ms — lbs unit: note display is unit-agnostic
```

## Full suite — boot 2 (independent dev-server boot)
**Result**: **PASS 6/6**

Command:
```
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/v3-boot2-fullsuite.json \
  npx playwright test tests/e2e/exercise-note.spec.ts --reporter=json
```

Parsed evidence:
```
expected: 6  unexpected: 0  flaky: 0  skipped: 0
spec count: 6
  passed 9091 ms — golden: progress screen edit → history read-only surfaces the note
  passed 6505 ms — live workout: + Add note collapsed → tap → expand → blur empty does NOT mutate
  passed 4820 ms — history read-only: exercise with no note renders nothing for the slot
  passed 5247 ms — 2000-char cap: <Textarea maxLength> truncates input
  passed 5924 ms — soft-deleted exercise: progress screen still surfaces the note
  passed 5854 ms — lbs unit: note display is unit-agnostic
```

### Combined full suite total
**12/12 specs PASS across two independent dev-server boots.**

## Quality gates

| Gate | Result | Evidence |
|---|---|---|
| `npm run typecheck` | PASS | `tsc --noEmit` exited clean, zero stdout. |
| `npm run lint` | PASS | `ESLint: 0 errors, 1 warnings in 1 files` — same single pre-existing warning in `.expo/types/router.d.ts` (auto-generated file, untouched by this round). |
| `npm run test:unit` | PASS | `23 test files, 364 tests passed in 2.04s` — includes the 10-test `tests/unit/exercise-notes-api.test.ts` suite. |

## Source-untouched check (round 3 directive)

**Spec**: `git diff main -- 'src/*' 'app/*' 'supabase/*'` must be empty for this round.

**Result**: PASS — empty diff against `main`.

Evidence:
```
$ git diff main -- 'src/*' 'app/*' 'supabase/*'
(no output)

$ git diff main --name-only -- 'src/*' 'app/*' 'supabase/*'
(no output)

$ git diff main --name-only -- 'tests/*'
tests/e2e/exercise-note.spec.ts
```

The only file changed vs `main` under code paths is `tests/e2e/exercise-note.spec.ts`. This matches the Implementer's stated scope (test-only debt payoff). Note: the round-3 plan also says `purgeQueryCache` helper should be left in place and the Implementer documents adding one call site back to defend a SECOND, distinct cache race (notes-cache rehydration vs the persister-throttle window). The helper itself was not edited.

## Cross-platform
- Web: PASS (covered by all e2e specs above, 20/20 + 12/12).
- iOS: not tested — round-3 scope is test-only; no native code path touched. The slot component is shared RN, but a native runtime sweep was not in scope and the source was untouched vs the round-2 / round-1 baseline that was already verified for native parity.
- Android: not tested — same reason as iOS.

## Regression check
- Adjacent e2e specs that mount `<ExerciseBlock>` were not re-run in this round. The round-3 directive scoped this to "20/20 golden + 6/6 full suite × 2 + quality gates + source diff empty". The MIN-v2-5 mandate was already executed and confirmed clean by round-1 Tester; since round-3 made zero source changes (verified above), no positional-selector regression vector exists. The unit suite (364 tests, including all adjacent-component math) is green.

## Test commands
- [x] `npm run typecheck` — clean (no output).
- [x] `npm run lint` — 0 errors, 1 pre-existing warning (`.expo/types/router.d.ts`).
- [x] `npm run test:unit` — 364/364 pass, 2.04 s.
- [x] `npx playwright test tests/e2e/exercise-note.spec.ts -g "golden" --repeat-each=10` × 2 boots — 20/20 pass.
- [x] `npx playwright test tests/e2e/exercise-note.spec.ts` × 2 boots — 12/12 pass.

## Stability evidence consolidation

Round-by-round golden test reliability:

| Round | Method | Result |
|---|---|---|
| v1 | UI-driven 4-step golden flow | 4/6 specs pass (golden flaky on spec defects). |
| v2 | Verdict-screen-aware + admin-set seed + waitForResponse | 3/3 consecutive 6/6 (Implementer claim) → could NOT be reproduced by Tester at the stability bar (~33-50% golden pass rate). |
| v3 | Admin-seed sessions + sets + skip /workout/{id} entirely + targeted `purgeQueryCache` against notes-cache race | **20/20 golden across 2 independent dev-server boots + 12/12 full suite × 2.** |

The v3 architectural change (skipping the `/workout/{id}` mount → no empty-sets cache priming → no race against the history `sets` query) is the root cause fix; the re-added `purgeQueryCache` call site is a defense against a second, distinct race in the notes-cache rehydration window (staleTime=30 s + persister throttle 1000 ms). Both are documented in `implementation.md` round-3 Deviation #1.

## Decision

**PASS**

Reasoning:
- The strict stability bar (10/10 golden × 2 independent dev-server boots = 20/20 invocations) was met with zero failures and zero flakes. The duration spread is tight (7.5-10.4 s) with no slow-tail outlier suggesting hidden retries.
- The full suite (6/6) passed on both independent boots (12/12 total) with comparable per-spec durations to round 2 (no perf regression introduced).
- Quality gates (typecheck, lint, unit) are green; no new `any`, no new `// @ts-ignore`, no stray `console.log`.
- The source-untouched directive is satisfied: zero source-path diff vs `main`, only `tests/e2e/exercise-note.spec.ts` modified in this round.
- The known debt from round 2 is cleared. The round-3 stability evidence is stronger than what was claimed in round 2 (which was 3 consecutive 6/6 but did not survive Tester verification); this round explicitly required 2 independent dev-server boots, and both passed at full bar.

Recommendation: **finalize**. The Conductor may proceed to the closeout step. The pipeline budget extension (3 rounds vs the usual 2) was justified — the v3 fix is structurally sound (admin-seed pattern matches the established `read-only-history.spec.ts` precedent), the only remaining test-scaffolding dependency (`purgeQueryCache` at one site) is documented and addresses a different race than the one the round-2 work targeted.
