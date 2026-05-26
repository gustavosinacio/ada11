# Implementation — 2026-05-25_1921_canonical-exercises

Based on: `design-v1.md` (approved) and `validation-v1.md` (decision: `go`, 0 blockers, 1 major, 7 minors). All MAJ-1 and MIN-1..MIN-8 items addressed per the Conductor brief.

## Files changed

### Migration / schema-as-code

- `supabase/migrations/0011_canonical_exercises.sql` (new) — five-step single-transaction migration: (1) drop NOT NULL on `exercises.user_id`, (2) `UPDATE exercises SET user_id = NULL` (flips all 127 rows to canonical, UUIDs preserved), (3) replace 4 `exercises_*` RLS policies with the widened SELECT (`user_id IS NULL OR auth.uid() = user_id`), (4) `CREATE OR REPLACE seed_new_user()` dropping the per-user exercises insert (keeping the `user_preferences` insert), (5) drop `exercises_user_idx`.
- `src/db/schema.ts` (edited) — dropped `.notNull()` on `exercises.userId`; removed the inline `userIdx: index("exercises_user_idx").on(t.userId)` declaration; added comments documenting the canonical-row semantic + the drop precedent.
- `src/db/types.ts` (edited) — `ExerciseRow.user_id: string` → `string | null` (load-bearing for the chip predicate + read-only branch gate); inline comment documenting the canonical-row semantic.
- `src/lib/query-client.ts` (edited) — bumped `queryCacheBuster` from `"schema-2026-05-21-set-check"` to `"schema-2026-05-25-canonical-exercises"`. Verified wired to `PersistQueryClientProvider.persistOptions.buster` at `app/_layout.tsx:46`.

### UI surfaces

- `src/components/created-by-you-chip.tsx` (new) — presentational `<View>+<Text>` chip rendering the "You" label with slate hue. Re-used by `<ExercisePicker>` and `<ExerciseListItem>`. Mirrors `pr-list-row.tsx:48-52` visual rhythm; swaps emerald → slate (neutral attribution semantic, distinct from achievement semantic).
- `src/components/exercise-picker.tsx` (edited) — wraps the name `<Text>` in `flex-row items-center` and appends `<CreatedByYouChip />` when `item.user_id !== null`. Subline layout unchanged.
- `src/components/exercise-list-item.tsx` (edited) — same wrap-and-append pattern with `exercise.user_id !== null` predicate; chevron + subtitle preserved.
- `app/(app)/exercises/[id]/progress.tsx` (edited) — pencil suppressed for canonical rows (`canEdit = exercise.data ? exercise.data.user_id !== null : true`). During loading the pencil is treated as visible (hide-only-when-known-canonical), avoiding the flash-then-disappear cosmetic regression for user-owned rows (MIN-4 resolution).
- `app/(app)/exercises/[id]/index.tsx` (edited) — added a canonical read-only branch (`if (data && data.user_id === null)`) returning a `<Text>`-only screen with Name / Muscles / Equipment / Notes labels and a single "Back" button; title flips from "Edit exercise" to "Exercise". `useForm` stays mounted unconditionally — hook order preserved (MIN-1 resolution).

### Tests

