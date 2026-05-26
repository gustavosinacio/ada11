# Review v1 — 2026-05-25_1921_canonical-exercises

Reviewing: the diff for the canonical-exercises implementation against `design-v1.md` (round 1 approved by Validator with 0 blockers, 1 major, 7 minors).

## Diff scope

- Diff command: `git --no-pager dfl HEAD -- app/ src/ tests/ supabase/ scripts/ playwright.config.ts` (baseline `77029d4cd609631877a5870b91dc16e4e1b7bf4c` recorded in `state.md:56-58`; Implementer's work sits in the working tree, not yet committed).
- Files changed: 30 (1 new SQL migration, 1 new chip component, 1 new e2e helper, 1 new e2e spec, 5 edited source files in `src/`, 2 edited app screens, 16 edited e2e specs, 2 edited backend tests, 1 edited script, 1 edited Playwright config — 26 in the patch-text `diff --git` headers + 4 new files).
- Lines (existing files only): +397 / -197.
- New files: `supabase/migrations/0011_canonical_exercises.sql`, `src/components/created-by-you-chip.tsx`, `tests/e2e/_helpers/canonical-exercise.ts`, `tests/e2e/canonical-exercise-gating.spec.ts`.

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| Migration `0011_canonical_exercises.sql` is the 5-step single-transaction body. | yes | `supabase/migrations/0011_canonical_exercises.sql:14-66`. Steps verbatim with design: ALTER drop NOT NULL → UPDATE → drop+create 4 policies → CREATE OR REPLACE seed_new_user (keeps `user_preferences` insert, drops exercises insert) → DROP INDEX. Header comment names the txn wrapper assumption explicitly (MIN-3 resolved). |
| `src/db/schema.ts` drops `.notNull()` and removes `userIdx`. | yes | `schema.ts:46-71`. `userId` declaration no longer has `.notNull()`; the third `pgTable` positional arg (index builder) is replaced by a code comment. TypeScript accepts `pgTable(name, columns)` (the `extraConfig` arg is optional); `npm run typecheck` returns clean. |
| `src/db/types.ts` flips `ExerciseRow.user_id` to `string \| null`. | yes | `types.ts:86-103`. Doc comment on the field explains canonical vs user-owned + cites the migration file. |
| `queryCacheBuster` bumped. | yes | `src/lib/query-client.ts:27` → `"schema-2026-05-25-canonical-exercises"`. Verified wired at `app/_layout.tsx:46` per validation. |
| `<CreatedByYouChip>` new shared component, light + dark, a11y label. | partial | `src/components/created-by-you-chip.tsx:22-33`. Classes + label match design verbatim; minor a11y nit flagged below (MIN-1). |
| Picker + library list render the chip when `row.user_id !== null`. | yes | `src/components/exercise-picker.tsx:130-137`, `src/components/exercise-list-item.tsx:27-30`. Both wrap the name `<Text>` in `flex-row items-center` + append the chip. |
| Edit screen renders read-only for canonical rows. | yes | `app/(app)/exercises/[id]/index.tsx:115-167`. `useForm` mounted unconditionally above (MIN-1 closure honored); branch returns before any Controller mounts. Title flips to "Exercise"; Back replaces Save/Cancel/Delete. |
| Progress screen pencil hidden for canonical rows. | yes | `app/(app)/exercises/[id]/progress.tsx:50-83`. `canEdit` predicate is `exercise.data ? exercise.data.user_id !== null : true` — hides only when known canonical, avoiding the flash for user-owned (MIN-4 deviation, documented). |
| e2e helper reusable + lookup-by-name aware. | yes | `tests/e2e/_helpers/canonical-exercise.ts:23-46`. `pickCanonicalExercise(admin, preferred?)` returns first canonical name-ordered ASC; preferred-name match path included; throws with descriptive error on empty result. |
| 16 e2e specs migrated to the helper. | yes (with 2 import-order regressions) | All 16 specs named in design now `import { pickCanonicalExercise } from "./_helpers/canonical-exercise"`; the inline lookups collapsed to a single delegating function. Two specs have the helper import placed inside the package-import block — flagged as MIN-2. |
| New `canonical-exercise-gating.spec.ts` covers AC4/AC5/AC7. | yes (with one robustness concern) | `tests/e2e/canonical-exercise-gating.spec.ts` — 5 tests covering chip-absent-on-canonical, chip-present-on-user-owned + ownership invariant, pencil-gating both states, deep-link read-only shape, RLS UPDATE/DELETE rejection. Robustness concern on test #5 documented as MIN-3 below. |
| `tests/rls.test.ts` new canonical-exercises arm. | yes | `rls.test.ts:194-310`. Block 4 added with admin insert → A reads → B reads → A cannot UPDATE / DELETE / INSERT canonical → anon read pin for U1 → cleanup. Re-read-via-admin double-checks robust. |
| `tests/seed-and-auth.test.ts` rewritten. | yes | `seed-and-auth.test.ts:1-126`. Top docstring updated; per-user count must be 0; canonical count >= 25 via admin sanity check; RLS user-client read >= 25 via widened SELECT. |
| `scripts/create-user.ts` cosmetic. | yes | `scripts/create-user.ts:42-66`. Two counts (per-user expected 0, canonical expected ~31). `select("id", { count: "exact", head: true })` shape preserved (MIN-7 honored). |
| `playwright.config.ts` `testMatch` pin. | yes | `playwright.config.ts:17`. Belt-and-suspenders for `_helpers/` directory (MIN-6 honored). Comment overstates Playwright's actual default glob — see MIN-5 below. |
| No new `any`, no `// @ts-ignore`. | yes | `git --no-pager dfl HEAD ... \| grep -E '\bany\b\|@ts-ignore'` returns zero hits. One new `as string` in `rls.test.ts:210` (`canonical.id as string`) + three in the new helper for narrowing Supabase JS `any` return — same pattern as the existing codebase (`progress-page.spec.ts:275, 441`); acceptable per project convention but not zero-cost (MIN-4). |
| `npm run typecheck` clean. | yes | Re-ran locally: zero errors. |
| `npm run lint` clean (1 pre-existing warning). | yes | Re-ran locally: 0 errors, 1 warning in `.expo/types/router.d.ts` (auto-generated, pre-existing per implementation.md). |

## Cross-checks against deviations declared in implementation.md

The Implementer listed 5 deviations. I verified each against the design and the diff:

1. **MIN-4 loading-window flash → `canEdit = data ? data.user_id !== null : true`.** Design left this implementer's call. Trade-off is correctly stated: pencil briefly visible for canonical during the loading window, then hidden once `data` resolves. The destination screen ALSO renders read-only (defense-in-depth), so a fast tap during the flash window lands on a loading spinner then a read-only screen — never on a write affordance. Verified.
2. **MIN-5 drizzle snapshot framing.** `supabase/migrations/meta/_journal.json` confirms the snapshot tracks only through `0003` (read at `_journal.json:4-26`). The Implementer's reframing ("manual schema-as-code parity with the hand-written migration", code comments in `schema.ts:50-54, 65-70`) is the accurate posture; the design's "no-op diff" claim was indeed unverifiable. No new drift introduced by this diff.
3. **`exercise-note.spec.ts` soft-delete pivot to user-owned exercise.** Justified: soft-deleting a canonical row would mutate the shared catalog and leak across every subsequent test (`workers=1`). The contract under test ("note still renders on a soft-deleted exercise's progress page") is preserved — whether the row is canonical or user-owned doesn't change what the contract proves. Acceptable deviation.
4. **`read-only-history.spec.ts` kept inline `.is("user_id", null).limit(2)` rather than extracting a 2-row helper variant.** Reasonable scope discipline — one-off site; not worth a new helper signature.
5. **Migration step 5 (drop index).** Applied as designed; no partial-index replacement (YAGNI per U2 default). Verified.

All 5 deviations stay inside design-allowed flex points. None silently soften a contract the design fixed.

## Issues

### Blockers

None.

### Majors

None.

### Minors

- **[MIN-1]** `src/components/created-by-you-chip.tsx:24-26`: the `accessibilityLabel="Created by you"` lives on a `<View>` that has neither `accessible={true}` nor a press handler. On React Native iOS/Android, screen readers will not announce the label because the View is not marked accessible by default. On RN-Web (the surface the e2e spec exercises via `page.getByLabel("Created by you")`) the label maps to `aria-label` and is exposed — so tests pass and behavior is correct on the web surface. On native, VoiceOver/TalkBack would still announce the visible glyph "You" as part of the surrounding row's accessibility tree, so the chip is not invisible; but the descriptive `"Created by you"` label only ships on web. Not a regression vs the precedent (`pr-list-row.tsx:48-52` has the same shape with the same nuance), but worth pinning since the chip ships in two new surfaces simultaneously. **Fix**: add `accessible={true}` to the wrapping `<View>` (single-line addition), or document the cross-platform a11y posture in the component docstring.

- **[MIN-2]** `tests/e2e/session-total-volume-header.spec.ts:35-37` and `tests/e2e/volume-target.spec.ts:36-40`: the `pickCanonicalExercise` helper import is placed inside the package-imports block (no blank line separation from `@supabase/supabase-js` / `node:fs`+`node:path`), breaking the project's package-first → blank-line → local-imports convention used elsewhere (`progress-page.spec.ts:14-20`, `chart-scroll-week-selector.spec.ts:14-20`, `max-volume-window.spec.ts:14-22`, etc.). Lint passes because the repo has no formal import-order plugin, but the inconsistency is visible on review. **Fix**: move both helper imports below the package-imports block with a blank-line separator. 2 lines per file. The remaining 14 migrated specs are correctly ordered.

- **[MIN-3]** `tests/e2e/canonical-exercise-gating.spec.ts:236-280` (test 5): the RLS-rejection arm asserts UPDATE/DELETE return 0 rows + admin re-read confirms the canonical row is intact. The robustness gap: if `userClient.signInWithPassword` silently produced a session that PostgREST didn't accept (e.g., env-var typo in `.env.local`), then both UPDATE and DELETE would also return 0 rows — but for the wrong reason. The admin re-read at line 270-276 confirms the row is intact, but doesn't prove RLS gated the user client (vs. PostgREST rejecting an unauthenticated request). The existing `tests/rls.test.ts:213-222` arm covers this case more rigorously (it confirms `clientA` can READ the canonical row first, proving the session is authenticated, before testing UPDATE rejection). **Fix**: add a pre-flight `userClient.from("exercises").select("id").eq("id", canonical.id)` assertion expecting 1 row before the UPDATE arm — proves the session is authenticated and SELECT is widened, so subsequent 0-rows on UPDATE/DELETE is the RLS contract being enforced. ~5 lines.

- **[MIN-4]** `tests/e2e/_helpers/canonical-exercise.ts:40-44`: three `as string` casts (`match.id as string`, `match.name as string`, `data[0]!.id as string`, `data[0]!.name as string`) narrow Supabase JS's unspecified return shape to `string`. Consistent with the existing test-code pattern (`progress-page.spec.ts:275, 441`, similar in 5+ other specs). Not a regression. **Fix (optional)**: type the supabase query response inline (e.g., `Pick<ExerciseRow, "id" \| "name">[]`) instead of `as string`-ing each field. Soft preference; the existing convention is already loose so this is debt, not a regression.

- **[MIN-5]** `playwright.config.ts:13`: the comment states the default Playwright glob is `*.spec.ts | *.test.ts`. Actual Playwright default is `**/*.@(spec|test).?(c|m)[jt]s?(x)` (more permissive). The implementer's explicit `testMatch: /.*\.spec\.ts$/` is still correct and useful (it pins to `.spec.ts` only, which IS narrower than the default); the comment overstates exactness. **Fix**: tighten the comment to "Pin discovery to `*.spec.ts` only; ignores the helper module at `tests/e2e/_helpers/canonical-exercise.ts`." 1-line edit.

- **[MIN-6]** `app/(app)/exercises/[id]/index.tsx:50-59`: the `useEffect` calling `reset(...)` runs unconditionally and resets the form with canonical data even when the canonical branch will return read-only at line 120. Wasted work (cheap — one `reset()` call per data fetch), not a correctness bug, but a small inefficiency the Implementer could have avoided by guarding the effect on `data.user_id !== null`. **Fix (optional)**: wrap the effect body in `if (data && data.user_id !== null) { reset(...) }`. Minor; not worth a round 2.

## Security checklist

- [x] **RLS**: new SELECT policy on `exercises` widens to `user_id IS NULL OR auth.uid() = user_id` (verified at `supabase/migrations/0011_canonical_exercises.sql:28-30`). Mutating policies (INSERT/UPDATE/DELETE) stay scoped to `auth.uid() = user_id`, so canonical rows are app-immutable from the client. Defense-in-depth: app-layer pencil gate (`progress.tsx:63`) + read-only edit screen (`index.tsx:120`) match the RLS posture. No new tables introduced; no policies on other tables affected by the diff.
- [x] **No service-role credentials in client code**: `git --no-pager dfl HEAD -- src/ app/ \| grep SERVICE_ROLE` returns zero hits. The chip + edit-screen changes don't introduce any admin/service-role coupling.
- [x] **Input handling**: no raw SQL strings or RPC calls introduced. The new e2e arms use parameterized PostgREST queries (`.eq`, `.is`, `.update({...})`); no string concat.
- [x] **Public env vars**: no new `EXPO_PUBLIC_*` references. The migration adds RLS policies but does not surface any new secret on the wire.
- [x] **`createExercise` cannot spoof `user_id = NULL`**: `src/api/exercises.ts:61-78` reads `userId` from `supabase.auth.getUser()` (guarded with `if (!userId) throw`), passes `user_id: userId` explicitly. RLS INSERT policy `with check (auth.uid() = user_id)` rejects any insert where `user_id != auth.uid()` — including `NULL`. Double-locked.
- [x] **No leak of `user_id` for canonical rows**: canonical rows have `user_id = NULL`, so there is no "leak" surface — `<CreatedByYouChip>` predicate is `row.user_id !== null`, which evaluates false for canonical. No new code paths surface the user_id field outside what the existing API already returns.

## Style / convention checklist

- [x] **No new `any`** — verified by diff scan.
- [x] **No new `// @ts-ignore`** — verified by diff scan.
- [/] **No new `as` casts** — 4 new `as string` casts (1 in `rls.test.ts`, 3 in the new helper). Consistent with existing test-code style. Flagged as MIN-4.
- [x] **Comments narrate *why*, not *what***. Spot-checked: `schema.ts:50-54` (explains semantic), `progress.tsx:50-62` (explains the loading-window trade-off), `created-by-you-chip.tsx:3-21` (explains why a component vs. inline + contrast rationale). All passes.
- [/] **Imports follow project style** — 14 of 16 migrated specs do; 2 (volume-target, session-total-volume-header) interleave the helper import inside the package block. Flagged as MIN-2.
- [x] **New files placed in conventional folder**: `src/components/created-by-you-chip.tsx` (neighbors all in `src/components/`), `tests/e2e/_helpers/canonical-exercise.ts` (new `_helpers/` subfolder is reasonable for test-only modules; Playwright config explicitly handles discovery). `supabase/migrations/0011_*` follows the existing migration cadence.

## Decision

**pass**

Reasoning:

- **Zero blockers, zero majors, six minors.** None of the minors are functional regressions; all are stylistic, robustness-improvement, or documentary nits. Per the playbook gate (0 blockers + ≤1 major = pass), this clears comfortably.
- **Design fidelity**: every file the design named was edited as designed (table at `design-v1.md:13-66` cross-references the diff hunks 1-to-1). All 5 declared deviations are within the design's explicit flex points (MIN-4 was implementer's call; MIN-5 was a Validator-flagged factual correction the implementer carried through; the `exercise-note.spec.ts` pivot and `read-only-history.spec.ts` inline lookup are pragmatic scope discipline).
- **MAJ-1 closure**: the new `canonical-exercise-gating.spec.ts` covers AC4 (test 2 asserts `own.user_id === userId`), AC5 (tests 3, 4, 5 — pencil absent, deep-link read-only, RLS rejection), and AC7 (combined with the new `rls.test.ts` arm + the rewritten `seed-and-auth.test.ts`). Test 5 has a robustness gap (MIN-3) but doesn't undermine the contract — it's redundant coverage for the `rls.test.ts` arm, which has the stronger pre-flight read.
- **Security**: RLS policies match the design verbatim. The widened SELECT + tightened mutating-policy posture is implemented correctly and defended at the DB layer; the app-layer chip predicate (`!== null`) is RLS-trusted with a documented failure-mode bound. `createExercise` cannot spoof `user_id = NULL` because of both the API layer (explicit `userId` insert) and the RLS INSERT policy (`with check auth.uid() = user_id` rejects NULL).
- **Type-level rigor**: `user_id: string | null` propagates cleanly through the codebase; no non-null assertion or `as string` hides the new nullability at a load-bearing consumer site. The progress-screen and edit-screen predicates explicitly handle both `null` and `undefined` (loading state).
- **No scope creep**: the diff is bounded to the design's file list + the four new artifacts the design enumerated. No surprise files.

Recommendation: **invoke Tester**. The six minors are non-blocking; the Tester can either include them in their test-report-v1 comments or the Implementer can address them as a follow-up batch. None require a round 2 of Implement↔Review.
