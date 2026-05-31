# Test report v2 — 2026-05-30_2006_e1rm-strength-chart

Testing: the round-2 test-only locator fix against `implementation.md` "Round 2 (test-only locator fix)" + the round-1 feature (already proven working in `test-report-v1.md`).

Implement↔Test ROUND 2 of 2 — final confirming round. NARROW scope: round 1 already proved the e1RM feature works end-to-end (SVG line draws + trends up, Invariant D negative case correct, gates 444/444). This round confirms ONLY that the one-line locator fix closed the round-1 adjacent-test regression and introduced no collateral.

## Verdict

**PASS.**

The round-1 regression (`progress-page.spec.ts :: 4. per-row navigation`) is CLOSED. I ran the previously-RED spec myself (did not trust the Implementer): the whole file is now **8/8 green**, including the previously-failing test #4. The feature spec `e1rm-strength.spec.ts` is **still 3/3 green** (no collateral from the locator change). All static gates green (444/444 unit). The round-2 change is **test-only** — no e1RM feature code touched.

## Environment
- Run-the-app command: `npm run web` (Expo web / Metro on `http://localhost:8081`, started fresh in background — the Implementer had shut theirs down; health-checked 200 before each batch).
- E2E runner: `npx playwright test` (Chromium, `workers:1`, `fullyParallel:false` per `playwright.config.ts`), with `PLAYWRIGHT_JSON_OUTPUT_NAME` to a file to defeat the terse terminal summary and read per-test status.
- Browser/device: Chromium headless (web). iOS/Android not exercised (see Cross-platform).
- Test data: fresh confirmed users seeded per-test via the service-role `admin` client; canonical exercises resolved from the LIVE shared catalog (`user_id IS NULL`). Unchanged from round 1.
- Server health after BOTH e2e batches: **200**, dev-server RSS ~**417 MB** — **no OOM cascade this run** (the env held, consistent with round 1's ~386 MB).

## Could I run e2e/UI? YES.
Fresh dev server started; the previously-RED spec and the feature spec both executed live; server shut back down leaving `:8081` clean.

## Static gates (observed)

| Gate | Command | Observed | Expected | Result |
|---|---|---|---|---|
| Typecheck | `npm run typecheck` | `tsc --noEmit` exit 0, 0 errors | 0 | **pass** |
| Lint | `npm run lint` | 0 errors, 1 warning (`router.d.ts`, auto-generated, pre-existing) | 0 err / 1 warn | **pass** |
| Unit | `npm run test:unit` | **444 passed (444)**, 27 files — incl. `e1rm-strength.test.ts (13 tests)` | 444 | **pass** |

Unit suite matches the expected 444 (baseline 431 + 13 new e1RM cases). The e1RM unit suite (Invariants D/E1/LOCF/eligibility/dangling/tie-break) is present and green — the correct home for E1/LOCF per design + Reviewer T-4.

## Previously-RED spec re-run (the core round-2 check) — `tests/e2e/progress-page.spec.ts`

Ran it myself with the JSON reporter to confirm per-test status, not just the aggregate.

**Result: 8/8 PASS** (`{"expected":8,"unexpected":0,"flaky":0,"skipped":0}`). The previously-RED **#4. per-row navigation** is now GREEN.

```
PASS :: 1. tab visibility — Progress tab renders on the bottom bar
PASS :: 2. empty user — day-zero empty states render without crashing
PASS :: 3. populated user mid-week — hero, bars, list, streak all render
PASS :: 4. per-row navigation — tapping a list row routes to /(app)/exercises/{id}/progress   ← was RED in round 1, now PASS
PASS :: 5. empty current ISO week with prior history — list shows empty copy, hero/bars still render
PASS :: 6. PR badge — PR pill + accordion celebratory line
PASS :: 7. 5-tab regression — History, Progress, Profile labels coexist on the bar
PASS :: 8. hero accordion — tap count → expand → tap row → routes to exercise progress
```

The round-1 diagnosis is confirmed resolved: test #4 now targets the navigable list row via `getByRole("button", { name: \`${exerciseName}, view progress\` }).first()` (the same locator test #8 has always used), which does NOT match the e1RM legend chip's `"Toggle <name>"` label. The `.click()` → `waitForURL(/exercises/${exerciseId}/progress/)` succeeds (no longer times out on the non-navigable chip). Confidence: **HIGH** (ran it live, JSON-confirmed `unexpected:0`).

## Feature spec re-run (collateral check) — `tests/e2e/e1rm-strength.spec.ts`

**Result: 3/3 PASS** (`{"expected":3,"unexpected":0,"flaky":0,"skipped":0}`).

```
PASS :: 1. section renders for a populated user with a weighted exercise
PASS :: 2. per-exercise chip toggle + check-all / uncheck-all
PASS :: 4. bodyweight-only exercise (weight=0) produces NO e1RM line   ← Invariant D negative case
```

No collateral. Expected, since the round-2 edit touched only `progress-page.spec.ts`; this run confirms it empirically rather than by inference.

## Edge cases (NARROW round — re-confirmed, not re-derived)
- **Invariant D (bodyweight-only → NO e1RM line):** still green via feature spec #4 above. A `weight=0` set never becomes eligible. **pass** (re-confirmed live this round).
- **Invariants E1 (MAX-not-sum) + LOCF (carry-forward, leading flat lead-in):** unit-covered, green within 444/444 (`e1rm-strength.test.ts` cases #3/#4 for E1, #5/#6 for LOCF). Per design + Reviewer T-4, these live in unit (the algorithm's correct home); not marked "e2e-verified." **pass** (unit-verified).
- (The round-1 edges — golden-path polyline-draws-and-trends-up, MAJ-1 settle-gate teeth, T-1 seed-name catalog resolution — were proven in `test-report-v1.md` with live polyline probe + screenshot + live-catalog query. No code touched those paths in round 2, so they remain valid; not re-run in this narrow round.)

## Regression check
- **`progress-page.spec.ts` (the adjacent suite that regressed in round 1):** 8/8 — the regression is closed (see above).
- **`e1rm-strength.spec.ts` (feature):** 3/3 — no collateral.

## Change-is-test-only confirmation

`git diff HEAD` since the feature work shows the only changes beyond round-1's feature files are in `tests/e2e/progress-page.spec.ts` (one locator + a 4-line explanatory comment). No e1RM feature source changed in round 2.

- Tracked source edits: `app/(app)/progress/index.tsx` (round-1 feature mount + docstring) and `tests/e2e/progress-page.spec.ts` (round-2 locator only, `+7 -1`).
- Untracked new feature files (round 1): `src/utils/e1rm-strength.ts`, `src/components/e1rm-strength-section.tsx`, `tests/e2e/e1rm-strength.spec.ts`, `tests/unit/e1rm-strength.test.ts`.
- The `docs/runs/**/screenshots/*.png` entries in `git status` are pre-existing mtime churn from prior runs (unrelated to this feature; not introduced by round 2).

## Pre-existing failures (out of scope)
- The historically-known `chart-scroll-week-selector` failures were NOT in this round's scope and were not run. Round-1 found no other failures; the single round-1 failure was the feature-interaction locator break, now fixed. I attribute NO failure to this feature in round 2.

## Cross-platform
- **Web (Chromium):** tested — regression closed (8/8), feature green (3/3). The change is RN-Web-compatible only.
- **iOS:** **not tested** — the round-2 change is a Playwright (web) test-locator edit; it does not touch native code. The feature itself is pure-TS presenter + TanStack hooks + `react-native-svg` `<MultiSeriesChart>` on the same path as the already-shipped muscle chart. Risk LOW per design R-5/R-6.
- **Android:** **not tested** — same reasoning as iOS.

(I did not run iOS/Android simulators; per the rules I do not mark them pass. The round-2 change is web-test-only, so native is not implicated.)

## Test commands
- [x] `npm run typecheck` — `tsc --noEmit` exit 0, 0 errors.
- [x] `npm run lint` — 0 errors, 1 pre-existing auto-generated warning.
- [x] `npm run test:unit` — 444 passed (444), incl. `e1rm-strength.test.ts (13 tests)`.
- [x] `npx playwright test tests/e2e/progress-page.spec.ts` — **8/8 PASS** (previously-RED #4 now PASS).
- [x] `npx playwright test tests/e2e/e1rm-strength.spec.ts` — **3/3 PASS** (no collateral).

## Decision

**pass**

Reasoning:
- The round-1 adjacent regression is CLOSED: `progress-page.spec.ts` is 8/8 green, with the previously-RED #4 now passing — confirmed by running the spec myself and reading the JSON per-test status (`unexpected:0`).
- The feature spec is still 3/3 green — no collateral from the locator change.
- The round-2 change is test-only (one locator + comment in `progress-page.spec.ts`); no e1RM feature code changed, confirmed via `git diff`.
- All static gates green (444/444 unit).

**Recommendation to Conductor: finalize.**

### Final QA sign-off
The Phase-2a e1RM strength chart works end-to-end and is shippable. Across both I↔T rounds the feature was proven: the "Estimated 1RM per exercise" section renders below the muscle-volume section with a VISIBLE SVG line that trends UP as logged weight increases (round-1 runtime polyline probe + full-page screenshot), per-line chips and check-all/uncheck-all toggle correctly, and a bodyweight-only user correctly produces NO line. The single round-1 fallout — a fragile bare-text `.first()` locator in the adjacent `progress-page.spec.ts :: 4` that bound to the new e1RM legend chip — is fixed by adopting the role+accessible-name locator the sibling test #8 already uses; the regression is verified closed (8/8, live). Invariant D (bodyweight `weight=0` never eligible) is exercised end-to-end in the feature spec; Invariants E1 (MAX-not-sum) and LOCF (carry-forward + leading flat lead-in) are pinned by the green 13-case unit suite — their correct home. No e1RM feature code changed in round 2.

---

### Confidence / risk summary (per finding)
- Round-1 regression closed (#4 passes): **HIGH** (ran the spec live, JSON `unexpected:0`).
- Feature spec still green (no collateral): **HIGH** (ran it live, JSON `unexpected:0`).
- Change is test-only (no feature code touched in round 2): **HIGH** (`git diff` inspected; only `progress-page.spec.ts` `+7 -1`).
- Static gates green: **HIGH** (observed 444/444, typecheck 0, lint 0 err).
- Native (iOS/Android) correctness: **LOW** confidence asserted (not exercised) — but round-2 change is web-test-only, so **risk LOW**. Overall ship risk: **LOW**.
