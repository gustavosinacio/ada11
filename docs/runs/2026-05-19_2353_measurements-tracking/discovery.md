# Discovery — 2026-05-19_2353_measurements-tracking

## Feature prompt

> Add a measurements functionality. I want to be able to input my current measurements, including weight and sizes of body parts so i can track my progress. It should show the history of the inputs

## Scope summary

Add a "body measurements" feature so the owner can log body weight + body-part circumferences over time and review the history of those entries. This is a **net-new vertical**: no schema, no UI, no nav entry-point, no precedent in the codebase today. Body-weight tracking is explicitly listed as deferred ("Trivial: one new table") in `docs/roadmap.md:124` and `docs/decisions.md:167`. The work spans (a) one (or two) new tables with RLS and triggers, (b) a navigation entry-point (likely a new tab or a Profile sub-route), (c) input form + history list screens, (d) API + hook layers following the existing `["stats"]`-aware patterns, and (e) probable extension of `user_preferences` with a `length_unit` (cm/in) — body weight already inherits `weight_unit`.

## Affected files (verified)

### Will change

- `src/db/schema.ts:33-39` — `user_preferences` likely gains a `length_unit text NOT NULL default 'cm'` column (mirrors `weight_unit`). Possibly other prefs (default body parts list).
- `src/db/schema.ts` (end of file, after `sets`) — **new** `measurement_entries` table (and possibly a `measurement_values` child; see Unknowns §1).
- `src/db/types.ts:12,35` — export inferred types + a row-shape `MeasurementEntryRow` (snake_case for Supabase JS), and a `LengthUnit = "cm" | "in"` literal alongside `WeightUnit` at `src/db/types.ts:29`.
- `src/api/preferences.ts:4-10,27-40` — extend `UserPreferencesRow` and add `setLengthUnit()` (parallel to existing `setWeightUnit()`).
- `src/hooks/use-preferences.ts:6,15-26` — add `useLengthUnit()` + `useSetLengthUnit()`.
- `app/(app)/profile.tsx:32-71` — add a second toggle row (length unit) below the existing weight-unit toggle, identical visual treatment.
- `app/(app)/_layout.tsx:5-43` — add a new `Tabs.Screen` for measurements (assuming the "new tab" routing decision; see Unknowns §7). Owner has 5 tabs today; adding a 6th risks tab-bar crowding on iPhone — discussed below.
- `supabase/migrations/0001_rls_and_seed.sql:8-13,17-44,114-130` — the `tables` arrays must include the new table name (so RLS is enabled, the four policies are applied, and `touch_updated_at` is installed). Pattern: append the literal to **both** `tables text[] := array[...]` declarations.

### New files expected

- `supabase/migrations/0005_<name>.sql` — DDL for the new table(s). Follows the precedent established by `0002_add_notes_columns.sql`, `0003_add_session_name.sql`, `0004_exercise_muscles_array.sql`. The `length_unit` `ALTER TABLE` belongs here.
- `supabase/migrations/0006_<rls_for_measurements>.sql` (OR merge into `0001` if not yet applied in environments — see Constraint §1) — enable RLS + 4 policies + `touch_updated_at` trigger for the new table. Pattern in `0001_rls_and_seed.sql:17-44,114-130`.
- `src/api/measurements.ts` (new) — `listMeasurements`, `getMeasurement`, `createMeasurement`, `updateMeasurement`, `softDeleteMeasurement`. Mirrors `src/api/exercises.ts:11-77` line-by-line.
- `src/hooks/use-measurements.ts` (new) — TanStack Query hook set; key `["measurements"]`. Mirrors `src/hooks/use-exercises.ts:12-62`.
- `app/(app)/measurements/_layout.tsx` (new) — `Stack` wrapper, screen-headers hidden by the inner stack (precedent `app/(app)/exercises/_layout.tsx:1-5`).
- `app/(app)/measurements/index.tsx` (new) — list/history screen.
- `app/(app)/measurements/new.tsx` (new) — input form for a new entry.
- `app/(app)/measurements/[id].tsx` (new) — edit / view detail (TBD per Unknowns §5).
- `src/components/measurement-list-item.tsx` (new) — list row component. Precedent: `src/components/session-summary-row.tsx`, `src/components/exercise-list-item.tsx`.
- `tests/unit/measurements-*.test.ts` (new) — unit math (kg↔lbs already covered; new is cm↔in conversion + formatting). Precedent: `tests/unit/units.test.ts`.

