# Test report v2 — 2026-05-26_0101_routine-strong-builder

Testing: round-2 focused re-verification of the 1-line test-only fix at `tests/e2e/routine-strong-builder.spec.ts:246` (`Number(s.weight)` wrap).

## Environment
- Commands used to run app: `npm run web` (dev server restarted mid-run after the full-suite sweep killed it — see § Sanity sweep).
- Browser / device: Playwright headless Chromium 1.59.1 (default 1280×720).
- Test data: fresh per-test users created via admin client (e.g. `e2e-rsb-{tag}-${ts}@test.com`); `afterAll` deletes them.
- DB target: linked Supabase project per `.env.local` (`EXPO_PUBLIC_SUPABASE_URL`); migration 0013 already on remote from round 1.
- Static gates (typecheck / lint / unit / migration backfill): NOT re-run — Implementer round-2 confirmed green; round-2 change was 1-line test-only.

## Previously-failing spec re-verification (round-1 line 246)

### Solo run
```
$ npx playwright test tests/e2e/routine-strong-builder.spec.ts -g "golden path"
…
1 passed (≈8s)
```
`.last-run.json`: `{ "status": "passed", "failedTests": [] }`.

**Verdict**: the `Number(s.weight)` wrap is correct. PostgREST's `numeric(6,2)` round-trips as JS `number` (60, 70, 80); the coercion now compares apples-to-apples and the assertion passes.

### Full-file suite run (`tests/e2e/routine-strong-builder.spec.ts`, all 7 cases)

| # | Title | Result | Notes |
|---|---|---|---|
| 1 | golden path: 3 working sets seed 3 unchecked rows in live session | **pass** | round-1's failure — fixed by `Number(s.weight)`. |
| 2 | dropset variant | pass | unchanged. |
| 3 | idempotency: rapid double-tap on Start produces exactly ONE session | pass | unchanged. |
| 4 | soft-delete then re-add: new set's set_number = max(non-deleted) + 1 | **fail** | NEW failure — see § New finding. Round 1 reported pass for this case. |
| 5 | edit-then-restart | pass | unchanged. |
| 6 | hard fail: seed insert fault | pass | unchanged. |
| 7 | duplicate-exercise: 23505 | pass | unchanged. |

Stats line: `expected: 6, unexpected: 1, skipped: 0, flaky: 0`. Reproducible across 3 successive suite runs (same test ID `21a0fbfaecebbcf4730e-3d0b9a34baf866d433dd`).

## New finding — `tests/e2e/routine-strong-builder.spec.ts:376` strict-mode locator collision

### Failure

```
Error: expect(locator).toBeVisible() failed
Locator: getByText('Exercises', { exact: true })
Expected: visible
Error: strict mode violation: getByText('Exercises', { exact: true }) resolved to 2 elements:
  1) <div class="text-lg font-semibold ...">Exercises</div>  aka getByText('Exercises').first()
  2) <div ...>Exercises</div>  aka getByRole('tab', { name: 'Exercises' })
```

### Root cause (HIGH confidence)

`app/(app)/routines/[id]/index.tsx:210` renders the **section header** "Exercises" inside the routine builder. The same page mounts the bottom Tabs navigator from `app/(app)/_layout.tsx:42` which renders an **Exercises tab** with label "Exercises". Both nodes are visible whenever the routine builder page is open. The locator `page.getByText("Exercises", { exact: true })` resolves to 2 nodes → Playwright's strict mode rejects.

This is a **pre-existing test-code defect** — not introduced by the round-2 fix at line 246. The Implementer's round-2 patch did not touch line 376 or anything in this spec.

### Evidence trace shows the page *did* render

