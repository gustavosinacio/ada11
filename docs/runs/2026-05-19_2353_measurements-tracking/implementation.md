# Implementation — 2026-05-19_2353_measurements-tracking

Based on: `design-v2.md` (approved) and `validation-v2.md` (`go`, 6 non-gating minors).

## Files changed

**NEW**

- `supabase/migrations/0005_measurements.sql` — symmetric `weight_unit` CHECK; `length_unit` column + CHECK on `user_preferences`; `measurement_entries` table (10 nullable numerics + body-fat-pct + notes); composite ASC index `(user_id, measured_at)`; UNIQUE partial expression index on `(user_id, date(measured_at AT TIME ZONE 'UTC')) WHERE deleted_at IS NULL`; RLS enable + 4 policies; `touch_updated_at` trigger. No edits to `seed_new_user()` — relies on column default for new signups (MAJ-1 Path A).
- `src/api/measurements.ts` — five functions (`listMeasurements`, `getMeasurement`, `createMeasurement`, `updateMeasurement`, `softDeleteMeasurement`) + `DuplicateMeasurementDateError` class. Discriminates `PostgrestError.code === '23505'` AND `error.message`/`error.details` containing `measurement_entries_user_day_idx`. Includes the MIN-2026.05-5 comment noting that adding more UNIQUE indexes requires updating the discrimination logic.
- `src/hooks/use-measurements.ts` — TanStack hooks (`useMeasurements`, `useMeasurement`, `useCreateMeasurement`, `useUpdateMeasurement`, `useSoftDeleteMeasurement`). Cache keys `["measurements"]` (umbrella) + `["measurements", id]` (detail). Mutations only invalidate `["measurements"]`; create/update mutations additionally `setQueryData` on the detail key. Does NOT touch `["stats"]`, `["sessions"]`, etc.
- `src/utils/measurements-form.ts` — string-shaped zod schema (`measurementsSchema`), `parseOptionalDecimal`, `buildSubmitPayload(values, { weightUnit, lengthUnit })`, `rowToFormValues(row, { weightUnit, lengthUnit })` (MIN-2026.05-3 adapter), `emptyMeasurementFormValues(today)`, `formatDateInput(d)`. Range validation lives here (weight 20-400 kg, body-fat 2-60%, circumferences 5-250 cm, notes ≤500). At-least-one-metric refine throws a `z.ZodError` keyed on `weightKg`.
- `src/components/measurement-list-item.tsx` — pressable row with formatted local date + headline metrics (`weight · body-fat · waist`), notes preview, chevron affordance.
- `app/(app)/measurements/_layout.tsx` — `<Stack screenOptions={{ headerShown: false }} />` matching exercises precedent.
- `app/(app)/measurements/index.tsx` — list/history screen with loading / error / empty / populated branches. Empty copy: `"No measurements logged yet. Log your first to start tracking progress."` + `"Log measurement"` CTA. Pull-to-refresh via `FlatList`.
- `app/(app)/measurements/new.tsx` — 6-section form (Date / Weight & body fat / Upper body / Core / Lower body / Notes). Section headers use `mt-4 mb-2 text-sm font-medium uppercase text-gray-500`. Duplicate-date banner + `Open existing entry` CTA with cache lookup + refetch fallback + inline "Couldn't find" notice (MIN-2026.05-4).
- `app/(app)/measurements/[id].tsx` — edit screen. `reset(rowToFormValues(data, …))` on data arrival. `isDirty`-gated save. Soft-delete with `confirmDelete({ title: "Delete measurement?", message: "This entry will be hidden from your history." })`. Same duplicate-date banner pattern (the lookup also excludes the current id).
- `tests/unit/measurements-units.test.ts` — 11 tests for `cmToIn` / `inToCm` / `formatLength` / `parseLengthToCm` (round-trip, null/undefined, comma decimal, conversion correctness).

**EDIT**