### Read-only references / patterns to follow

- `src/db/schema.ts:33-39` — `user_preferences` table shape (PK = `user_id`, `weight_unit` default `'kg'`). Length-unit extension is a textbook `ALTER TABLE ADD COLUMN ... DEFAULT 'cm' NOT NULL`.
- `src/db/schema.ts:23-31` — `timestamps` helper (`createdAt`, `updatedAt`, `deletedAt`) — every new table must spread `...timestamps`.
- `src/db/schema.ts:41-57` — `exercises` table: shape of a per-user, soft-deletable resource with a `user_idx` index on `user_id`. Closest structural template.
- `src/db/schema.ts:105-124` — `sessions` table: shape of a per-user, **time-anchored** resource with a `(user_id, started_at)` composite index. Best precedent because measurements are similarly time-anchored.
- `supabase/migrations/0001_rls_and_seed.sql:8-13,17-44` — RLS-enable + 4-policy loop template. Adding a new table = adding one literal to two arrays.
- `supabase/migrations/0001_rls_and_seed.sql:46-95` — `seed_new_user()` trigger; **no precedent** for seeding a new-user with default measurement metadata, but if "default body parts" become a thing they could be seeded here.
- `supabase/migrations/0001_rls_and_seed.sql:104-130` — `touch_updated_at` trigger application loop. Must include the new table.
- `src/utils/units.ts:1-23` — canonical kg↔lbs converter pair + `formatWeight` formatter. **Body weight reuses this directly** — body weight is just a weight stored in kg.
- `src/utils/units.ts` (no length helpers) — cm↔in conversion is **net-new**. Constant: `1 inch = 2.54 cm`. New functions: `cmToIn(cm)`, `inToCm(in)`, `formatLength(cm, unit)`, `parseLengthToCm(input, unit)` mirror the weight quartet.
- `src/api/preferences.ts:1-40` — exact shape of a `user_preferences` row helper and the `setWeightUnit` mutation. Copy-and-extend.
- `src/hooks/use-preferences.ts:1-26` — exact shape of the preferences hook. The `KEY = ["preferences", "me"]` cache key already covers the augmented row — invalidation works for free.
- `src/hooks/use-sessions.ts:53-99` — **invalidation contract**: write-paths invalidate `["sessions"]`, `["sessions","active"]`, and `["stats"]`. The new measurements hooks should invalidate `["measurements"]`; they should NOT invalidate `["stats"]` (existing stats are workout-volume only and unrelated to body metrics — flagged in Unknowns §11).
- `src/hooks/use-stats.ts:1-27` — TanStack Query pattern for a derivable summary; if a measurements chart joins on entries (e.g., "weight over last N weeks"), this is the template.
- `app/(app)/_layout.tsx:5-43` — `Tabs` declaration: order is Workout / Routines / Exercises / History / Profile. Adding a 6th tab works mechanically; UX impact in Unknowns §7.
- `app/(app)/profile.tsx:31-71` — UI shape for a preferences toggle row. Length-unit toggle drops in below the weight-unit toggle.
- `app/(app)/routines/index.tsx:7-72` and `app/(app)/exercises/index.tsx:8-72` — canonical list-screen template: `useQuery` → loading / error / empty / `FlatList` with `RefreshControl`, header `Plus` button → `router.push('.../new')`.
- `app/(app)/routines/new.tsx:1-106` — canonical "new resource" form template: `react-hook-form` + `zod` + `Controller` + `ScrollView` + `Stack.Screen` title + save/cancel buttons. **The new-entry form should mirror this almost field-for-field**, swapping the field list.
- `app/(app)/exercises/[id]/index.tsx:1-219` — canonical "edit existing resource" template: `reset(data)` in `useEffect`, `isDirty` gates save button, `confirmDelete` for soft-delete.
- `app/(app)/history/index.tsx:1-62` — best precedent for a "history of entries" screen because it's specifically a chronological list. The new measurements index can borrow nearly verbatim, including pull-to-refresh and the empty-state copy structure.
- `src/components/session-summary-row.tsx:38-76` — best precedent for a list-item that surfaces a date + secondary stats. Reusable layout idea.
- `src/components/progress-chart.tsx:1-138` — SVG line-chart primitive (`react-native-svg`). Single-series, `DataPoint = { label, value }`. **Highly reusable** for "body weight over time" if a chart is in scope (see Unknowns §8).
- `src/components/weekly-volume-strip.tsx:62-132` — recent precedent (last run) for a stat strip on the History tab. Sub-component vs. full screen is a UX choice.
- `src/utils/dates.ts:1-72` — `date-fns`-backed local-time bucketing helpers. Reusable if "history grouped by month" is the chosen view.
- `src/components/ui/input.tsx`, `src/components/ui/button.tsx`, `src/components/ui/textarea.tsx`, `src/components/confirm-delete.tsx` — atomic UI primitives. No new primitives required by this feature.
- `tests/rls.test.ts:57-86` — two-user RLS check pattern. **Mandatory** to extend (or add a sibling test) so the new table participates in the suite. Adding one resource block per table covers it.

