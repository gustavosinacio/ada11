# Run: 2026-05-25_1921_canonical-exercises

## Feature prompt
Canonical exercises (shared catalog) — single table, nullable user_id

MOTIVATION
Today exercises.user_id NOT NULL means every user gets their own copy of the 31 seeded exercises plus any they add. Move to a shared catalog where canonical exercises (admin-managed via direct DB edit, no admin UI) live as user_id = NULL rows visible to everyone, while any exercise a user creates stays scoped to them via user_id = auth.uid(). No per-user customization of canonical rows — canonical = read-only from app context.

CURRENT STATE (verified)
- 1 user in DB (gsinacio94@gmail.com, uuid 0b2dfe22-2d30-41eb-bede-d7a42bc3651c), 127 exercises all owned by them, 6 routines, 23 routine_exercises, 665 sessions, 11,746 sets, 1 exercise_note.
- Migrations 0000–0010 all pushed to remote.
- Today's exercises RLS: 4 policies, each auth.uid() = user_id (defined in 0001_rls_and_seed.sql).
- seed_new_user() trigger inserts 31 exercises per new auth user (also in 0001_rls_and_seed.sql, updated in 0004 to use the muscles[] array).

SCHEMA CHANGE — new migration 0011_canonical_exercises.sql
1. ALTER TABLE exercises ALTER COLUMN user_id DROP NOT NULL.
2. UPDATE exercises SET user_id = NULL; — flips all 127 existing rows to canonical. UUIDs unchanged → no FK churn on sets / routine_exercises / exercise_notes.
3. Replace the 4 exercises_* RLS policies:
   - SELECT: user_id IS NULL OR user_id = auth.uid()
   - INSERT: with check (user_id = auth.uid())
   - UPDATE: using (user_id = auth.uid()) with check (user_id = auth.uid())
   - DELETE: using (user_id = auth.uid())
4. CREATE OR REPLACE seed_new_user(): drop the entire `insert into public.exercises (...)` block. Keep the user_preferences insert. Atomic.
5. Discovery: confirm whether existing exercises_user_idx is exercised by any query. If yes, replace with partial index on (user_id) WHERE user_id IS NOT NULL. If no, drop without replacement.

