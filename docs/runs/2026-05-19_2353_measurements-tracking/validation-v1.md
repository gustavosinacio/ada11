# Validation v1 — 2026-05-19_2353_measurements-tracking

Reviewing: `design-v1.md`

## Verification of Designer's claims

| Claim | Verified? | Evidence |
|---|---|---|
| `sets.weight` uses `numeric(6,2)` | yes | `src/db/schema.ts:141` |
| `numeric(6,2)` is the canonical precision pattern (also `target_weight`) | yes | `src/db/schema.ts:91,141` |
| `userPreferences` has `weightUnit text NOT NULL DEFAULT 'kg'`, no CHECK constraint | yes | `src/db/schema.ts:33-39`; no CHECK in `0000_schema.sql` or `0001_rls_and_seed.sql` |
| `0000`-`0004` migrations exist and `0005` is the next number | yes | `supabase/migrations/0000_schema.sql`, `0001_rls_and_seed.sql`, `0002_add_notes_columns.sql`, `0003_add_session_name.sql`, `0004_exercise_muscles_array.sql` |
| RLS template = single `do $$ … $$` block with `tables text[]` array + `foreach t in array tables` + 4 policies (select/insert/update/delete) gated by `auth.uid() = user_id` | yes | `supabase/migrations/0001_rls_and_seed.sql:17-44` |
| `touch_updated_at` trigger function + application loop exist; same array-loop pattern | yes | `supabase/migrations/0001_rls_and_seed.sql:104-130` |
| `seed_new_user()` was rewritten in `0004` (full `create or replace function`, replicates the full exercise insert) | yes | `supabase/migrations/0004_exercise_muscles_array.sql:43-90` |
| `exercises` API + hook pattern (5 functions; TanStack with `KEYS.all`/`KEYS.detail`; invalidate `KEYS.all` on writes, `setQueryData(detail)` on update) | yes | `src/api/exercises.ts:11-77`, `src/hooks/use-exercises.ts:12-62` |
| Form pattern = `react-hook-form` + `zodResolver` + `Controller` + `Input`/`Textarea` | yes | `app/(app)/exercises/new.tsx:1-141`, `app/(app)/routines/new.tsx:1-106` |
| Existing forms use `.string().optional().or(z.literal(""))` for optional strings (not `.number().nullable()`) | yes (partial) | `app/(app)/exercises/[id]/index.tsx:25-26`, `app/(app)/routines/new.tsx:14` — no precedent for an optional-numeric pattern; design's `z.number().nullable()` is novel |
| `app/(app)/_layout.tsx` has 5 tabs (workout, routines, exercises, history, profile) | yes | `app/(app)/_layout.tsx:5-43` |
| `["measurements"]` cache key is unused today | yes | grep across `/src` returned no hits |
| Workout writes invalidate `["stats"]`, not anything else cross-domain | yes | `src/hooks/use-sessions.ts:61,97`, `src/hooks/use-sets.ts:43,55,66` |
| `date-fns` is in deps (so `date-fns/parse` works) | yes | `package.json:31` `"date-fns": "^4.1.0"`; current code imports `format`, `parseISO`, `startOfWeek`, etc. but NOT `parse` |
| `usePreferences()` returns under `["preferences", "me"]`; `useWeightUnit()` is a derived read of the same query | yes | `src/hooks/use-preferences.ts:6,15-18` |
| `MeasurementEntryRow` numeric fields will be `string \| null` per Supabase JS | yes | matches `SetRow.weight: string \| null` at `src/db/types.ts:112` |
| `tests/rls.test.ts` and `tests/seed-and-auth.test.ts` exist with the shape design assumes | yes | `tests/rls.test.ts:1-99`, `tests/seed-and-auth.test.ts:1-88` |
| Drizzle `index(...).on(t.userId, t.measuredAt)` encodes `DESC` ordering | **no** | Drizzle's pgcore `.on()` does NOT take a direction modifier in the shape written. `sessions_user_started_idx` (`schema.ts:122`) is written as `.on(t.userId, t.startedAt)` and is implicitly ASC. To be `(user_id, measured_at DESC)` the call must be `.on(t.userId, t.measuredAt.desc())` (Drizzle ≥0.29) or expressed via raw SQL — design's TypeScript snippet is ASC. |
| `weight_unit` has a CHECK constraint (so adding `length_unit IN ('cm','in')` is symmetric) | **no** | `weight_unit` has zero CHECK in `0000_schema.sql` or `0001`. Design adds a CHECK on `length_unit` only → asymmetric strictness. |
| `seed_new_user()` rewrite in `0005` is just an "extension" of `0004`'s body | partial / **risky** | `0001` and `0004` both use `create or replace function ... as $$ ... $$` which fully replaces the body. A new `create or replace` in `0005` must replicate the entire exercise list. Design narrative says "rewrite to include `length_unit: 'cm'`" but does not call out that the full 31-row exercise insert from `0004` must be carried over verbatim. |