## Relevant conventions (verified by reading code)

- **Data layer split**: `Supabase JS client → src/api/*.ts → src/hooks/*.ts (TanStack Query) → screens/components`. Verified in every feature (`use-exercises`, `use-routines`, `use-sessions`, etc.). RLS scopes everything to `auth.uid() = user_id` — every API helper that writes must include `user_id: <auth user>` in the payload (precedent `src/api/exercises.ts:33-46`, `src/api/sessions.ts:43-58`). Reads do not need `.eq('user_id', ...)` because RLS already filters server-side, but they MUST `.is('deleted_at', null)` to honor soft-delete.
- **UUIDs everywhere**: `id uuid PK default gen_random_uuid()` is the universal PK shape (schema.ts:44, 78, 108, 129). Use this for `measurement_entries`.
- **`user_id` denormalized on every user-owned table** with `references(() => authUsers.id, { onDelete: "cascade" })` and a `user_idx` (`schema.ts:54-56`). Required for RLS uniformity (`docs/data-model.md:84-86`, `docs/decisions.md:89`). The new table MUST have this column even if it could be omitted (1:N from preferences).
- **`...timestamps` everywhere** (`schema.ts:23-31`). All three timestamps (`createdAt`, `updatedAt`, `deletedAt`) are required; the trigger maintains `updatedAt`.
- **RLS template is hand-written, uniform, loop-based**: `0001_rls_and_seed.sql:17-44`. Adding a new user-owned table is a 1-line change to the `tables` array. NOT generated by Drizzle.
- **Soft delete** is universal (`docs/data-model.md:93-98`). Reads always `.is("deleted_at", null)`. Deletes always `.update({ deleted_at: new Date().toISOString() })` (precedent: `src/api/exercises.ts:71-77`).
- **Timestamps in UTC over the wire** (`timestamptz`); the client treats them with **device-local** display (`session-summary-row.tsx:18-22`) and **device-local** bucketing (`src/utils/dates.ts:11-15`). Single-user-in-BRT case keeps this simple.
- **Internal storage unit = kg for weights** (`src/utils/units.ts:13`, `docs/decisions.md:160-161`). Body weight should be stored in kg too; convert at the UI boundary using existing `formatWeight()` / `parseWeightToKg()`.
- **Display unit per-user in `user_preferences`** (`schema.ts:37`, `docs/data-model.md:90-91`). Length unit should follow the same pattern. **One source of truth, no per-row unit column.**
- **Numeric precision pattern**: lift weight is `numeric(6, 2)` (`schema.ts:91, 141`) → max 9999.99 (kg). Body weight in kg fits comfortably (max realistic ~250 kg) in the same precision. Body-part circumferences in cm (max realistic ~200 cm) also fit. Pick `numeric(6, 2)` for consistency unless designer wants tighter.
- **Numeric returned as `string | null`** by Supabase JS (precedent `SetRow.weight: string | null` at `src/db/types.ts:112`). Caller parses (`parseFloat`) before math (`app/(app)/history/[id].tsx:136`). This is a sharp edge for fresh code — easy to miss; document in the new types file.
- **NativeWind tokens**: `bg-white dark:bg-black`, `text-black dark:text-white`, `text-gray-500` (muted), `border-gray-200 dark:border-gray-800`, padding `px-4/px-6 py-3/py-4`, `rounded-lg`. Verified across every screen. New screens MUST honor light + dark.
- **Header chrome**: per-screen `<Stack.Screen options={{ title, headerShown: true }} />` (precedent every list screen). The outer `Tabs` hides headers (`app/(app)/_layout.tsx:6`). Tab-bar icon uses `lucide-react-native` (e.g. `Ruler`, `Activity`, `Scale` would all fit a measurements tab).
- **Forms**: `react-hook-form` + `zodResolver(schema)` + `Controller` per field + `handleSubmit(async values => ...)`. Save button gated by `isDirty` on edit screens. Cross-referenced: `routines/new.tsx`, `routines/[id]/index.tsx`, `exercises/new.tsx`, `exercises/[id]/index.tsx`. **Use this stack for every new form here.**
- **Numeric input**: `keyboardType="decimal-pad"` for weights / lengths (precedent `set-input.tsx:108`, `plate-calculator.tsx:90`); `keyboardType="number-pad"` for integer reps. Body weight + circumferences are decimals → `decimal-pad`.
- **List screen template**: see `app/(app)/exercises/index.tsx:8-72`. Includes `headerRight: () => <Pressable> + Plus icon` to navigate to `new`. Loading / error / empty / `FlatList` with `RefreshControl`.
- **Empty-state copy** is one-sentence, gray-500, centered, with a CTA button below in primary style (`app/(app)/exercises/index.tsx:41-55`, `app/(app)/routines/index.tsx:41-55`). Reuse the structure.
- **Delete confirm** via `confirmDelete()` (cross-platform Alert / window.confirm) (`src/components/confirm-delete.tsx:14-40`). Always followed by `router.back()` or list-refresh.
- **TanStack Query keys**: `["<resource>"]` umbrella + `["<resource>", id]` detail. Invalidate the umbrella from list-mutating writes (`src/hooks/use-exercises.ts:12-15,37`). Sessions/sets additionally invalidate `["stats"]` (`use-sessions.ts:61,97`, `use-sets.ts:43`). **The measurements feature is independent of `["stats"]`** — it should NOT invalidate workout stats, and existing workout writes should NOT invalidate `["measurements"]`. The Designer should call this boundary out explicitly.
- **Cache persistence**: `gcTime: 1000 * 60 * 60 * 24` (`src/lib/query-client.ts:9`) + AsyncStorage persistence (`queryPersister`). New keys cache automatically.
- **Universal app**: must work on web + iOS + Android from one codebase. No new platform-specific APIs needed for v1 (text fields + buttons + lists are universal). **However**: a native date picker is **not installed** today (see Unknowns §4); introducing one means picking between `@react-native-community/datetimepicker` (native-only, needs web shim) and a custom-built picker (cheaper, less polish). Verified by `grep -r "DateTimePicker\|date-picker" src app` → zero hits.

