# Test report v1 — 2026-05-25_1921_canonical-exercises

Testing: implementation against `design-v1.md`. Round 1 of ≤2 Implement↔Test rounds.

## Environment

- Commands used to run app: `npm run web` (Expo dev server on `http://localhost:8081`, web target).
- Browser / device: headless Chromium 147 via Playwright (web only — iOS / Android not exercised; design has no platform-specific code).
- Test data: remote Supabase project (URL `EXPO_PUBLIC_SUPABASE_URL` from `.env.local`). Existing user `gsinacio94@gmail.com` left untouched; each scenario provisions an ephemeral confirmed user via `auth.admin.createUser` and deletes it in `finally`.
- BRT: 2026-05-25 21:13.

## Quality-gate sanity checks

| Command | Result |
|---|---|
| `npm run typecheck` | pass — zero errors. |
| `npm run lint` | pass — 0 errors, 1 pre-existing warning in `.expo/types/router.d.ts` (auto-generated). |
| `npm run test:unit` | pass — 364 tests across 23 files. |
| `npx tsx tests/rls.test.ts` | pass — all 4 blocks + canonical-exercises arm (6 sub-assertions: admin canonical insert; clientA/B SELECT canonical; clientA UPDATE → 0 rows + admin re-read intact; clientA DELETE → 0 rows + intact; clientA INSERT `user_id=null` rejected; anon SELECT canonical succeeds). |
| `npx tsx tests/seed-and-auth.test.ts` | pass — 0 owned exercises for new user; 127 canonical present; RLS user-client read = 127 canonical via widened SELECT. |
| `npx playwright test` (full suite) | **fail — 70 passed / 51 failed / 1 timed out (122 total)**. See "E2E suite results" below. |

## DB invariants (service-role admin read)

| Query | Expected | Actual | Result |
|---|---|---|---|
| `select count(*) from exercises where user_id is null` | 127 | **127** | pass |
| `select count(*) from exercises where user_id is not null` | 0 | **0** | pass |
| `select count(*) from exercises` (total) | 127 | 127 | pass |
| `select count(*) from exercises where user_id is null and deleted_at is null` | 127 (implicit AC2/AC3) | **97** | **fail — 30 canonical rows arrive with `deleted_at` set** |
| Sample 5 canonical names (ASC) | Includes "Back Squat" + 4 nearby | "Arnold Press (Dumbbell)", "Back Extension", **"Back Squat" → soft-deleted**, "Bench Press", "Bench Press - Close Grip" | partial fail |

The migration `0011_canonical_exercises.sql` flipped `user_id = NULL` for all 127 rows but preserved each row's prior `deleted_at`. Because the user (`gsinacio94`) had previously soft-deleted 30 of their per-user exercises through the app, those 30 rows are now soft-deleted **canonical** rows — invisible to every user via the picker / library list, including a brand-new signup. Concrete leaked names (sample): `Back Squat`, `Bicep Curl`, `Cable Tricep Pushdown`, `Chin Up`, `Goblet Squat`, `Push Up`, `Pull Up/Chin Up`, `Tricep Extension`, plus 22 more.

This contradicts the spirit of `state.md` AC2 ("the new user sees all 127 canonical exercises in their picker via RLS") and AC3 ("existing user … sees the same 127 exercises"). It is also the upstream cause of the e2e-suite cascade (next section).

## E2E suite results (per spec)