## Issues found

### Blockers

(none)

### Majors

- **[MAJ-1]** `design-v1.md §16 (Decisions) + Mudanças por arquivo, "supabase/migrations/0005_measurements.sql"`: design plans to `create or replace function seed_new_user()` to include `length_unit: 'cm'`, but does NOT specify that the new function body MUST replicate the entire exercise-seed block currently in `0004_exercise_muscles_array.sql:54-86`. `create or replace function` fully replaces the body; if Implementer writes only the prefs insert + `length_unit` line, all 31 default exercises stop being seeded on new signup and `tests/seed-and-auth.test.ts` (which asserts `≥ 25` seeded exercises at line 52) will fail in CI. This is a silent, easy-to-miss footgun. **Suggested fix**: design must explicitly state "rewrite the function body to copy the full exercise list from `0004` verbatim and replace ONLY the prefs `insert into user_preferences ...` line with `insert into user_preferences (user_id, weight_unit, length_unit) values (new.id, 'kg', 'cm')`". Alternatively, skip the rewrite and rely on the `default 'cm'` constraint to cover new rows.

- **[MAJ-2]** `design-v1.md §Contratos de I/O > DB columns + §Riscos & mitigações`: design does NOT address duplicate same-day entries. With `measured_at timestamptz default now()` and a date-only UI, a user who opens "New measurement" twice on the same day produces two distinct rows (different `measured_at` time-of-day values). This is exactly the user-mode-of-failure flagged by Discovery Unknown §19. Design picks `timestamptz` over `date` and explicitly defers the duplicate-prevention question to nothing. **Suggested fix**: pick one of (a) add a UNIQUE constraint on `(user_id, date(measured_at))` (a partial expression index `WHERE deleted_at IS NULL`) so Postgres rejects same-day duplicates; (b) keep `timestamptz` but add a client-side guard in the form that queries the existing list and confirms via `Alert` if an entry exists for the chosen date ("You already logged a measurement today. Edit it instead?"); (c) explicitly accept multiple entries per day as a feature and call out the chart-implications in the design. Without one of these, the owner will produce dirty data on day 1.

### Minors

- **[MIN-1]** `design-v1.md §Contratos de I/O > Drizzle table, lines 88-91`: the Drizzle index call `index("measurement_entries_user_measured_idx").on(t.userId, t.measuredAt)` produces an ASC index on both columns, not the `(user_id, measured_at DESC)` claimed in §DB columns and §Riscos. Postgres can scan an ASC index in reverse for `ORDER BY measured_at DESC` so functional impact is zero, but the design contradicts itself. Designer's note in §Riscos ("both directions OK") effectively acknowledges this — should be made explicit in the snippet or the column-table to remove ambiguity. **Suggested fix**: either drop the `DESC` claim from the column/risks section, or change the snippet to `.on(t.userId, t.measuredAt.desc())` (Drizzle ≥0.29 syntax) / a raw SQL index.

- **[MIN-2]** `design-v1.md §16 + §user_preferences ALTER`: design adds `CHECK (length_unit IN ('cm','in'))` on `user_preferences.length_unit` while `weight_unit` has no CHECK constraint at all (verified `0000_schema.sql:1-50`, `0001`). Either both columns should have parallel CHECKs (preferred: add CHECK on `weight_unit` in the same migration) or neither. As written, the schema is asymmetric — a future bug where someone sets `weight_unit = 'stone'` via raw SQL is still possible. **Suggested fix**: either add an equivalent CHECK on `weight_unit` in `0005` for consistency, or remove the CHECK on `length_unit` to match the precedent. Lean toward adding both — defense-in-depth is cheap here.

- **[MIN-3]** `design-v1.md §Contratos de I/O > Form schema`: the zod snippet declares numeric fields as `z.number().min(20).max(400).nullable()`, but the design narrative says "All values come into the form as STRINGS". RHF `defaultValues` would need to be `null`-or-`number` for that schema to validate, while the `<Input>` `value` prop expects a string. The "Implementer's flexibility" disclaimer punts on this, but the contract is incoherent as written. The codebase precedent (`routines/new.tsx:12-15`, `exercises/new.tsx:14-21`) keeps the schema string-shaped and transforms inside the submit handler. **Suggested fix**: lock the contract to "form-side schema is all strings + `transform` to canonical number on submit; range validation lives in a `.refine()` on the transformed value". Specify the transform pipeline so Implementer doesn't invent a third pattern.