## Constraints

### Data

- **New table(s) required.** RLS template MUST be applied (4 policies + RLS-enable). Skipping any one is a security bug.
- **`user_id` denormalized + indexed on `user_id`.** Mirrors every other user-owned table.
- **Soft-delete columns (`deleted_at`) required** on all new tables. Reads filter `.is("deleted_at", null)`. Writes for delete update the column, not `DELETE`.
- **`updated_at` trigger application required.** Append the new table to the array in `0001_rls_and_seed.sql:114-130` (or copy the trigger into the new migration if the convention is "additive new migration only").
- **`length_unit` column addition on `user_preferences`**: `ALTER TABLE ... ADD COLUMN length_unit text NOT NULL DEFAULT 'cm'`. Existing rows survive because of the default. Optionally add a CHECK constraint mirroring set-type's pattern (`sql\`length_unit IN ('cm','in')\``).
- **Migration ordering**: hosted DBs already have migrations `0000`-`0004` applied (visible in `supabase/migrations/`). New migration is **0005** (and possibly **0006**). They are not regenerated from Drizzle's `0000_schema.sql` — additive migrations only (`docs/development.md:99-115`). Reapplying `0001` is therefore unsafe; the new RLS policies for the measurement table should go into a fresh migration.
- **Seed**: `seed_new_user()` could optionally pre-seed a "starter" measurement-metadata row but there is **no precedent** for seeding non-exercises (preferences is the only other seeded resource). Recommendation: do not seed; let the user create their first entry. Flag as a soft Unknown.
- **CHECK constraints**: precedent in `schema.ts:160-168` shows complex CHECK predicates are fair game. Useful here for "body weight must be > 0 if non-null" or "circumferences must be > 0 if non-null", though defensive code at the UI is the more common precedent (no CHECKs exist for weight/reps non-negativity on `sets`). Designer's call.
- **Numeric precision**: keep `numeric(6, 2)` to match `sets.weight`. Same parse-as-string idiom flows through.