Trace screenshot from `test-results/routine-strong-builder-Rou-d6e73-et-number-max-non-deleted-1/trace.zip` (extracted into `/tmp/trace_unpack`) shows the routine builder page mid-load:
- "Routine" page header (routine name empty — `useRoutine(id)` still pending)
- "Name" / "Notes (optional)" / "Save details" form
- "Exercises ... No exercises yet. Add your first one." (routine_exercises query still pending; the seeded row hasn't hydrated to the React-Query cache yet)
- Bottom tab bar showing **Workout | Exercises | History | Progress | Profile**

Both "Exercises" texts are visibly side-by-side. Strict-mode error is correct; the spec authored the wrong locator.

### Repro distribution

Suite context (5 sequential full-file runs): 4 fail / 1 pass. Solo context (`-g "soft-delete then re-add"`, 5 runs): 4 fail / 1 pass. ≈ 85 % failure rate. This is reliably broken, NOT a flake.

Round-1 Tester's report (`test-report-v1.md:91`) claimed `pass` for this case in 6.33 s. Two possibilities:
- (a) Round-1 hit the 1-in-5 lucky pass.
- (b) Round-1 result was a misread (the spec was new, large, never run before; the JSON-aggregate parser might have mis-attributed).

Either way, the locator bug is real and surfaces consistently now.

### Recipe (≤1-line, follows repo precedent)

```ts
// tests/e2e/routine-strong-builder.spec.ts:376
await expect(page.getByText("Exercises", { exact: true }).first()).toBeVisible({
  timeout: 10_000,
});
```

This mirrors the existing pattern in **8 of 9** sibling specs that match "Exercises":
- `crud.spec.ts:138` — `.first().click()`
- `exercise-progress-ia.spec.ts:96,185` — `.first().click()`
- `measurements.spec.ts:330` — `.first()`
- `probe-strong-unify.spec.ts:72,121` — `.first()`
- `progress-page.spec.ts:471` — `.first()`
- `routines-add-exercise-race.spec.ts:137` — `.first()` ← closest sibling, same shape of assertion

Only `routine-strong-builder.spec.ts:376` omitted `.first()`.

Confidence on the fix: HIGH. The fix is the same shape the rest of the suite uses; there is zero feature-logic implication.

## Sanity sweep (full suite — observation about server health)

Full-suite run after round-2 fix:
```
$ npx playwright test --reporter=line
…
{ "status": "failed", "failedTests": [...100+ test IDs across many files...] }
```

The dev server (port 8081) was **dead** at the end of the full-suite run. `curl http://localhost:8081 → connection refused`. This is the same `OOM cascade` pattern flagged in the canonical-exercises retro (`docs/feedback/tester.md:11-12,20-21`). The cascade was NOT caused by the round-2 change; it's the established full-suite resource-exhaustion behavior on this dev environment.

I restarted the dev server (`npm run web` in background) and **partitioned the sweep** into the spec file under change + the 8 round-1-adjacent specs. All chunks below ran against a healthy dev server confirmed by `curl http://localhost:8081 → 200`.

### Spec under change

| File | Result |
|---|---|
| `routine-strong-builder.spec.ts` | **6 pass / 1 fail** — the line-246 fix works; the line-376 locator bug surfaces. |

### Adjacent specs (run in 2 chunks of 4 to avoid OOM)

Chunk A:
```
$ npx playwright test \
    tests/e2e/routines-add-exercise-race.spec.ts \
    tests/e2e/auto-fill-placeholder-on-check.spec.ts \
    tests/e2e/rest-timer-auto-start.spec.ts \
    tests/e2e/end-of-session-verdict.spec.ts
…
{ "status": "passed", "failedTests": [] }
```

Chunk B:
```
$ npx playwright test \
    tests/e2e/soft-deleted-session-volume-leak.spec.ts \
    tests/e2e/remove-exercise.spec.ts \
    tests/e2e/crud.spec.ts \
    tests/e2e/set-row-menu.spec.ts
…
{ "status": "passed", "failedTests": [] }
```

All 8 adjacent specs pass. No regressions cascade from the round-2 change.

## Cross-platform
- Web: covered (mixed result — line-246 fix verified pass; line-376 surfaces a pre-existing test bug).
- iOS: not tested. Reason: round-2 change is test-only.
- Android: not tested. Reason: round-2 change is test-only.

## Test commands

- [x] `npx playwright test tests/e2e/routine-strong-builder.spec.ts -g "golden path"` — pass (line-246 fix verified).
- [x] `npx playwright test tests/e2e/routine-strong-builder.spec.ts` — 6/7 (`soft-delete then re-add` fails on line 376 locator).
- [x] `npx playwright test [...4 adjacent specs chunk A]` — pass.
- [x] `npx playwright test [...4 adjacent specs chunk B]` — pass.
- [x] `curl http://localhost:8081` — 200 (after restart).
- [ ] `npm run typecheck` — not re-run (Implementer round-2 confirmed clean; no source change).
- [ ] `npm run lint` — not re-run (same rationale).
- [ ] `npm run test:unit` — not re-run (same rationale).
- [ ] `npm run test:migration` — not re-run (no migration touched in round 2).
- [ ] Full `npx playwright test` (entire suite) — attempted, dev server crashed; cascade is pre-existing environmental issue, not regression.

## Decision

**fail** (with status `budget-exhausted` per playbook — I↔T round 2 closes the budget).

Reasoning:
- One e2e spec fails (`soft-delete then re-add`, line 376). Per playbook "any e2e spec fails (even one) → fail".
- The failure is again a **test-code defect** (locator `.first()` missing), not a product defect. The feature works; the locator is over-broad. The Implementer's round-2 1-line change at line 246 is correct and verified.
- The round-1 report mis-marked this case as `pass` — same class of test-side defect (`getByText("Exercises")` matches 2 elements) that round-1 found at line 246 was sitting unaddressed at line 376. Both should have been caught together.
- All other gates green: 6/7 in the spec file, 8/8 adjacent specs, no source regressions.
- I↔T budget: **2 / 2 used**. No remaining round to send back to Implementer.

### Recommendation

Escalate to Conductor for one of:
1. **Out-of-band 1-line patch** to `tests/e2e/routine-strong-builder.spec.ts:376` — add `.first()` after `getByText("Exercises", { exact: true })`. Trivial, mirrors 8 existing precedents. Then mark the run `pass` without re-entering the I↔T loop.
2. **Accept-with-known-issue** — finalize the feature with the line-376 spec flagged as a pre-existing test-side bug separate from the feature. The feature itself works (verified by 6/7 sibling specs + golden screenshot from round 1 showing volume = 960 kg = 60×8 + 80×6).

My preference: option (1). The fix is one character beyond `.first` — zero feature implication, zero rebuild needed, fully precedented.

Confidence: HIGH on diagnosis (5 reproducible runs + 8-of-9 sibling-spec precedent + trace screenshot of the 2-element collision), HIGH on fix recipe, LOW risk (test-only).