- `src/db/schema.ts` — added `lengthUnit` column on `userPreferences` (`text("length_unit").notNull().default("cm")`). Added `measurementEntries` table with 13 columns + composite index `measurement_entries_user_measured_idx`. The UNIQUE partial expression index is left as a SQL-only artifact (with an explanatory comment) since Drizzle's typed index builder does not ergonomically express `date(... AT TIME ZONE ...)` with `WHERE`.
- `src/db/types.ts` — re-exported `measurementEntries`; added `MeasurementEntry`/`NewMeasurementEntry` inferred types; added `LengthUnit = "cm" | "in"`; added `MeasurementEntryRow` snake_case shape (numerics as `string | null`).
- `src/utils/units.ts` — added `cmToIn`, `inToCm`, `formatLength`, `parseLengthToCm` (mirror of the kg quartet); `CM_PER_IN = 2.54`.
- `src/api/preferences.ts` — `UserPreferencesRow` now carries `length_unit`. Added `setLengthUnit(unit)` mirror of `setWeightUnit`.
- `src/hooks/use-preferences.ts` — added `useLengthUnit()` and `useSetLengthUnit()` (both share the existing `["preferences", "me"]` key).
- `app/(app)/_layout.tsx` — added `Ruler` to the `lucide-react-native` import; inserted a 6th `<Tabs.Screen name="measurements" />` between `history` and `profile`. Resulting tab order: Workout / Routines / Exercises / History / Measurements / Profile.
- `app/(app)/profile.tsx` — added length-unit toggle row below the weight-unit row inside the same bordered card. The container now holds two rows separated by a bottom border on the first. Wires up `useLengthUnit` + `useSetLengthUnit`.
- `tests/rls.test.ts` — appended a `measurement_entries` block after the existing exercises checks: A inserts a minimal row (`user_id`, `measured_at`, `weight_kg: "80"`); B reads/updates/deletes and each must yield zero rows.
- `tests/seed-and-auth.test.ts` — `.select(...)` now fetches `length_unit`; new assertion `prefs[0].length_unit === 'cm'`; log line includes both units.

## Deviations from design

- **Section header className `mt-4 mb-2 …` instead of bare `mb-2 …`.** Treated as an intentional refinement per the task brief (MIN-2026.05-1). Adds breathing room between sections. Functionally identical otherwise.
- **Tab insertion line numbers.** Anchored by the sibling block (`history` followed by `profile`) rather than the literal line numbers, since the validator flagged them as off-by-one (MIN-2026.05-2). Tab order matches the design exactly.
- **`rowToFormValues` adapter co-located in `measurements-form.ts`** rather than inlined in `[id].tsx` (MIN-2026.05-3 explicit). Enables `reset(rowToFormValues(data, ctx))` as a one-liner and keeps display-formatting logic out of the screen. The adapter applies the user's current unit prefs so the edit form shows the same numbers the user would type with their current Profile setting.
- **Duplicate-date banner stale-cache fallback (MIN-2026.05-4):** cache miss → `await list.refetch()` → cache miss again → inline notice ("Couldn't find the existing entry — pull to refresh and try again."). Implemented identically on `new.tsx` and `[id].tsx`; the edit-screen lookup additionally filters out the current id.
- **MIN-2026.05-5 constraint-name discrimination comment** is in the `DuplicateMeasurementDateError` JSDoc in `src/api/measurements.ts`.
- **MIN-2026.05-6 (UTC bucket edge case for users east of UTC)** documented in design risks; the submit pipeline uses local-midnight `parse(...).toISOString()` exactly as the design specifies. No code change needed for the single-user BRT scope.

No soft callbacks were necessary.

## Soft callbacks made (during this implementation pass)

- None.

## Quality gates