### UI

- NativeWind tokens above. Dark mode is non-negotiable.
- Header chrome per `<Stack.Screen>`. Tab bar icon from `lucide-react-native` (options below).
- Empty / loading / error states required (every list screen has all three). Empty-state copy must lead with the action ("Log your first measurement.") and surface a CTA.
- Form errors inline via `Input.error` prop (precedent `ui/input.tsx:30-32`).
- Toggle-row visual must match the existing weight-unit toggle exactly so the Profile screen feels uniform if a length-unit toggle is added.
- **Tab-bar capacity**: iPhone Tab bar at 6 tabs is busy but works. Owner has 5 today (`_layout.tsx:7-42`). Designer must choose: add a 6th tab, OR nest under Profile, OR replace one (e.g. consolidate History+Exercises sub-routes). See Unknowns §7.

### Platform

- Universal (iOS / Android / web). No new platform-specific deps needed for the minimal version. A native date picker would introduce a web divergence — flagged.
- `confirmDelete` already handles the web vs. native Alert split (`src/components/confirm-delete.tsx:22-30`).

### Auth

- Provided by `useAuth()` + Supabase JS client; all queries inherit the JWT. No new auth-context work.

### Performance

- Measurement entries are low-cardinality (owner inputs once per week at most → ~50/year). Full-table reads with no pagination are appropriate, matching `useSessions`'s "fetch all, sort newest-first" approach (`src/api/sessions.ts:4-12`).
- A "weight chart over last N months" view would do a single ranged query identical in shape to `src/api/stats.ts:18-33` — fast at this scale.

## Existing precedents