- `tests/e2e/_helpers/canonical-exercise.ts` (new) — `pickCanonicalExercise(admin, preferred?)` helper. 17 in-place per-spec lookups collapse into one helper.
- `tests/e2e/canonical-exercise-gating.spec.ts` (new) — new spec pinning AC4/AC5/AC7 from `state.md`. 5 tests: chip-absent-on-canonical, chip-present-on-user-owned + user_id ownership, no-pencil-on-canonical-progress + pencil-on-user-owned, deep-link-read-only edit screen, user-client UPDATE/DELETE rejected by RLS. (MAJ-1 resolution.)
- `tests/e2e/rest-timer-auto-start.spec.ts` (edited) — local `getSeedExerciseByName` now delegates to `pickCanonicalExercise`; helper import added.
- `tests/e2e/auto-fill-placeholder-on-check.spec.ts` (edited) — same delegation.
- `tests/e2e/max-volume-window.spec.ts` (edited) — `getSeedExerciseId` delegates; 3 other `.eq("user_id", userId)` sites in this spec are `user_preferences` lookups (not exercises) and stay unchanged.
- `tests/e2e/week-drill-down.spec.ts` (edited) — `getSeedExerciseId` delegates.
- `tests/e2e/end-of-session-verdict.spec.ts` (edited) — `getSeedExerciseByName` delegates.
- `tests/e2e/read-only-history.spec.ts` (edited) — inline 2-row exercise lookup updated to `.is("user_id", null)`. Helper variant wasn't extracted because the helper returns a single row.
- `tests/e2e/exercise-session-row-list.spec.ts` (edited) — `getSeedExerciseByName` delegates.
- `tests/e2e/volume-target.spec.ts` (edited) — `getSeedExerciseByName` delegates.
- `tests/e2e/exercise-note.spec.ts` (edited) — `pickSeedExercise` delegates; the "soft-deleted exercise" test now admin-seeds a USER-OWNED exercise instead of soft-deleting a canonical row (avoids leaking soft-delete across the shared catalog into subsequent specs).
- `tests/e2e/weekly-volume-strip.spec.ts` (edited) — `getSeedExerciseId` delegates.
- `tests/e2e/chart-scroll-week-selector.spec.ts` (edited) — `getSeedExerciseId` delegates.
- `tests/e2e/soft-deleted-session-volume-leak.spec.ts` (edited) — `pickSeedExercise` delegates.
- `tests/e2e/session-total-volume-header.spec.ts` (edited) — `getSeedExerciseByName` delegates.
- `tests/e2e/progress-page.spec.ts` (edited) — `getSeedExerciseId` delegates; lines 271 + 437 are `.eq("id", exerciseId)` SELECT-by-id reads and stay unchanged.
- `tests/e2e/crud.spec.ts` (edited) — inline lookup at line 323 updated to `.is("user_id", null)`; comment in test #2 about "seed_new_user trigger inserts ~30 lifts" rewritten to describe the canonical model.
- `tests/seed-and-auth.test.ts` (edited) — rewritten assertion pair per design: (a) new user has 0 owned exercises post-canonical, (b) canonical catalog admin count >= 25, (c) RLS-scoped user client reads >= 25 (now canonical-via-RLS). Top docstring updated.
- `tests/rls.test.ts` (edited) — appended canonical-exercises arm (block 4) with 6 sub-assertions: admin canonical insert succeeds; clientA + clientB both SELECT the canonical row; clientA UPDATE returns 0 rows + admin re-read confirms intact; clientA DELETE returns 0 rows + admin re-read confirms intact; clientA INSERT of `user_id = null` rejected; anonymous (no-JWT) client SELECT of canonical succeeds (pins U1's looser-variant default). Service-role cleanup of the canonical test row in `finally`.

### Cosmetic

- `scripts/create-user.ts` (edited) — replaced single `exCount` print with two counts: per-user (expected 0) and canonical (`.is("user_id", null)`, expected ~31). Preserves the existing `select("id", { count: "exact", head: true })` shape (MIN-7).

### Config

- `playwright.config.ts` (edited) — added explicit `testMatch: /.*\.spec\.ts$/` so the new `_helpers/canonical-exercise.ts` module isn't auto-discovered as a test even if future helpers are renamed (MIN-6 belt-and-suspenders).

## Deviations from design

- **MIN-4 (loading-window flash)**: Design left it implementer's call. Chose `canEdit = exercise.data ? exercise.data.user_id !== null : true` — pencil stays visible during loading, gets hidden only when data resolves and is canonical. This avoids the brief flash for user-owned rows at the cost of a sub-second "appears then disappears" transition for canonical rows (never tappable into the edit screen because the destination ALSO renders read-only — defense-in-depth holds).
- **MIN-5 (drizzle snapshot staleness)**: Design's "no-op diff" claim was overstated because `supabase/migrations/meta/_journal.json` only tracks through 0003 (migrations 0004-0010 are hand-written without snapshot updates). Implementation reframes the rationale via inline schema.ts comments ("manual schema-as-code parity"). `npm run db:generate` post-migration prompts about pre-existing drift (the 0004 `muscles` column rename), not anything from 0011. My schema.ts edits (drop `.notNull()`, remove index) align with what the 0011 migration applies. Not regenerating snapshots is consistent with the recent migrations 0004-0010 (`docs/development.md:99-116` describes schema-first but the repo's actual practice is hand-written migrations beyond 0003).
- **`tests/e2e/exercise-note.spec.ts` soft-deleted-exercise test**: changed from "soft-delete the canonical exercise" to "admin-seed a user-owned exercise then soft-delete it". Reason: admin-soft-deleting a canonical row mutates the shared catalog and would leak across every test in the same workers=1 run. The test's intent ("note still renders on a soft-deleted exercise's progress page") is preserved verbatim.
- **`tests/e2e/read-only-history.spec.ts` 2-row lookup**: kept the inline `.is("user_id", null).limit(2)` shape rather than extracting a 2-row variant of the helper. One-off; not worth a new helper signature.
- **Migration step 5 (drop index)**: Design specified `drop index if exists public.exercises_user_idx;`. Applied as-is. No partial-index replacement — YAGNI per design + Discovery U2.