- [x] `npm run typecheck` passed — no errors.
- [x] `npm run lint` passed — `0 errors, 1 warnings` (only the pre-existing `router.d.ts` warning).
- [x] Relevant unit tests pass — `npm run test:unit` → **44 / 44 tests passing** across 5 files (existing 33 + new 11 in `measurements-units.test.ts`).
- [x] No new `any` types.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` left in (one `console.warn` on delete failure mirrors the existing exercises `[id]/index.tsx` precedent).

### Migration application

- Applied `0005_measurements.sql` to the linked Supabase project via `npm run db:push`. Output was clean (the `NOTICE` lines about `drop policy if exists / drop trigger if exists` skipping are expected on first apply).

### Integration suite

There is no `npm run test:integration` script — the docs run the integration tests directly via `npx tsx`. Both are now green after the migration:

- `set -a && . ./.env.local && set +a && npx tsx tests/seed-and-auth.test.ts` — pass. Verifies the new column default fires:
  - `✅ user_preferences seeded (weight_unit=kg, length_unit=cm)`
  - `✅ exercises seeded (31 rows)` — confirms `seed_new_user()` was NOT touched.
  - `✅ RLS allows user to read own user_preferences`
  - `✅ RLS allows user to read own exercises (31 rows)`
- `set -a && . ./.env.local && set +a && npx tsx tests/rls.test.ts` — pass for both `exercises` (existing) and `measurement_entries` (new). `✅ RLS test passed — B cannot read/update/delete A's data.`

## Notes for Reviewer / Tester

- **Migration is already applied to the linked Supabase project.** Fresh clones should `npm run db:push`; do NOT `npx supabase db reset` against production — it's destructive.
- **Cache namespace isolation:** `useCreateMeasurement` / `useUpdateMeasurement` / `useSoftDeleteMeasurement` invalidate only `["measurements"]`. Workout/exercise/routine writes never touch this key. Grep for `"measurements"` to confirm — only `src/hooks/use-measurements.ts` and the measurement screens reference it.
- **`DuplicateMeasurementDateError` discrimination** relies on `error.code === '23505'` AND `error.message`/`error.details` containing `measurement_entries_user_day_idx`. If a second UNIQUE constraint is ever added to `measurement_entries`, the discrimination must be updated; there is an inline JSDoc comment to that effect.
- **`measured_at` UTC bucket edge case.** The form submit uses `parse(value, "yyyy-MM-dd", new Date()).toISOString()` per the design. For BRT (UTC-3), local midnight = UTC 03:00 same day, so the UTC bucket aligns with the local calendar day. A user travelling to UTC+N ≥ 4 would observe off-by-one bucketing. Out of scope; logged as a v1.1 follow-up.
- **iPhone tab bar with 6 tabs.** "Measurements" is the longest label and may truncate on the smallest iPhones (iOS truncation, not a layout bug). Documented as a follow-up.
- **`buildSubmitPayload` throws `z.ZodError`** on range failure or "no metric provided" — the screen's `setError(path, ...)` surfaces the inline error against the right field. This resolves validator MIN-3 (RHF + zod string vs number).
- **Soft-deleted measurements do not block re-entry** (UNIQUE index has `WHERE deleted_at IS NULL`). Editing an existing entry's date to collide with a *different* active entry surfaces the duplicate-date banner on `[id].tsx`; the lookup filters out the current id so the banner doesn't self-target.
- **Tester scenarios to cover specifically:**
  1. Log a measurement → appears in the list with the formatted date.
  2. Tap a row → edit screen seeds with display strings (kg/cm or lbs/in depending on the Profile toggles).
  3. Submit empty form → "Log at least one measurement" inline against the Weight field.
  4. Try to log a 2nd entry on the same date → amber banner with deep-link to the existing entry. Tap CTA → navigates to that entry.
  5. Soft-delete a measurement → disappears from the list; logging a new one on the same date succeeds (was blocked, now unblocked because of the `WHERE deleted_at IS NULL` partial unique).
  6. Toggle length unit in Profile → existing list rows reformat (waist rendered via the unit-aware list-item); edit screen re-seeds via the `useEffect(reset, …)` re-run when `lengthUnit` changes (its presence in the deps array is intentional).

## Status

`done`.