- **Per-user time-anchored resource with no parent FK**: `sessions` is the closest structural twin (top-level resource owned by user, indexed by `(user_id, started_at)`, soft-deletable). Use it as the structural template.
- **Per-user library resource with optional fields**: `exercises` (name + array column + nullable equipment + nullable notes) — closest pattern if the Designer chooses the "one row with many nullable columns" schema shape (Unknowns §1, Option A).
- **Preference-toggle UI**: `app/(app)/profile.tsx:26-72` — exact pattern to extend with a length-unit row.
- **History-by-chronology screen**: `app/(app)/history/index.tsx:11-62` — exact pattern for the measurements list screen. Includes pull-to-refresh + empty/loading/error.
- **"New resource" form**: `app/(app)/routines/new.tsx` — closest precedent for a simple form with a couple of text fields. Even closer if measurements collapse to one entry with N nullable numeric fields.
- **"Edit resource" form with delete**: `app/(app)/exercises/[id]/index.tsx` — full edit screen with `reset(data)`, `isDirty`-gated save, soft-delete + `confirmDelete` + `router.back()`.
- **Chronological progress chart**: `src/components/progress-chart.tsx` + `app/(app)/exercises/[id]/progress.tsx` — exact precedent for a per-metric chart (e.g. "body weight over time"). Single-series, parseISO-on-read, formatter for the y-axis.
- **Tab + nested stack**: `app/(app)/exercises/_layout.tsx` + `app/(app)/exercises/index.tsx` + `[id]/index.tsx` — exact precedent for a new tab that owns a small stack (list + new + edit).
- **kg ↔ display-unit conversion**: `src/utils/units.ts:5-22` — pattern to mirror for cm ↔ in.
- **Migration applying an ALTER TABLE**: `supabase/migrations/0002_add_notes_columns.sql` — single-line additive ALTER. Same shape works for `length_unit`.
- **Migration applying a hand-written ALTER + backfill + drop**: `0004_exercise_muscles_array.sql` — heavier precedent, useful if any backfill is needed (unlikely here).

## Unknowns (require Designer judgment or human decision)

1. **Schema shape — one wide table, parent + child, or JSON blob?** Three viable options, each with a real tradeoff:
   - **A. Wide table — `measurement_entries` with many nullable columns.** Columns: `id, user_id, measured_at, weight_kg, body_fat_pct, neck_cm, shoulders_cm, chest_cm, biceps_cm, forearm_cm, waist_cm, hips_cm, thigh_cm, calf_cm, notes`. Simple, fast queries, type-safe, AI-friendly. Cost: adding a body part = a migration. **Recommended default** at single-user scale; migrations are cheap, the body-part list is small and stable, and `sessions`/`sets` already establish the "wide nullable" pattern.
   - **B. Parent + child — `measurement_entries(id, user_id, measured_at, notes)` + `measurement_values(entry_id, metric_key text, value_cm_or_kg numeric)`.** Flexible (add metrics without migrating), but queries grow joins, type safety degrades to string keys, AI gets the joins wrong more often. Worth the cost only if the metric list will change weekly. Unlikely.
   - **C. JSON blob — `measurement_entries(id, user_id, measured_at, metrics jsonb)`.** Cheapest now, hardest later. Loses indexed access to individual columns, loses type safety, hard to chart "biceps over time" without a SQL function. Skip.
   **Recommendation: Option A.** Designer should confirm and pick the column set (see §2).
2. **Which metrics ship in v1?** No prior list. Common set for hypertrophy/recomp tracking:
   - **Always**: body weight (kg).
   - **Optional but common**: body fat % (numeric 4,1 → 25.4), neck, shoulders, chest, left biceps, right biceps, left forearm, right forearm, waist, hips, left thigh, right thigh, left calf, right calf.
   - **Question for owner (Designer to call)**: per-side L/R or single? Most apps default to single (one biceps column, user picks a side). Recommend single columns in v1, mark as a "can split later" follow-up.
   - **Recommended minimum v1 set**: weight, body-fat %, neck, chest, biceps, forearm, waist, hips, thigh, calf. (10 metrics → 10 nullable numeric columns + `notes`.) Designer confirms.