| Spec | Pass | Fail | Timeout |
|---|---:|---:|---:|
| auth.spec.ts | 7 | 0 | 0 |
| auto-fill-placeholder-on-check.spec.ts | 0 | **11** | 0 |
| canonical-exercise-gating.spec.ts | **5** | 0 | 0 |
| chart-scroll-week-selector.spec.ts | 4 | 0 | 0 |
| crud.spec.ts | 6 | 0 | 0 |
| end-of-session-verdict.spec.ts | 2 | 0 | 0 |
| exercise-note.spec.ts | 6 | 0 | 0 |
| exercise-progress-ia.spec.ts | 2 | **2** | 0 |
| exercise-session-row-list.spec.ts | 3 | 0 | 0 |
| max-volume-window.spec.ts | 6 | 0 | 0 |
| measurements.spec.ts | 8 | 0 | 0 |
| probe-strong-unify.spec.ts | 7 | 1 | 0 |
| progress-page.spec.ts | 8 | 0 | 0 |
| read-only-history.spec.ts | 5 | 0 | 0 |
| remove-exercise.spec.ts | 1 | 0 | 1 |
| rest-timer-auto-start.spec.ts | 0 | **7** | 0 |
| routines-add-exercise-race.spec.ts | 0 | 1 | 0 |
| session-total-volume-header.spec.ts | 0 | 5 | 0 |
| set-row-menu.spec.ts | 0 | 3 | 0 |
| soft-deleted-exercises-in-history.spec.ts | 0 | 1 | 0 |
| soft-deleted-session-volume-leak.spec.ts | 0 | 4 | 0 |
| volume-target.spec.ts | 0 | 7 | 0 |
| week-drill-down.spec.ts | 0 | 5 | 0 |
| weekly-volume-strip.spec.ts | 0 | 4 | 0 |
| **TOTAL** | **70** | **51** | **1** |

### Failure clustering

1. **Soft-deleted canonical leak (root cause for ≥20 failures, confirmed)**.
   - All 11 `auto-fill-placeholder-on-check` failures: `gotoLiveSession` expects `getByText("Back Squat")` to appear in the live workout. The helper `pickCanonicalExercise(admin, "Back Squat")` filters `deleted_at IS NULL` → no match → silent fallback to `Arnold Press (Dumbbell)` (the first canonical name ASC). Routine seeded with the wrong exercise; "Back Squat" never appears; 15 s timeout. Confirmed via trace inspection of `auto-fill-placeholder-on-c-08e5a-uts-filled-→-no-extra-await/trace.zip`: the GET `/routine_exercises?...` response shows `Arnold Press (Dumbbell)` at `position=1`, not `Back Squat`.
   - All 7 `rest-timer-auto-start` failures: same `gotoLiveSession` shape, same `Back Squat` expectation, same fall-through.

2. **Canonical pencil regression on legacy specs (2 failures, confirmed)**.
   - `exercise-progress-ia.spec.ts`:
     - test 1 (`golden-path …`): clicks `Bench Press` in the library, expects header pencil "Edit exercise" → expects to enter the edit screen and save / delete. Bench Press is canonical → no pencil; the test times out at line 107. The same test then expects to delete the canonical row, which is also gone from the UI.
     - test 2 (`cache: finishing a session does not break the progress screen …`): clicks Bench Press, expects pencil after re-entering progress; canonical → no pencil; times out at line 202.
   - These two specs were not migrated by the Implementer (no `.eq("user_id", userId)` pattern to grep) but they encode an assumption that breaks under the canonical contract.

3. **Dev-server crash mid-suite (cascade, ~31 failures)**.
   - Around 21:07 BRT the Expo dev server process died (verified — `curl http://localhost:8081` returned `000 FAILED` post-suite, no listener on port 8081). Every spec that ran after the crash failed with `net::ERR_CONNECTION_REFUSED at http://localhost:8081/sign-in` (sampled: `set-row-menu`, `volume-target`, `week-drill-down`, `weekly-volume-strip`, `routines-add-exercise-race`, `soft-deleted-*`, `session-total-volume-header`). I cannot distinguish here between specs that would have failed on their own (likely some of these also depend on `Back Squat`/`Tricep Pushdown` and would have hit the soft-delete leak) and specs that are collateral damage from the crash. After restarting the dev server, a focused re-run of the first failing spec (`auto-fill-placeholder-on-check.spec.ts`) reproduced the soft-delete failure cleanly — confirming the root cause is data, not crash.
   - Root cause of the server crash is unverified — could be memory pressure from a long single-worker run, or an in-app exception triggered by an unexpected route. Out-of-scope to fully diagnose here, but the suite is not reliably runnable in this state.