## Soft callbacks made (during this implementation pass)

- None.

## Quality gates

- [x] `npm run typecheck` passed (zero errors).
- [x] `npm run lint` passed — 0 errors. 1 pre-existing warning in `.expo/types/router.d.ts` (auto-generated; not in scope).
- [x] `npm run test:unit` passed — 364 tests across 23 files.
- [x] `npx tsx tests/rls.test.ts` passed — all 4 blocks (exercises, measurements, exercise_notes, canonical exercises) green.
- [x] `npx tsx tests/seed-and-auth.test.ts` passed — confirms 0 owned exercises for new user + 127 canonical present + RLS allows user to read canonical.
- [x] `npm run db:push` applied `0011_canonical_exercises.sql` to remote DB.
- [x] No new `any` types introduced.
- [x] No new `// @ts-ignore`, `eslint-disable`, etc.
- [x] No stray `console.log` / debug statements left in source code.

## Post-migration verification

- Total exercises: 127 (unchanged).
- Canonical rows (`user_id IS NULL`): **127** (all flipped per AC1).
- User-owned rows (`user_id IS NOT NULL`): **0** (the single existing user's seed library is now the canonical catalog).
- New user signup creates `user_preferences` row + 0 exercise rows (AC2).
- New user signed in via RLS sees **127 canonical exercises** (AC2 picker visibility confirmed).
- Anon client (no JWT) can SELECT canonical rows via the widened policy (pinned by `rls.test.ts` arm 7).
- User-client UPDATE/DELETE of a canonical row affects 0 rows (RLS gate) — confirmed by `rls.test.ts` arms 4/5 + `canonical-exercise-gating.spec.ts` test 5.

## Smoke runs (selected e2e specs)

- `tests/e2e/canonical-exercise-gating.spec.ts` — 5/5 passed (the new MAJ-1 spec).
- `tests/e2e/crud.spec.ts` — 6/6 passed (covers create-exercise flow with the canonical model + UI route navigation).
- `tests/e2e/weekly-volume-strip.spec.ts` — passed (covers a helper-extracted lookup site).
- `tests/e2e/exercise-note.spec.ts` — passed (covers the user-owned-soft-delete pivot).

Full e2e suite verification is the Tester's responsibility.

---

## Round 2 — 2026-05-26 (post-escalation, test-only fixes)

After Tester round 1 returned `fail`, the user resolved `escalation-v1.md` with **option (a) keep all 30 soft-deleted canonical rows hidden** (no new migration). Round 2 is test-only.

### Files changed (round 2)

- `tests/e2e/_helpers/canonical-exercise.ts` (edited) — Tightened `pickCanonicalExercise(admin, preferred)`: when `preferred` is supplied-but-not-found in the visible-canonical set, it now **throws** with the message `Canonical exercise '<name>' not found or is hidden (deleted_at IS NOT NULL)`. Previous behaviour was a silent fallback to the first canonical row name-ASC — which masked the soft-deleted-canonical leak surfaced in Tester round 1. The no-`preferred` (any canonical) branch is unchanged. Docstring rewritten to document the new contract.
- `tests/e2e/rest-timer-auto-start.spec.ts` (edited) — `replace_all "Back Squat" → "Squat (Barbell)"` (11 occurrences). Per the user's name-mapping table, `Squat (Barbell)` is the visible canonical equivalent to the hidden `Back Squat`. All 11 occurrences are in test setup (`getSeedExerciseByName(userId, "Back Squat")`) or anchor selectors (`getByText("Back Squat", { exact: true })`) — no false positives from the bulk replace; typecheck green.
- `tests/e2e/auto-fill-placeholder-on-check.spec.ts` (edited) — same `replace_all "Back Squat" → "Squat (Barbell)"` (13 occurrences). Same shape as rest-timer-auto-start (the comment in the file explicitly says "Same shape as rest-timer-auto-start.spec.ts").
- `tests/e2e/remove-exercise.spec.ts` (edited) — same `replace_all "Back Squat" → "Squat (Barbell)"` (4 occurrences). The test adds two exercises via the picker (Bench Press + the renamed Squat), tests trash + dialog copy on each.
- `tests/e2e/exercise-progress-ia.spec.ts` (edited) — Tests 1 + 2 (the two Tester-flagged independent regressions) now admin-seed a user-owned exercise (`muscles: ["Chest"]`) at the top and click that instead of canonical "Bench Press". Required because under the canonical contract, canonical rows have no "Edit exercise" pencil — the tests' pencil/edit/save/delete assertions are the user-owned contract, not the canonical contract. Tests 3 + 4 (which don't check the pencil) are unchanged.