3. **Length unit preference — add `length_unit` to `user_preferences`?**
   - **Default recommendation**: yes, add `length_unit text NOT NULL DEFAULT 'cm'` to `user_preferences`. Mirrors `weight_unit`, matches the existing "one source of truth, conversion at UI boundary" rule (decisions.md #8). New hook `useLengthUnit()` + Profile toggle.
   - Alternative: hard-code cm. Cheaper now, but the same conversion friction will bite the moment the owner cares (he might already; he's bilingual on units).
   - Per-entry unit field: rejected — explicitly contradicts the established "no per-row unit field" rule (data-model.md:90-91, decisions.md:160-161).
4. **Date model — `measured_at` is what type, and does the user pick it?**
   - **Auto-now `timestamptz`** (simplest, matches `sessions.started_at`, `sets.completed_at`). User can't backfill an entry from yesterday.
   - **User-pickable date** (date-only, `date` type) — requires a date picker UI; no precedent in the codebase. Owner gets historical-entry support.
   - **Hybrid**: user-pickable date-only stored as `timestamptz` (00:00 local). The most flexible, mid-cost.
   - **Recommendation**: hybrid (user-pickable, defaults to today). Needs a date picker. **Sub-Unknown 4a**: which picker? Native `@react-native-community/datetimepicker` (must `expo install`, has a web shim that's mediocre) vs. a roll-your-own three-spinner-or-text-input picker (cheaper, ugly, universal). At one user, the universal text input + date-fns parse is probably enough for v1; defer the polished picker. **Designer decides.**
5. **Editing past entries — allowed?**
   - Default precedent in the codebase: editable (exercises, routines, sessions all editable; sets editable). Should match.
   - **Recommendation**: yes, edit allowed. Use the `[id].tsx` edit-screen template.
6. **Deletion model — soft-delete (matches convention) or hard-delete?**
   - **Recommendation**: soft delete with `deleted_at`. Matches every other table in the schema; documented invariant (`docs/data-model.md:93-98`). Hard-delete would be the anomaly.
7. **Where in navigation?** Three options, ranked:
   - **A. New tab "Measurements" in the bottom tab bar.** Pros: discoverable, parallel to History/Exercises. Cons: 6th tab — iPhone tab bar at 6 is tight but works. Recommended Lucide icon: `Ruler` or `Scale`.
   - **B. Sub-route under Profile** (`app/(app)/profile.tsx` gets a "Measurements" row that pushes a stack). Pros: avoids tab-bar crowding, semantically OK ("personal data lives under Profile"). Cons: 2 taps to access; less discoverable.
   - **C. Tab in the History area** (e.g. tabbed sub-views: Sessions / Measurements). Pros: matches the "progress tracking" mental model. Cons: more refactor; History is currently a single stack.
   - **Recommendation**: A (new tab). Owner explicitly described this as a progress-tracking feature, and a sub-route under Profile makes it feel like a setting. Designer / owner can override.
8. **History presentation — list, chart, or both?** Prompt says "show the history of the inputs" → list at minimum. **Options**:
   - **List only** (cheapest, ships v1).
   - **List + per-metric chart** (e.g. tap a metric → see line chart over time). Reuses `progress-chart.tsx`. ~2-3 hours of extra work.
   - **List + bodyweight chart strip** (top of list, like `WeeklyVolumeStrip` for the workouts tab). Only chart bodyweight by default (the metric the owner mentioned by name in the prompt).
   - **Recommendation**: list-only v1 with the affordance ("tap a metric for trend") explicitly carved out as v1.1. If the Designer wants to ship one chart, do bodyweight only — it's the one universal metric.
9. **First-time UX / empty state.** No measurements yet → big "Log your first measurement" CTA, mirroring `app/(app)/exercises/index.tsx:41-55`. Designer must write copy.
10. **Per-side metrics (L/R bicep, L/R thigh, etc.) — single column or two?** Most apps single. **Recommendation**: single. Easy to add a second column later if owner wants; can't trivially merge two into one.
11. **Cache-invalidation contract.** The previous run established `["stats"]` as the umbrella for workout-derived stats (workout volume etc.). Measurements should live under a separate key (`["measurements"]`). The Designer must explicitly state: workout writes (`useFinishSession`, `useLogSet`, etc.) do **not** invalidate `["measurements"]`, and measurement writes do **not** invalidate `["stats"]`. Each domain owns its own cache namespace. (Verified `["stats"]` usage at `src/hooks/use-sessions.ts:61,97` and `src/hooks/use-sets.ts:43`.)
12. **Notes on a measurement entry — yes/no?** Convenient ("ate carbs the night before", "after cardio") and low-cost (one text column, mirrors `sessions.notes`). **Recommendation**: include a nullable `notes text` column.
13. **Validation rules.** What are sensible min/max for each metric? Body weight 30-300 kg? Circumferences 10-200 cm? Body fat 2-60 %? Zod schema needs these. **Designer must pick.** Open to the Implementer.
14. **Body-fat % — store and treat how?** It's not a length, not a weight. Three options:
   - Own column `body_fat_pct numeric(4, 1)` (0.0-100.0). Simplest.
   - Skip in v1 (owner didn't mention it; "sizes" implies lengths). Cheapest.
   - **Recommendation**: include the column but make the field optional. Cost is one column.
15. **Tab-bar icon choice.** `Ruler` (Lucide) fits "sizes"; `Scale` fits "weight"; `Activity` is the catchall. **Recommendation**: `Ruler` (most distinctive, less collision with other gym icons).
16. **Migration numbering / RLS migration coupling.** Question: do new RLS policies for the new table go in a fresh migration (`0006_rls_for_measurements.sql`) or get appended to `0001`? `0001` was hand-written and the loop is data-driven by an array literal — but reapplying `0001` against a hosted DB that already has it is a no-op for the `drop policy if exists` parts but **adds** policies for the new table only if `0001` is re-run. The safer, additive pattern is a fresh migration (`0005_<table>.sql` for the table + index, `0006_<rls>.sql` for the policies and trigger). **Designer must call this.** Recommend: one new migration that does table + RLS + trigger together, with `do $$ ... $$` blocks copied from `0001` (just for the one table).
17. **`tests/rls.test.ts` extension.** The current test inserts only into `exercises`. The Designer should specify "extend RLS test to insert into `measurement_entries` with user A and verify B can't read/update/delete". This is part of the security boundary — non-optional.
18. **`tests/seed-and-auth.test.ts` impact.** Currently verifies preferences + exercises seeding. If `length_unit` is added, the test should assert the default = `'cm'`. If measurements are not seeded, no further change.
19. **Time of day for body weight?** Owner may weigh in the morning. Storing as a `timestamptz` lets the data carry the time naturally; if the entry is date-only, this is lost. Tied to Unknown §4.
20. **Comparison / delta on history items.** "+0.3 kg from last entry" is a nice touch but not in the prompt. Out of scope; designer / implementer should resist.

## Out-of-scope flags

- **Photos of progress (before/after)** — needs Supabase Storage wiring + image upload UX. Listed deferred elsewhere (`docs/roadmap.md:126`). Not in this prompt; do not bundle.
- **Goals / target values** ("hit 10% body fat") — feature creep. Not in prompt.
- **Reminders / push notifications** to log measurements — out of scope (push not wired up at all; deferred at `roadmap.md:132`).
- **Sharing / export** — not in prompt; out of scope.
- **Per-side L/R columns** if the recommendation in §10 is taken — single column ships, L/R split is a follow-up if owner asks.
- **Charting all metrics** — see §8 recommendation. Designer should resist scope creep beyond bodyweight chart, or push all charts to v1.1.
- **A "stat strip" of body weight at the top of History tab** (mirroring `WeeklyVolumeStrip`) — tempting cross-feature integration, but the prompt confines the feature to "input" + "history of inputs". Do not bundle.
- **Refactoring `user_preferences` into a wider settings table** — keep the change minimal: add one column, don't restructure.
- **A standalone progress dashboard** combining body metrics + workout metrics — feature creep. Defer.
- **Imperial-unit body weight as a separate column** — no. Single source of truth in kg, convert at UI boundary. Same rule as lift weight.