4. **Unrelated probe-strong-unify failure**: `probe-strong-unify.spec.ts` test 5 asserts `opacity == "0.6"` on an active-session routine card, received `"1"`. Adjacent to recent UI changes; not obviously canonical-related. Could be a pre-existing flake; flagged here but not the primary fail driver.

## Golden path (UI flow)

**Spec** (from design): canonical rows render without the "Created by you" chip; a user-created exercise renders WITH the chip; canonical progress screen omits the pencil; canonical edit screen (via deep link) renders read-only with only a Back button; user-owned progress screen shows the pencil; user-owned edit screen exposes the full form + Save + Cancel + Delete.

**Steps run** (standalone runner via headless chromium; mirrors `canonical-exercise-gating.spec.ts`):

1. Admin-create confirmed user `tester-golden-<ts>@test.com`; sign in via the UI sign-in form.
2. `/exercises` (library list) — wait for `Bench Press` visible; count `getByLabel("Created by you")`.
3. Admin-seed `My Custom Lift <ts>` with `user_id=<userId>, muscles=["Chest"], equipment="Barbell"`.
4. Purge localStorage `ada11-query-cache`, navigate away to `/workout`, purge again, return to `/exercises`; wait for `My Custom Lift` visible; recount chips.
5. `/exercises/<canonical-id>/progress` — wait for `Bench Press` visible; count `getByLabel("Edit exercise")`.
6. `/exercises/<canonical-id>` (deep-link edit) — wait for "Name" label; count `Save changes`, `Delete exercise`, check `Back` visible.
7. `/exercises/<own-id>` — wait for `Save changes`; count `Save changes`, `Delete exercise`.
8. `/exercises/<own-id>/progress` — wait for own name; count pencil.
9. Cleanup: admin-delete the ephemeral user.

**Observed counts**:

```
[library/canonical-only] chips present: 0       (expect 0)   pass
[library/with-own]       chips present: 1       (expect ≥ 1) pass
[progress/canonical]     pencils present: 0     (expect 0)   pass
[progress/own]           pencils present: 1     (expect ≥ 1) pass
[edit/canonical]         save=0 delete=0 back=true   (expect 0,0,true) pass
[edit/own]               save=1 delete=1             (expect ≥1, ≥1)   pass
```

**Result**: **pass**

**Evidence (screenshots)**:

- `docs/runs/2026-05-25_1921_canonical-exercises/screenshots/01-library-canonical-only.png` — canonical-only library; no chips visible. **Note: "Back Squat" is missing from the alphabetical run between "Back Extension" and "Bench Press" — direct visual confirmation of the soft-delete leak (it's not the screenshot framing, the row is filtered out).**
- `.../02-library-with-own-chip.png` — same viewport; user-owned row is below the fold (alphabetically M-prefixed), but `getByLabel("Created by you").count() === 1` confirms it renders.
- `.../03-progress-canonical-no-pencil.png` — Bench Press header has no pencil affordance; exercise-note textarea is still editable (consistent with AC6 — notes are user-owned).
- `.../04-edit-canonical-read-only.png` — title "Exercise" (not "Edit exercise"); read-only field labels NAME / MUSCLES / EQUIPMENT / NOTES; single Back button; no Save / Cancel / Delete.
- `.../05-edit-own-full-form.png` — title "Edit exercise"; full editable form (Name input, MuscleGroupPicker chips, Equipment + Notes inputs); Save changes + Cancel buttons; Delete is below the fold (counted via locator).
- `.../06-progress-own-with-pencil.png` — header has pencil top-right.

## Edge cases

### Edge 1: RLS rejection of mutating a canonical row (AC5 destination gate)

**Steps**: in `tests/rls.test.ts` block 4 + `canonical-exercise-gating.spec.ts` test 5: signed-in user attempts UPDATE/DELETE against a canonical row directly via `userClient`.

**Expected**: 0 rows affected; admin re-read confirms intact.

**Actual**: 0 rows affected (`updRows.length === 0`, `delRows.length === 0`). Admin re-read confirms `name`/`deleted_at` unchanged. INSERT-spoof of `user_id = null` rejected with non-empty error.

**Result**: **pass**.

**Evidence**: `tests/rls.test.ts` exit 0 ("✅ RLS test passed — B cannot read/update/delete A's data; canonical rows visible to both users + immutable via RLS.").

### Edge 2: New-user signup creates no exercise rows + sees the canonical catalog via RLS (AC2)

**Steps**: in `tests/seed-and-auth.test.ts`: create ephemeral user → wait for trigger → admin-count `.eq("user_id", userId)` exercises → user-client SELECT canonical count.

**Expected**: 0 owned exercises; ≥ 25 canonical visible via RLS.

**Actual**: 0 owned; 127 canonical visible via RLS (test logs "RLS allows user to read canonical exercises (127 rows)").

**Result**: **pass** at the RLS / count level — but **partial fail at the UX level**: those 127 include 30 with `deleted_at` set, so the user's picker actually shows 97 names. The seed-and-auth test does not filter `deleted_at`, so it doesn't catch the issue. AC2's intent ("the new user sees all 127 canonical exercises in their picker") is violated.

### Edge 3: Anonymous (no-JWT) read of canonical (looser-variant pin from Discovery U1)

**Steps**: `tests/rls.test.ts` arm 7 — create supabase client with no `signInWithPassword`; SELECT a canonical row by id.

**Expected**: row returned (anon allowed by SELECT policy `user_id IS NULL OR auth.uid() = user_id`).

**Actual**: row returned. Result: **pass**.

## Regression check (adjacent surfaces)

- **Live workout (start, add exercise, log a set, complete)**: **fail** in the e2e suite. `rest-timer-auto-start` (7 tests) + `auto-fill-placeholder-on-check` (11 tests) all use a two-exercise routine seeded with canonical Bench Press + canonical Back Squat. With Back Squat soft-deleted in the catalog, the helper falls back, the routine ends up with Bench Press + Arnold Press (Dumbbell), and the rest-timer / auto-fill assertions never reach their UI anchor. Concrete: see "E2E suite results — Failure clustering #1" above and the trace evidence cited.
- **History (open past session, drill into progress)**: not directly verified in the failing window (likely the `soft-deleted-session-volume-leak` and `week-drill-down` failures are server-crash cascade, not actual history regressions). Adjacent `read-only-history.spec.ts` (5 tests) passed.
- **Routines (edit, add canonical, save)**: `routines-add-exercise-race` (1) and `routines` flow in `crud.spec.ts` (6 tests passed) — the latter is clean. The former is in the dev-server-crash window so the failure mode is uncertain.
- **Progress page (PRs + weekly volume strip)**: `progress-page.spec.ts` (8 tests) passed. `weekly-volume-strip.spec.ts` (4 tests) failed entirely — but again, all in the dev-server-crash window.
- **Exercise notes on canonical**: visually confirmed in screenshot 03 (the textarea "Add a note for this exercise…" is rendered on a canonical exercise's progress page, consistent with AC6 — notes are user-owned and remain editable on canonical exercises). `exercise-note.spec.ts` (6 tests) passed.

## Cross-platform

- Web: tested. **Mixed result** — UI shape passes; data invariants partially fail; e2e suite cascade is broken.
- iOS: not tested. Reason: design has no native-specific code path; the chip uses the same NativeWind shape as `pr-list-row.tsx:48-52` which is already shipping on iOS; no platform divergence risk introduced by this diff. The Reviewer's MIN-1 (chip a11y on native) is the only nuance — flagged for follow-up, not blocking.
- Android: not tested. Same reasoning as iOS.

## Test commands

- [x] `npm run typecheck` — 0 errors.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning.
- [x] `npm run test:unit` — 364/364 pass.
- [x] `npx tsx tests/rls.test.ts` — pass (canonical arm green).
- [x] `npx tsx tests/seed-and-auth.test.ts` — pass at RLS-count level (does NOT exercise `deleted_at` filter; misses the leak).
- [x] `npx playwright test` (full suite) — **70 pass / 51 fail / 1 timeout / 122 total**.

## Specific AC verdicts (per Conductor brief)

| AC | Verdict | Evidence (one-line) |
|---|---|---|
| **AC1** (migration applied; 127 canonical, 0 owned) | **partial fail** | counts pass (127 / 0) but 30 of the 127 carry stale `deleted_at` → user-visible canonical is 97. |
| **AC2** (new signup: no exercises; 127 canonical via RLS) | **partial fail** | `seed-and-auth.test.ts` shows 127 visible via raw RLS read; UI picker shows 97 (the live filter drops `deleted_at IS NOT NULL`). |
| **AC3** (existing user sees same 127) | **partial fail** | by symmetry with AC2; existing user picker also shows 97. |
| **AC4** (create new exercise → row has `user_id = auth.uid()` + chip + edit/delete) | **pass** | golden-path screenshots + `canonical-exercise-gating.spec.ts` test 2 + RLS arm. |
| **AC5** (canonical row has no edit/delete affordance; forced API rejected) | **pass** | screenshots 3 + 4 + `canonical-exercise-gating.spec.ts` tests 3-5 + `rls.test.ts` block 4. |
| **AC6** (existing surfaces unchanged) | **fail** | 51 e2e failures in adjacent specs; ≥ 20 confirmed traceable to the soft-delete leak; remainder in the dev-server-crash window. Two confirmed `exercise-progress-ia` regressions are real (canonical-pencil expectation). |
| **AC7** (tests pass: RLS visibility / rejection / chip / gating / signup) | **fail at the suite level** | the new arms (`rls.test.ts`, `seed-and-auth.test.ts`, `canonical-exercise-gating.spec.ts`) all pass; but `state.md` AC7 says **tests added**, and the broader e2e contract requires the existing suite to keep passing — it does not. |

## Counts

- **Blockers**: 2 — (a) soft-deleted-canonical leak (30 rows; root cause of ≥ 20 spec failures + a real UX regression for canonical picker); (b) `exercise-progress-ia.spec.ts` tests 1 + 2 encode an assumption that breaks under the canonical contract (canonical pencil expected) and were not migrated.
- **Majors**: 1 — dev-server crash mid-suite; not reproducibly diagnosed but the suite is not reliably runnable in its current state.
- **Minors**: 1 — `probe-strong-unify.spec.ts` test 5 opacity assertion (`"0.6"` vs `"1"`); possibly pre-existing flake; flagged for confirmation only.

## Decision

**fail**

### Reasoning

Blocker (a) — soft-deleted-canonical leak — is the load-bearing defect. The migration's design checklist (step 2: `UPDATE exercises SET user_id = NULL`) preserved every row's pre-existing `deleted_at` value. The user (`gsinacio94`) had previously soft-deleted 30 of their per-user exercises through the app; those rows now ship as soft-deleted **canonical** rows, invisible in the picker / library / helper-by-name lookup. Three downstream consequences:

1. **Production UX regression**: every user (existing + new signup) sees 97 picker rows where AC2/AC3 says 127. Names lost include common lifts: `Back Squat`, `Bicep Curl`, `Goblet Squat`, `Pull Up/Chin Up`, `Push Up`, `Tricep Extension`. This is the spec contract being violated, not a test-suite quirk.

2. **Test-suite cascade**: 18 confirmed e2e failures (11 auto-fill + 7 rest-timer) all stem from `pickCanonicalExercise(admin, "Back Squat")` filtering `deleted_at IS NULL` and silently falling back to `Arnold Press (Dumbbell)`. The helper's fallback masks the leak; the live-workout assertion times out 15s later with no useful error. A larger fraction of the remaining ≥ 31 dev-server-crash-window failures likely have the same cause (every spec depending on Back Squat, Bicep Curl, Tricep Pushdown, etc. as canonical seeds is in the same trap).

3. **AC violations**: AC1, AC2, AC3, AC6 are all partial or full fail because of this single missing line in the migration.

Suggested fix (single statement, single transaction; cheap):

```sql
-- Add to 0011_canonical_exercises.sql (or a follow-up 0012_*):
update public.exercises set deleted_at = null where user_id is null;
```

Blocker (b) — `exercise-progress-ia.spec.ts` tests 1 + 2 — is independent. The tests click "Bench Press" in the library and expect the progress-screen pencil + the edit screen's Save / Delete affordances. Under the canonical contract those affordances are deliberately suppressed. The Implementer's spec-migration pass (16 specs migrated via the `.eq("user_id", userId)` grep) did not catch these two because the assertion shape is different. Fix: seed a user-owned exercise at the start of each test and click it instead of `Bench Press`, OR change the tests' expectations to assert canonical read-only shape (which would arguably overlap with `canonical-exercise-gating.spec.ts`).

Major (a) — dev-server crash — should not block the round-2 fix; the focused re-run after restart reproduced the soft-delete failure cleanly, so the crash didn't materially obscure the root cause. But it's worth keeping an eye on whether the canonical implementation triggers it (could be unrelated Expo memory pressure under a 24-spec single-worker run).

Recommendation: **return to Implementer for round 2**, with these scoped fixes:

1. Add `update public.exercises set deleted_at = null where user_id is null;` to a new migration `0012_*.sql` (do not edit 0011, which is already applied to remote). Run `npm run db:push` to apply. Re-verify AC1 / AC2 / AC3 invariants (expect `count(*) where user_id is null and deleted_at is null = 127`).
2. Update `tests/e2e/exercise-progress-ia.spec.ts` tests 1 + 2 to admin-seed a user-owned exercise at the top and click that instead of `Bench Press`.
3. (Optional, defense-in-depth) Tighten `tests/e2e/_helpers/canonical-exercise.ts` to throw when `preferred` is supplied but missing, instead of silently falling back to the first row name-ASC. This would have caught the leak as a spec error on round 1.
4. Re-run the full `npx playwright test` and confirm it returns 0 failures (or only the unrelated probe-strong-unify minor, which I've flagged separately).

Round budget after this decision: Implement↔Test rounds 1 / 2 used. One round remaining.

## Notes for Conductor / Evaluator

- The `tester-golden-screenshots` script I used to capture the 6 evidence PNGs was removed after the run (`tests/_tester-golden-screenshots.ts`) — not committed. The flow it exercises is structurally identical to `canonical-exercise-gating.spec.ts` (same admin-create-user → sign-in-via-UI → admin-seed → screenshot pattern) plus the explicit `localStorage.removeItem("ada11-query-cache")` purge between picker reads.
- The dev server PID changed mid-run; my re-run after restart used `nohup npm run web` (pid 86859). The original suite's run completed under the original dev server which then died.
- I did NOT exercise the `exercise-note.spec.ts` "write a note on a canonical exercise" flow as a standalone — but the spec's 6 tests all passed in the suite, and the canonical progress screenshot (03) directly shows the note textarea rendered on a canonical exercise. Adjacent contract verified.
- No new flake or non-determinism observed in the new test additions; all 5 `canonical-exercise-gating.spec.ts` tests pass cleanly. The Reviewer's MIN-3 (preflight SELECT to harden test 5) is still a worthwhile follow-up but did not actually break in this run.