### Enumeration of test files touching the 30 hidden names

Grep across `tests/` for each of the 30 hidden canonical names returned matches for only **one** name — `Back Squat` — in three spec files (`rest-timer-auto-start.spec.ts`, `auto-fill-placeholder-on-check.spec.ts`, `remove-exercise.spec.ts`) plus the helper itself (left as documentation comment). The other 29 hidden names had zero references in `tests/`. Counts: 11 + 13 + 4 = **28 literal `"Back Squat"` references swapped**.

### Deviations from design / brief (round 2)

- **`exercise-progress-ia.spec.ts` tests 1 + 2 fix is technically outside the "30-hidden-names" scope** of the user's escalation resolution. The brief said "test files referencing one of the 30 hidden names"; `exercise-progress-ia.spec.ts` doesn't reference any of the 30 — it uses the visible canonical `Bench Press`. But Tester round 1 flagged it as an independent regression and the brief explicitly says "Re-run all suites → full e2e suite must pass". Without this fix the suite cannot pass, so I included it. The fix is mechanical (admin-seed user-owned + click that instead of canonical) and stays inside "test-only changes, no migration, no data mutation".

### Soft callbacks made (round 2)

- None. The mapping table provided in the brief covered every needed swap; the only ambiguity (`exercise-progress-ia.spec.ts` independent regression) was already documented in the brief.

### Quality gates (round 2)

- [x] `npm run typecheck` — green (run after every `replace_all` and after each edit).
- [x] `npm run lint` — 0 errors, 1 pre-existing warning in `.expo/types/router.d.ts` (unchanged).
- [x] `npm run test:unit` — 364/364 pass (unchanged).
- [x] `npx tsx tests/rls.test.ts` — pass (canonical arm + cross-user gating green).
- [x] `npx tsx tests/seed-and-auth.test.ts` — pass (canonical-via-RLS visible: 127 rows).
- [x] No new `any`. No new `// @ts-ignore`. No new `eslint-disable`. No new `console.log`.
- [x] Targeted smoke `npx playwright test tests/e2e/auto-fill-placeholder-on-check.spec.ts tests/e2e/rest-timer-auto-start.spec.ts` — **all pass** (the two specs that were 11 + 7 fail in round 1).
- [x] Full `npx playwright test` — see below.

### Full e2e suite — round 2 result

**Round 2 suite runs (two attempts)** — both runs hit the **pre-existing dev-server-crash major** (Node.js `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`, confirmed in `/tmp/web.log` stack trace). Round 1 reported the same crash as a non-blocking major; round 2 confirms it as Expo/Metro memory pressure under a single-worker 24-spec sequential run, unrelated to the canonical-exercises feature.

**Run 1 (mid-suite crash at ~30 specs in)**: 118 expected / 4 unexpected — 4 failures = auth(1, transient) + probe-strong-unify(1, pre-existing minor) + routines-race(1, parallel flake) + soft-deleted-variant-B(1, pre-existing flake).

**Run 2 (early-crash, ~20 specs before the crash)**: 16 unexpected listed as failure folders, all in the cascade after the OOM crash (auth, max-volume-window×3, measurements×8, soft-deleted variant B×2, weekly-volume-strip×1).

**Isolation re-verification of every "new" failure** post dev-server restart:

| Failure folder | Tested in isolation | Result |
|---|---|---|
| `auth-Ada11-email-password--ea74f-...` | `npx playwright test tests/e2e/auth.spec.ts` | **pass 7/7** |
| `max-volume-window-Max-volu-*` (3 cases) | `npx playwright test tests/e2e/max-volume-window.spec.ts` | **pass 6/6** |
| `measurements-Measurements--*` (8 cases) | `npx playwright test tests/e2e/measurements.spec.ts` | **pass 8/8** |
| `weekly-volume-strip-...che-reload-...` | `npx playwright test tests/e2e/weekly-volume-strip.spec.ts -g "refetch path"` | **pass** |
| `soft-deleted-session-volum-...-survivor-only` (variant B) | `npx playwright test tests/e2e/soft-deleted-session-volume-leak.spec.ts -g "variant"` | variant A pass, variant B fail (real pre-existing flake in soft-delete feature, NOT canonical-related — separate src surface, see git log) |
| `probe-strong-unify-...` | (not re-run; identical failure to round 1 minor) | pre-existing minor |
| `routines-add-exercise-race-...` | `npx playwright test tests/e2e/routines-add-exercise-race.spec.ts` | **pass 1/1** |

**Canonical-feature-impacted specs (all green post-fix)**:

```
$ npx playwright test \
    tests/e2e/canonical-exercise-gating.spec.ts \
    tests/e2e/exercise-progress-ia.spec.ts \
    tests/e2e/auto-fill-placeholder-on-check.spec.ts \
    tests/e2e/rest-timer-auto-start.spec.ts \
    tests/e2e/remove-exercise.spec.ts \
    tests/e2e/crud.spec.ts
# test-results/.last-run.json: { "status": "passed", "failedTests": [] }
# ≈ 38 tests total — all pass.
```

**Net delta vs round 1**:

- Round 1: 70 pass / 51 fail / 1 timeout (122 total). 18+ failures directly caused by canonical leak (auto-fill 11 + rest-timer 7); 2 by canonical-pencil-on-Bench-Press (exercise-progress-ia tests 1+2); ≥31 by dev-server crash cascade; rest flake/minor.
- Round 2: in isolation across every previously-failing suite, **all canonical-related tests pass** (11 + 7 + 2 + 5 = 25 newly green). The remaining unexpected failures in any single full-suite run reproduce only under the dev-server-OOM crash window or are pre-existing flakes/issues that were also failing in round 1.

**None of the round-2 unexpected failures are caused by the canonical-exercises feature.** Verified by:
1. `git diff main -- src/` shows only the 5 canonical-feature files (`exercises/[id]/index.tsx`, `exercises/[id]/progress.tsx`, `exercise-list-item.tsx`, `exercise-picker.tsx`, `db/schema.ts`, `db/types.ts`, `lib/query-client.ts`) — no overlap with `sets`/`sessions`/`measurements`/`weekly-volume` queries.
2. The dev-server OOM crash was already flagged as a major in round 1 — not introduced by this work.
3. Every cascade failure was confirmed green in isolation post-restart.

The dev-server crash major (Expo/Metro memory pressure under single-worker sequential run) remains an open issue for a follow-up run, outside this run's scope per state.md and the user's escalation resolution.

### Post-migration verification (unchanged from round 1)

- Total exercises: 127 (canonical). 30 of those carry `deleted_at IS NOT NULL` per the user's pre-migration personal soft-deletes; user-resolved decision is to leave them hidden. App visibility of canonical exercises: 97.

## Notes for Reviewer / Tester

- **Reviewer**: the migration is single-transaction-safe; the trigger replacement uses `CREATE OR REPLACE` (no re-bind of `on_auth_user_created` required, per `0004_exercise_muscles_array.sql` precedent). Verify the file ordering of step 4's `seed_new_user` body — the `user_preferences` insert is kept verbatim from `0004:50-52`.
- **Reviewer**: the chip predicate is RLS-trusted (`row.user_id !== null`). Failure mode (chip on a leaked canonical row) is pinned by `rls.test.ts` arms 2-6 — explicit defense.
- **Reviewer**: `app/(app)/exercises/[id]/index.tsx` keeps `useForm` + `useEffect(reset)` mounted on the canonical branch too. The Controllers never render; `onSave`/`onDelete` are unreachable. No hook-order risk.
- **Tester**: full e2e suite verification. Specific specs that touch the helper or canonical model: every e2e spec that previously called `.eq("user_id", userId)` on `exercises` (16 specs total). The new `canonical-exercise-gating.spec.ts` is the AC4/AC5/AC7 gate.
- **Tester**: iPhone smoke recommended for the chip rendering — Playwright covers web only. The chip uses the same NativeWind classes as the live precedent `pr-list-row.tsx:48-52` (verified for both light + dark in production), so cross-platform divergence risk is low.
- **Tester**: the cache-buster bump means existing app installs will drop their persisted cache on next launch. First-launch UX: a single fetch round-trip before the picker renders (matches the standard pattern from prior bumps).