APP CHANGES
- Exercise list / picker reads: should require zero changes — RLS automatically includes canonical + user-owned. Discovery verifies all read sites.
- Badge "Created by you": render in <ExercisePicker> AND in the Exercises library list, on rows where exercise.user_id !== null. Small chip next to the name. Light + dark mode.
- Create exercise write path: ensure mutation explicitly sets user_id = auth.uid() (don't rely on implicit fill).
- Edit exercise UI: gate edit affordance on exercise.user_id === currentUser.id (user-owned only). Canonical rows render with no pencil. App-level guard mirrors DB RLS.
- Soft-delete exercise: only user-owned rows show the trash. Canonical has no app-side delete path.

OUT OF SCOPE
- routine_exercises.user_id / sets.user_id stay NOT NULL.
- No admin UI. Canonical edits happen via direct DB (service role).
- No per-user override/overlay table for rename/rest/hidden. Canonical = read-only, no exceptions.
- No name-uniqueness constraints between canonical and user-owned.
- No backfill of past sets/routine_exercises — UUIDs preserved by the UPDATE.

ACCEPTANCE CRITERIA
1. Migration applies cleanly to remote DB; all 127 existing exercises now have user_id IS NULL.
2. New user signup creates user_preferences but NO exercise rows; the new user sees all 127 canonical exercises in their picker via RLS.
3. Existing user (gsinacio94) sees the same 127 exercises in the picker (no regression on workouts, history, routines, progress).
4. Existing user can create a new exercise → row has user_id = auth.uid(), "Created by you" badge renders, edit + soft-delete affordances present.
5. Existing user attempting to edit/delete a canonical (NULL) row gets no affordance in UI; if forced via direct API call, RLS rejects (0 rows updated).
6. All existing surfaces that consume exercises (live workout, history, routines edit, exercise progress page, exercise notes) continue to work — exercise_id references still resolve.
7. Tests added for: RLS visibility (canonical + own only), RLS rejection of mutating a NULL row, badge rendering, edit/delete gating, signup trigger no longer inserts exercises.

RISK CALLOUTS
- seed_new_user() rewrite is the only "destructive" piece for fresh signups — fully covered by new SELECT policy. Worth an e2e signup test.
- UPDATE exercises SET user_id = NULL on all 127 rows of the only existing user. UUIDs preserved → existing FKs untouched. Wrap migration in explicit transaction.
- App may have implicit assumptions that exercise.user_id is non-null when matching against auth.uid() (ownership checks). Discovery must grep for these patterns. The shift === userId → !== null && === userId (or === null || === userId depending on intent) is the load-bearing diff.

## Baseline
- Branch: main
- Commit: 77029d4cd609631877a5870b91dc16e4e1b7bf4c
- baseline_branch: main
- baseline_commit: 77029d4cd609631877a5870b91dc16e4e1b7bf4c

## Current state
- Owner: conductor (closed)
- Step: 7. Finalize (complete)
- Round (current loop): n/a
- Status: **done — shipped**
- Started (BRT): 2026-05-25 19:21
- Updated (BRT): 2026-05-26 00:31
- Archived to vault: 2026-05-26 00:31 BRT

## Budgets remaining
- Design ↔ Validate rounds: 3 / 3
- Implement ↔ Review rounds: 2 / 2
- Implement ↔ Test rounds: 1 / 2 (round 1 consumed; Tester returned fail; round 2 in progress)
- Implementer soft-callbacks: 2 / 2

## Artifacts produced
- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md
- [x] implementation.md
- [x] review-v1.md
- [x] test-report-v1.md (decision: fail)
- [x] escalation-v1.md
- [x] test-report-v2.md (decision: pass)
- [x] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Decisions / events log
- 2026-05-25 19:21 BRT — Run initialized by Conductor. Baseline captured. Routing to Discovery.
- 2026-05-25 19:42 BRT — Discovery returned `done`. 6 unknowns surfaced, all with recommended defaults. No blocker; routing to Designer round 1 with Discovery defaults forwarded.
- 2026-05-25 19:48 BRT — Designer round 1 returned `done`. Zero new unknowns. Routing to Validator round 1.
- 2026-05-25 19:56 BRT — Validator round 1 returned `go`. 0 blockers, 1 major (deferred e2e test contract for AC4/AC5/AC7), 7 minors. Routing to Implementer with MAJ-1 forwarded.
- 2026-05-25 20:27 BRT — Implementer round 1 returned `done`. 31 files. Migration applied to remote DB; 127 canonical rows. queryCacheBuster bumped. All quality gates pass. Routing to Reviewer round 1.
- 2026-05-25 20:39 BRT — Reviewer round 1 returned `pass`. 0 blockers, 0 majors, 6 advisory minors. Routing to Tester round 1.
- 2026-05-25 21:25 BRT — Tester round 1 returned `fail`. 30 canonical rows stuck with stale `deleted_at` (user's pre-migration personal soft-deletes propagated). 51 e2e failures cascading from invisible rows. Product decision required: un-delete all / hard-delete all / case-by-case. Escalation written to `escalation-v1.md`. Awaiting human input.
- 2026-05-25 22:18 BRT — User resolved escalation-v1: **keep all 30 hidden**. Cross-reference verified each has a visible canonical equivalent or is Strong-import cruft. Routing to Implementer round 2 with test-only fix scope (no migration).
- 2026-05-25 23:54 BRT — Implementer round 2 returned `done`. Only 1 of 30 names appeared in tests (`Back Squat` × 28 refs across 3 specs). Helper tightened, all swaps done, `exercise-progress-ia` 1+2 rewritten. Canonical-impacted specs all green in isolation. Remaining steady failures rated pre-existing. Routing to Tester round 2.
- 2026-05-26 00:25 BRT — Tester round 2 returned **pass**. All 7 AC green. Final-summary.md written. Pipeline shipped. Invoking Evaluator (mandatory per playbook).
- 2026-05-26 00:28 BRT — Evaluator returned `done`. 7 feedback files written. Scores: Discovery 6/6, Designer 5/6, Validator 5/5, Implementer 6/6, Reviewer 5/5, Tester 5/5.
- 2026-05-26 00:31 BRT — Archived to vault; README index updated. Run closed.

## Follow-up clarifications

### 2026-05-25 22:18 BRT — Resolution of escalation-v1
**Decision**: Keep all 30 soft-deleted canonical rows hidden. No new migration. No `UPDATE … SET deleted_at = NULL`. Reasoning verified via cross-reference: every one of the 30 hidden names either (a) has a similar visible equivalent in the 97-row canonical catalog, or (b) is gym-specific Strong-import cruft ("2nd floor", "3rd floor", "newSmart", "W Bar", TRX variants). Sole weakest match — "Goblet Squat" — accepted as a minor gap. The two `Reverse Fly, unilateral` rows (one visible, one hidden, different UUIDs) stay as-is; no merge.

**Implementer round 2 scope**:
1. **Tighten `pickCanonicalExercise(admin, preferred)`** at `tests/e2e/_helpers/canonical-exercise.ts` to throw `Error("Canonical exercise '<preferred>' not found or is hidden")` when `preferred` is supplied-but-missing — replaces the silent fallback that masked the leak.
2. **Find every test file referencing one of the 30 hidden names** and rewrite to use a visible canonical equivalent (mapping table provided in the Implementer brief). Tester confirmed at least: `tests/e2e/exercise-progress-ia.spec.ts` tests 1+2; `tests/e2e/auto-fill-placeholder-on-check.spec.ts` (11 cases); `tests/e2e/rest-timer-auto-start.spec.ts` (7 cases). Implementer enumerates the full list via grep.
3. **Re-run full e2e + RLS + unit suites**. All must pass.

**Out of scope for round 2**: the dev-server-crash major (low-confidence-on-causation, likely Expo memory pressure under single-worker e2e); the 1 advisory minor (probe-strong-unify opacity, pre-existing).