- **[MIN-4]** `design-v1.md §UI spec > Screen 2 (New entry)`: 12 fields stacked in a single ScrollView (date + 10 numerics + notes + buttons) is a long form. No section dividers, no collapsible groups, no "weight" vs "circumferences" split. UX-wise this is a wall of inputs. Compare `routines/new.tsx` (2 fields) and `exercises/new.tsx` (4 fields) — no current screen exceeds 4 fields. **Suggested fix**: group the 8 circumferences under a "Body" or "Circumferences" subhead via a `<Text className="mt-4 mb-2 text-sm font-medium uppercase text-gray-500">` divider (matches the Profile screen's "Preferences"/"About" section style at `app/(app)/profile.tsx:26-27,73-74`). Cosmetic but worth specifying so Implementer doesn't ship a 12-field wall.

- **[MIN-5]** `design-v1.md §Riscos & mitigações > Platform-specific`: design claims "`date-fns/parse` already in deps. Verified via existing `src/utils/dates.ts:1-7` import." That's misleading — the file imports `format`, `parseISO`, `startOfWeek`, `subWeeks`, `endOfWeek`, but NOT `parse`. `date-fns` itself is in `package.json:31` so `import { parse } from "date-fns"` does resolve, but the cited evidence doesn't establish it. **Suggested fix**: tighten the citation to `package.json:31` (`"date-fns": "^4.1.0"`); `parse` is exported by `date-fns` v4 directly.

- **[MIN-6]** `design-v1.md §UI spec > Screen 3 (Edit) — confirmDelete copy`: design has two different delete-confirm messages — `"This entry will be hidden from your history."` (table at §Empty-state copy) vs `"This measurement will be hidden. You can still find it later if you restore the database."` (Screen 3 spec). The "restore the database" wording leaks an implementation detail to the user and contradicts the simpler table copy. **Suggested fix**: keep the table version (`"This entry will be hidden from your history."`) and delete the more verbose one.

- **[MIN-7]** `design-v1.md §Decisions §7 + §UI > Tab placement`: design positions Measurements between History and Profile. Adding the file `app/(app)/measurements/_layout.tsx` does not by itself control tab order — order is determined by the sequence of `<Tabs.Screen>` declarations in `app/(app)/_layout.tsx:5-43`. Design should explicitly state "insert the new `<Tabs.Screen name="measurements" ... />` block at lines 33-34 (after `history`, before `profile`)" so Implementer doesn't append at the bottom and end up with Profile in slot 5 and Measurements in slot 6. **Suggested fix**: add a one-liner to the §_layout.tsx file change row specifying the insertion line and order.

## Decision

**no-go**

Reasoning:
- 2 majors (`MAJ-1`: silent regression risk from incomplete `seed_new_user()` rewrite; `MAJ-2`: no duplicate-same-day prevention or accept-decision) trip the decision rule. Both are real risks the owner will hit on day 1 (seed regression breaks new-signup parity and the existing seed test; duplicate entries silently corrupt the history view).
- Issues Designer must address in design-v2:
  1. **MAJ-1**: explicit instruction that `0005_measurements.sql`'s `seed_new_user()` rewrite copies the entire exercise insert block from `0004` verbatim, with the prefs insert line changed to `insert into user_preferences (user_id, weight_unit, length_unit) values (new.id, 'kg', 'cm')`. OR: drop the rewrite and rely on `DEFAULT 'cm'` to cover new rows (and remove the corresponding §18 test extension that would require the rewrite for explicitness).
  2. **MAJ-2**: pick and document a duplicate-same-day strategy — UNIQUE partial index on `(user_id, date(measured_at)) WHERE deleted_at IS NULL`, OR a client-side "you already logged today" guard, OR an explicit "duplicates allowed" stance.
- Minors are not blocking but should be folded into v2 polish: pin the index ordering claim (MIN-1), make the CHECK constraints symmetric (MIN-2), lock the form-schema contract to string-based + `.refine()` (MIN-3), spec the 12-field form's grouping (MIN-4), fix the `date-fns/parse` citation (MIN-5), reconcile the two delete-confirm strings (MIN-6), and spec the tab insertion order (MIN-7).
