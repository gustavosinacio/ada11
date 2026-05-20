# Design v1 — 2026-05-19_2353_measurements-tracking

## Goal (1 sentence)

Add a measurements vertical that lets the owner log periodic body-weight + body-part circumference entries (and body-fat %), edit / soft-delete them, and review the full chronological history from a new "Measurements" bottom tab.

## Approach

Mirror the `sessions`/`exercises` precedent end-to-end: one new wide nullable table (`measurement_entries`), one new tab with a 3-screen stack (list, new, edit), and an additive `length_unit` column on `user_preferences` so the cm↔in conversion lives at the UI boundary alongside the existing kg↔lbs split. Storage is canonical (kg, cm, %); the UI converts using new `cmToIn`/`inToCm`/`formatLength`/`parseLengthToCm` helpers that mirror the kg quartet line-for-line. The cache namespace is fully separate (`["measurements"]`) — workout writes do not touch it and vice versa. RLS, soft-delete, `...timestamps`, `user_id` denormalization + index, and the `touch_updated_at` trigger are all applied via the existing array-loop template, **inlined into a single new migration `0005_measurements.sql`** scoped to this feature (no edits to `0001`). History is list-only v1: tap a row → edit screen; no charts.

## Decisions on unknowns (all 20)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Schema shape | **A. Wide table** with nullable numeric columns. | Single-user scale; metric list is small and stable; matches `sessions`/`sets` "wide nullable" pattern; type-safe + AI-friendly. |
| 2 | Metrics list (v1) | `weight_kg`, `body_fat_pct`, `neck_cm`, `chest_cm`, `biceps_cm`, `forearm_cm`, `waist_cm`, `hips_cm`, `thigh_cm`, `calf_cm` — single columns (no L/R). | Discovery's recommended set covers the hypertrophy/recomp core. 10 metrics + 1 notes is a manageable single-form length. Shoulders dropped to keep the form compact; adding shoulders later is a 1-line ALTER. |
| 3 | Length unit | Add `user_preferences.length_unit text NOT NULL DEFAULT 'cm'` + `CHECK (length_unit IN ('cm','in'))`. New Profile toggle row mirrors `weight_unit`. New `useLengthUnit()` + `useSetLengthUnit()` hooks. | Established "one source of truth, conversion at UI boundary" rule (`docs/decisions.md:160-161`). The CHECK constraint matches the `set_type` precedent (`schema.ts:160-163`). |
| 4 | Date model | **Hybrid**: stored as `timestamptz` `measured_at`, defaulting to `now()` on create. UI exposes a date-only text input (`YYYY-MM-DD`) that defaults to today and is parsed via `date-fns/parse`. Time-of-day is auto-recorded (current `now()`) but not exposed in the form. | Zero new deps. Universal across iOS/Android/web. Owner can backfill yesterday's measurement by editing the date string. A native picker can be a v1.1 swap-in behind the same input contract. Stores `timestamptz` so a future "9am vs 9pm weight" feature has the raw data. |
| 5 | Edit | Yes, editable via `[id].tsx` template. `reset(data)` in `useEffect`, `isDirty` gates Save. | Matches every other resource in the codebase (`exercises/[id]`, `routines/[id]`, etc.). |
| 6 | Delete | Soft-delete (`deleted_at = now()`). | Universal invariant (`docs/data-model.md:93-98`). |
| 7 | Navigation | **New tab "Measurements" between History and Profile**, icon `Ruler`. | Owner framed this as a progress-tracking feature parallel to History — burying it under Profile makes it feel like a setting. iPhone tab-bar at 6 is tight but every tab Discovery surveyed (`Workout`, `Routines`, `Exercises`, `History`, `Profile`) has independent purpose; consolidation is a separate UX decision (out of scope). If 6th-tab pressure becomes a real problem, the Designer's preferred follow-up is to merge History+Measurements under a single "Progress" tab — explicitly deferred. |
| 8 | History view | List-only v1. Newest-first chronological list, tap row → edit screen. No charts. | Discovery's recommendation; bodyweight chart deferred to v1.1 to keep this scope tight. |
| 9 | Empty-state copy | One-liner above CTA: **"No measurements logged yet. Log your first to start tracking progress."** CTA button label: **"Log measurement"**. | Mirrors `exercises/index.tsx:43-54` shape exactly; copy is action-led per UI conventions. |
| 10 | L/R sides | Single column per metric (no `_l`/`_r`). | Discovery recommendation; cheaper to split later than to merge. |
| 11 | Cache namespace | `KEYS = { all: ["measurements"], detail: (id) => ["measurements", id] }`. Strictly separate from `["stats"]` and `["sessions"]`. **Workout writes (`useFinishSession`, `useLogSet`, `useUpsertSet`, etc.) MUST NOT invalidate `["measurements"]`; measurement writes MUST NOT invalidate `["stats"]` or `["sessions"]`.** | Two unrelated domains; cross-domain invalidation would cause needless refetches and obscure the contract. |
| 12 | Notes column | Include nullable `notes text`. | Cheap, mirrors `sessions.notes`. |
| 13 | Validation ranges | `weight_kg`: 20-400. `body_fat_pct`: 2-60. All circumferences (`neck_cm`, `chest_cm`, `biceps_cm`, `forearm_cm`, `waist_cm`, `hips_cm`, `thigh_cm`, `calf_cm`): 5-250. `notes`: max 500 chars. All numeric fields optional individually; at-least-one numeric field required per entry. Ranges enforced **only at the zod/UI layer** (no DB CHECK on numeric ranges, matching the `sets.weight`/`reps` precedent which also lacks CHECKs). | Wide upper bounds avoid false rejects (cuffs around upper thigh on heavier users can exceed 100 cm). Lower bounds catch obvious typos (e.g. "5" entered for a `cm` field when user meant `weight_kg`). Storage values are converted **to canonical kg/cm before** zod validation runs — see Contratos §Form. |
| 14 | Body-fat % | Include `body_fat_pct numeric(4,1)` (0.0-100.0, optional). | One column; meaningful for recomp tracking. |
| 15 | Tab icon | `Ruler` from `lucide-react-native`. | Distinctive vs the existing 5 icons (`Dumbbell`, `ListChecks`, `Wrench`, `History`, `User`). |
| 16 | Migration coupling | **One new migration `0005_measurements.sql`** doing, in order: (a) `ALTER TABLE user_preferences ADD COLUMN length_unit ... CHECK ...`; (b) `CREATE TABLE measurement_entries (...)`; (c) `CREATE INDEX measurement_entries_user_measured_idx`; (d) one `do $$ ... $$` block that runs the 4-policy template **for `measurement_entries` only** + `enable row level security`; (e) one `do $$ ... $$` block that installs `touch_updated_at` on `measurement_entries`. No edits to `0001`. | Additive-only convention (`docs/development.md:99-115`). Splitting into 0005+0006 was considered (Discovery flagged it) — rejected because the table is useless without RLS so coupling them in one transaction is the safer atomic unit. The loop blocks are copied from `0001` with a single-element array. |
| 17 | RLS test extension | Extend `tests/rls.test.ts` with a `measurement_entries` block: A inserts → B reads/updates/deletes → all must yield zero rows. | Mandatory per security boundary; one block per table is the established shape. |
| 18 | Seed test extension | Extend `tests/seed-and-auth.test.ts` to assert `prefs[0].length_unit === 'cm'` immediately after the existing `weight_unit` assertion. `seed_new_user()` is **also rewritten** to insert `length_unit: 'cm'` explicitly (defaults work, but explicitness matches the existing pattern in `0001`/`0004`). | One added assertion + a function rewrite; same pattern as `0004` for `muscles`. |
| 19 | Time-of-day | Stored automatically (`measured_at` = `now()` on create, preserved on update unless user changes the date). Not exposed in v1 UI. | Tied to decision 4. Raw data is captured for future use without UI noise. |
| 20 | Deltas | Out of scope. | Owner did not ask. Defer. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/db/schema.ts` | edited | Add `lengthUnit: text("length_unit").notNull().default("cm")` column to `userPreferences` (line ~37). Add new `measurementEntries` table export at end of file: `id` (uuid, pk), `userId` (uuid, fk → authUsers, cascade, notNull), `measuredAt` (timestamptz, notNull, default `now()`), the 10 numeric columns (`weight_kg`, `body_fat_pct`, 8 `*_cm`), `notes` (text), `...timestamps`, with `user_measured_idx` composite index `(user_id, measured_at desc)`. |
| `src/db/types.ts` | edited | Add `export type LengthUnit = "cm" \| "in"` next to `WeightUnit`. Add `MeasurementEntry`/`NewMeasurementEntry` inferred types. Add `MeasurementEntryRow` snake_case type matching the PostgREST response shape (numerics typed as `string \| null`). Re-export `measurementEntries` from schema. |
| `src/utils/units.ts` | edited | Add `cmToIn(cm: number): number`, `inToCm(inches: number): number`, `formatLength(cm: number \| null \| undefined, unit: LengthUnit): string`, `parseLengthToCm(input: string, unit: LengthUnit): number \| null`. Mirror the kg quartet line-for-line. Constant `CM_PER_IN = 2.54`. |
| `src/api/preferences.ts` | edited | Extend `UserPreferencesRow` with `length_unit: LengthUnit`. Add `setLengthUnit(unit: LengthUnit): Promise<UserPreferencesRow>` mirroring `setWeightUnit`. |
| `src/hooks/use-preferences.ts` | edited | Add `useLengthUnit(): LengthUnit` (defaults `"cm"`) and `useSetLengthUnit()` mutation. No changes to `KEY` or `usePreferences()`. |
| `app/(app)/profile.tsx` | edited | Add a second toggle row below the weight-unit row labeled "Length unit", values `cm`/`in`, wired to `useLengthUnit()` + `useSetLengthUnit()`. Visual treatment identical to the existing toggle. Wrap both rows in the same bordered card. |
| `app/(app)/_layout.tsx` | edited | Add a 6th `<Tabs.Screen name="measurements" ... />` between `history` and `profile`, icon `<Ruler color={color} size={size} />`. Add `Ruler` to the `lucide-react-native` import. |
| `src/api/measurements.ts` | new | Five functions: `listMeasurements(): Promise<MeasurementEntryRow[]>` (ordered by `measured_at desc`, `.is("deleted_at", null)`), `getMeasurement(id: string)`, `createMeasurement(input: MeasurementInput): Promise<MeasurementEntryRow>` (injects `user_id` via `supabase.auth.getUser()`), `updateMeasurement(id, patch)`, `softDeleteMeasurement(id)`. Mirrors `src/api/exercises.ts` shape. |
| `src/hooks/use-measurements.ts` | new | TanStack Query hooks: `useMeasurements()`, `useMeasurement(id)`, `useCreateMeasurement()`, `useUpdateMeasurement()`, `useSoftDeleteMeasurement()`. `KEYS = { all: ["measurements"], detail: (id) => ["measurements", id] }`. Invalidation set: `["measurements"]` umbrella only. **Does NOT invalidate `["stats"]` or `["sessions"]`.** |
| `app/(app)/measurements/_layout.tsx` | new | `<Stack screenOptions={{ headerShown: false }} />` wrapper. Mirrors `app/(app)/exercises/_layout.tsx`. |
| `app/(app)/measurements/index.tsx` | new | List screen. Uses `useMeasurements()`. Loading / error / empty / `FlatList` of `<MeasurementListItem>`. `headerRight` = Plus button → `/(app)/measurements/new`. Empty-state copy per decision 9. Pull-to-refresh. |
| `app/(app)/measurements/new.tsx` | new | Form screen. `react-hook-form` + zodResolver. Fields: date (text input `YYYY-MM-DD`, defaults to today), 10 numeric inputs (placeholders show current unit, e.g. `"kg"` or `"in"`), notes textarea. Save → `createMeasurement(...)` → `router.back()`. Cancel → `router.back()`. |
| `app/(app)/measurements/[id].tsx` | new | Edit screen. `useMeasurement(id)` → `reset(data)`. Same field set. `isDirty` gates Save. Soft-delete button at bottom with `confirmDelete`. |
| `src/components/measurement-list-item.tsx` | new | List-row Pressable. Top line: formatted date (`"Sat, May 17"`). Sub-line: best-2-of-`{weight, body-fat, waist}` summary (e.g. `"82.4 kg · 18.0% bf · 84.0 cm waist"`) using `formatWeight`/`formatLength`. Falls back gracefully when fields are null. Chevron-right affordance. |
| `supabase/migrations/0005_measurements.sql` | new | Single migration: `ALTER user_preferences ADD length_unit`; backfill explicit `'cm'` for existing rows (defensive); rewrite `seed_new_user()` to include `length_unit: 'cm'`; `CREATE TABLE measurement_entries`; `CREATE INDEX measurement_entries_user_measured_idx ON measurement_entries (user_id, measured_at DESC)`; `ALTER TABLE measurement_entries ENABLE ROW LEVEL SECURITY`; one `do $$ ... $$` block applying the 4-policy template for `measurement_entries`; one `do $$ ... $$` block applying `touch_updated_at`. |
| `tests/rls.test.ts` | edited | Append a `measurement_entries` block after the existing `exercises` block: A inserts a row with `user_id: a.user.id`, B attempts read/update/delete, each must yield zero rows. |
| `tests/seed-and-auth.test.ts` | edited | After the existing `weight_unit === 'kg'` assertion, add `if (prefs[0]!.length_unit !== "cm") throw new Error(...)`. Update the `.select(...)` call to include `length_unit`. |
| `tests/unit/measurements-units.test.ts` | new | Unit tests for `cmToIn`, `inToCm`, `formatLength`, `parseLengthToCm` (round-trip, null/undefined, comma decimal, conversion correctness). |

## Contratos de I/O

### Drizzle table (TypeScript-side, `src/db/schema.ts`)

```ts
export const measurementEntries = pgTable(
  "measurement_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    measuredAt: timestamp("measured_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    weightKg:    numeric("weight_kg",    { precision: 6, scale: 2 }),
    bodyFatPct:  numeric("body_fat_pct", { precision: 4, scale: 1 }),
    neckCm:      numeric("neck_cm",      { precision: 6, scale: 2 }),
    chestCm:     numeric("chest_cm",     { precision: 6, scale: 2 }),
    bicepsCm:    numeric("biceps_cm",    { precision: 6, scale: 2 }),
    forearmCm:   numeric("forearm_cm",   { precision: 6, scale: 2 }),
    waistCm:     numeric("waist_cm",     { precision: 6, scale: 2 }),
    hipsCm:      numeric("hips_cm",      { precision: 6, scale: 2 }),
    thighCm:     numeric("thigh_cm",     { precision: 6, scale: 2 }),
    calfCm:      numeric("calf_cm",      { precision: 6, scale: 2 }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    userMeasuredIdx: index("measurement_entries_user_measured_idx").on(
      t.userId,
      t.measuredAt,
    ),
  }),
);
```

### Row type (snake_case, what hooks/screens consume)

```ts
export type MeasurementEntryRow = {
  id: string;
  user_id: string;
  measured_at: string;        // ISO timestamptz
  weight_kg:   string | null; // numeric → string per Supabase JS
  body_fat_pct: string | null;
  neck_cm:     string | null;
  chest_cm:    string | null;
  biceps_cm:   string | null;
  forearm_cm:  string | null;
  waist_cm:    string | null;
  hips_cm:     string | null;
  thigh_cm:    string | null;
  calf_cm:     string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type LengthUnit = "cm" | "in";
```

### API surface (`src/api/measurements.ts`)

```ts
export type MeasurementInput = {
  measuredAt: string;           // ISO string (form converts YYYY-MM-DD → ISO at submit)
  weightKg:   number | null;
  bodyFatPct: number | null;
  neckCm:     number | null;
  chestCm:    number | null;
  bicepsCm:   number | null;
  forearmCm:  number | null;
  waistCm:    number | null;
  hipsCm:     number | null;
  thighCm:    number | null;
  calfCm:     number | null;
  notes:      string | null;
};

export function listMeasurements(): Promise<MeasurementEntryRow[]>;
export function getMeasurement(id: string): Promise<MeasurementEntryRow>;
export function createMeasurement(input: MeasurementInput): Promise<MeasurementEntryRow>;
export function updateMeasurement(id: string, patch: MeasurementInput): Promise<MeasurementEntryRow>;
export function softDeleteMeasurement(id: string): Promise<void>;
```

The `MeasurementInput` keys are camelCase TS-side and mapped to snake_case via the insert/update payload object (same pattern as `createExercise`). Numeric fields are sent as numbers; PostgREST round-trips them back as strings (consistent with `sets.weight`).

### Hook surface (`src/hooks/use-measurements.ts`)

```ts
const KEYS = {
  all: ["measurements"] as const,
  detail: (id: string) => ["measurements", id] as const,
};

export function useMeasurements();                 // useQuery(KEYS.all)
export function useMeasurement(id: string | undefined);
export function useCreateMeasurement();            // invalidates KEYS.all
export function useUpdateMeasurement();            // invalidates KEYS.all + setQueryData(KEYS.detail(row.id), row)
export function useSoftDeleteMeasurement();        // invalidates KEYS.all
```

**Invalidation contract (explicit):**
- `useCreateMeasurement` / `useUpdateMeasurement` / `useSoftDeleteMeasurement` invalidate **only** `["measurements"]`.
- They do **NOT** touch `["stats"]`, `["sessions"]`, `["sets"]`, `["exercises"]`, or `["routines"]`.
- `useFinishSession`, `useLogSet`, `useUpsertSet`, `useDeleteSet`, `useCreateRoutine`, etc. do **NOT** touch `["measurements"]`. (No code change required to enforce — they simply don't reference the key.)

### Units helpers (`src/utils/units.ts`)

```ts
const CM_PER_IN = 2.54;

export function cmToIn(cm: number): number;                                    // cm / CM_PER_IN
export function inToCm(inches: number): number;                                // inches * CM_PER_IN
export function formatLength(cm: number | null | undefined, unit: LengthUnit): string;
//   null/undefined -> "—"; else `${value.toFixed(1)} ${unit}`
export function parseLengthToCm(input: string, unit: LengthUnit): number | null;
//   parseFloat with comma-to-dot replace; NaN -> null; cm passthrough, in via inToCm
```

### Profile toggle (`app/(app)/profile.tsx`)

```ts
const currentLengthUnit: LengthUnit = prefs.data?.length_unit ?? "cm";
const setLengthUnit = useSetLengthUnit();
// Row visual identical to weight_unit row; iterates over (["cm","in"] as const).
```

### Form schema (`app/(app)/measurements/new.tsx`)

```ts
// All values come into the form as STRINGS (text inputs). The submit handler
// converts each string to a canonical kg/cm number via the parse helpers
// BEFORE invoking createMeasurement. Range validation is applied to the
// canonical (kg/cm) value, NOT to the user-entered string.

const numericFieldRange = (canonicalMin: number, canonicalMax: number) =>
  z.string().trim().optional().or(z.literal("")).transform(...);

const schema = z.object({
  measuredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  weightKg:    z.number().min(20).max(400).nullable(),   // canonical
  bodyFatPct:  z.number().min(2).max(60).nullable(),
  neckCm:      z.number().min(5).max(250).nullable(),
  chestCm:     z.number().min(5).max(250).nullable(),
  bicepsCm:    z.number().min(5).max(250).nullable(),
  forearmCm:   z.number().min(5).max(250).nullable(),
  waistCm:     z.number().min(5).max(250).nullable(),
  hipsCm:      z.number().min(5).max(250).nullable(),
  thighCm:     z.number().min(5).max(250).nullable(),
  calfCm:      z.number().min(5).max(250).nullable(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
}).refine(
  (v) => [v.weightKg, v.bodyFatPct, v.neckCm, v.chestCm, v.bicepsCm,
          v.forearmCm, v.waistCm, v.hipsCm, v.thighCm, v.calfCm]
          .some((x) => x != null),
  { message: "Log at least one measurement", path: ["weightKg"] },
);
```

**Implementer's flexibility**: the exact zod shape can be string-based with a `transform()` pipeline; what matters for the contract is (a) all 10 metric fields are optional individually, (b) at least one is required, (c) ranges are validated against canonical kg/cm/percent, not raw input, (d) `measuredAt` is `YYYY-MM-DD` validated by regex + `date-fns/parse` (`new Date(parse(value, "yyyy-MM-dd", new Date())).toISOString()` at submit).

### DB columns (`measurement_entries`)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | no | — | FK → `auth.users(id) on delete cascade`. Indexed via composite. |
| `measured_at` | `timestamptz` | no | `now()` | The "as-of" time of the measurement. UI exposes date-only. |
| `weight_kg` | `numeric(6,2)` | yes | null | Canonical kg. |
| `body_fat_pct` | `numeric(4,1)` | yes | null | 0.0-100.0. |
| `neck_cm`…`calf_cm` (8 cols) | `numeric(6,2)` | yes | null | Canonical cm. |
| `notes` | `text` | yes | null | Max 500 chars enforced at UI layer. |
| `created_at`/`updated_at` | `timestamptz` | no | `now()` | Maintained by `touch_updated_at`. |
| `deleted_at` | `timestamptz` | yes | null | Soft-delete sentinel. |

**Indexes:** `measurement_entries_user_measured_idx (user_id, measured_at DESC)`.

**RLS policies:** 4 policies (`select`/`insert`/`update`/`delete`), all gated by `auth.uid() = user_id`, applied via the `do $$ ... $$` template from `0001_rls_and_seed.sql:17-44` with a single-element array `array['measurement_entries']`.

**Trigger:** `touch_updated_at` applied via the same `do $$ ... $$` template from `0001_rls_and_seed.sql:114-130`, single-element array.

### `user_preferences` ALTER

```sql
alter table public.user_preferences
  add column length_unit text not null default 'cm';

alter table public.user_preferences
  add constraint user_preferences_length_unit_check
  check (length_unit in ('cm','in'));
```

Existing rows pick up `'cm'` from the default. The `seed_new_user()` function is rewritten to insert `length_unit: 'cm'` explicitly (same pattern as `0004_exercise_muscles_array.sql:43-56`).

### UI props

```ts
// src/components/measurement-list-item.tsx
type Props = {
  entry: MeasurementEntryRow;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  onPress?: () => void;
};
```

The list-item resolves the "headline 2-3 metrics" client-side by parsing the strings to numbers and picking the first 2-3 non-null values in priority order: `weight_kg` > `body_fat_pct` > `waist_cm`.

## UI spec

### Screen 1 — `app/(app)/measurements/index.tsx` (Measurements list)

**Layout:** Same skeleton as `app/(app)/exercises/index.tsx`.

- `Stack.Screen options={{ title: "Measurements", headerShown: true, headerRight: Plus → /measurements/new }}`.
- Container: `<View className="flex-1 bg-white dark:bg-black">`.
- Branches:
  - **Loading** (`isLoading`): centered `<ActivityIndicator />`.
  - **Error** (`isError`): centered red text `error.message ?? "Failed to load measurements"`.
  - **Empty** (`!data || data.length === 0`):
    - Centered text `"No measurements logged yet. Log your first to start tracking progress."` (gray-500, mb-4).
    - Primary button "Log measurement" → `/(app)/measurements/new`.
  - **Populated**: `<FlatList>` of `<MeasurementListItem>` newest-first (the API already sorts), `RefreshControl` wired to `refetch`/`isRefetching`.

**Pseudo-code (null-return placement):**

```tsx
if (isLoading)                 return <Loading />;
if (isError)                   return <ErrorView error={error} />;
if (!data || data.length === 0) return <Empty onCta={() => router.push('/(app)/measurements/new')} />;
return <FlatList data={data} ... />;
```

### Screen 2 — `app/(app)/measurements/new.tsx` (New entry)

**Layout:** `ScrollView` with `px-6 py-6`. `Stack.Screen options={{ title: "New measurement", headerShown: true }}`.

**Field order:**

1. `Date` — `Input` with placeholder `"YYYY-MM-DD"`, `defaultValue = format(new Date(), "yyyy-MM-dd")`, keyboardType `default` (web/iOS show numeric anyway given the format hint).
2. `Weight` — `Input` keyboardType `decimal-pad`, placeholder = current `weightUnit` ("kg" or "lbs"). Stored canonical.
3. `Body fat %` — `Input` keyboardType `decimal-pad`, placeholder `"%"`.
4. Repeated 8 circumference fields (`Neck`, `Chest`, `Biceps`, `Forearm`, `Waist`, `Hips`, `Thigh`, `Calf`) — each `Input` keyboardType `decimal-pad`, placeholder = current `lengthUnit` ("cm" or "in"). Stored canonical.
5. `Notes (optional)` — `Textarea`, max 500.

All fields use `<Controller>` from `react-hook-form`. Inline error via `Input.error`.

**Buttons:** `Save measurement` (primary, `loading={create.isPending}`) and `Cancel` (secondary, `router.back()`).

**Dark mode tokens:** identical to `routines/new.tsx` — `bg-white dark:bg-black`, label/value text colors from `Input` component.

**Submit flow:**

1. `handleSubmit(async values => { ... })`.
2. For each numeric field, parse via `parseWeightToKg` (weight only, using `weightUnit`) or `parseLengthToCm` (circumferences, using `lengthUnit`) or direct parse + comma-handling (body_fat_pct, which has no unit conversion).
3. Convert `measuredAt` string → ISO via `parse(value, "yyyy-MM-dd", new Date()).toISOString()`. (Uses existing `date-fns` already in deps.)
4. Call `create.mutateAsync(input)` → `router.back()`.
5. On error, surface inline below the form (red text), matching `routines/new.tsx:84-90`.

### Screen 3 — `app/(app)/measurements/[id].tsx` (Edit entry)

**Layout:** Same as Screen 2 with:
- Title `"Edit measurement"`.
- `reset(data)` in `useEffect` once `data` arrives — converts canonical kg/cm/% strings back into display strings using `formatWeight`/`formatLength`/`pct.toFixed(1)` (form holds DISPLAY strings; submit re-parses to canonical).
- Save button gated by `isDirty`.
- Delete button at bottom inside a `mt-6 border-t pt-6` block (matches `exercises/[id]/index.tsx:208-216`).
- `confirmDelete({ title: "Delete measurement?", message: "This measurement will be hidden. You can still find it later if you restore the database." })` → on confirm → `softDelete.mutateAsync(id)` → `router.back()`.

**Loading / error branches:** identical to `exercises/[id]/index.tsx:93-111`.

### Component — `src/components/measurement-list-item.tsx`

```tsx
type Props = { entry: MeasurementEntryRow; weightUnit: WeightUnit; lengthUnit: LengthUnit; onPress?: () => void };

function formatHeadline(entry, weightUnit, lengthUnit): string {
  const parts: string[] = [];
  if (entry.weight_kg != null)
    parts.push(formatWeight(parseFloat(entry.weight_kg), weightUnit));
  if (entry.body_fat_pct != null)
    parts.push(`${parseFloat(entry.body_fat_pct).toFixed(1)}% bf`);
  if (entry.waist_cm != null)
    parts.push(`${formatLength(parseFloat(entry.waist_cm), lengthUnit)} waist`);
  return parts.slice(0, 3).join(" · ") || "—";
}
```

Visual:
- Pressable row, `border-b border-gray-100 dark:border-gray-900 px-4 py-4`.
- Line 1 (`text-base font-semibold text-black dark:text-white`): formatted date.
- Line 2 (`mt-0.5 text-sm text-gray-500`): headline metrics from above.
- Line 3 (optional, only if `entry.notes`): `text-xs text-gray-400 mt-1`, truncated to 1 line via `numberOfLines={1}`.
- `<ChevronRight />` affordance right-aligned.

### Profile toggle row (`app/(app)/profile.tsx`)

Drop **inside the existing bordered card** (lines 29-72), adding a second row separated by `border-t border-gray-200 dark:border-gray-800`. Reuses the toggle pattern verbatim, swapping `"kg"|"lbs"` → `"cm"|"in"` and `useSetWeightUnit` → `useSetLengthUnit`.

### Empty-state copy (exact strings)

| Surface | Copy |
|---|---|
| List empty headline | `No measurements logged yet. Log your first to start tracking progress.` |
| List empty CTA | `Log measurement` |
| Delete confirm title | `Delete measurement?` |
| Delete confirm message | `This entry will be hidden from your history.` |
| Save button (new) | `Save measurement` |
| Save button (edit) | `Save changes` |
| Cancel button | `Cancel` |
| New-screen title | `New measurement` |
| Edit-screen title | `Edit measurement` |
| Tab title | `Measurements` |

### Dark-mode tokens (used everywhere)

`bg-white dark:bg-black`, `text-black dark:text-white`, `text-gray-500` (muted), `text-gray-400` (deeper muted), `border-gray-100/200 dark:border-gray-900/800`, primary button `bg-black dark:bg-white` + `text-white dark:text-black`. No new tokens.

## Riscos & mitigações

### Data integrity

- **RLS template skipped on the new table.** Highest-severity bug class in this codebase. **Mitigation**: `0005_measurements.sql` includes the 4-policy + `enable row level security` block inline; `tests/rls.test.ts` is extended with a `measurement_entries` block as a regression gate. Validator must verify both.
- **`length_unit` CHECK constraint missing on existing rows.** Existing rows pick up `'cm'` via default but the CHECK is added in the same statement after the default. **Mitigation**: ALTER ordering in the migration is (a) add column with default → (b) add CHECK constraint. Existing rows satisfy `'cm' IN ('cm','in')` so the CHECK is safe to add.
- **Numeric precision overflow.** `numeric(6,2)` caps at 9999.99. `weight_kg` up to 400 is fine; `body_fat_pct` is `numeric(4,1)` (max 999.9, validated to ≤60 at UI). Circumferences at 250 cm are fine. **Mitigation**: range validation at zod layer is the catch.
- **Soft-delete forgotten in reads.** All list/get queries must `.is("deleted_at", null)`. **Mitigation**: explicitly included in `listMeasurements`/`getMeasurement` per the `exercises` precedent.
- **Composite index direction.** Index is `(user_id, measured_at DESC)` to match the `ORDER BY measured_at DESC` query. PostgreSQL can scan either direction, so a plain index would also work — but matching declaration to query is the cleaner convention and matches `sessions_user_started_idx`'s implicit ASC behavior with a `DESC` query (also fine; both directions OK).

### UX regressions

- **Profile toggle layout overflow on small screens.** Adding a second toggle row inside the card grows the Profile screen by ~80px. **Mitigation**: ScrollView already wraps the screen; no clipping risk. Light spot-check on iPhone SE during implementation.
- **6th tab on iPhone causes label truncation.** Owner already has 5 tabs; "Measurements" is the longest label of the 6. iOS tab bar truncates with `…` at ~7 chars on a narrow device. **Mitigation**: title is acceptable truncated to `Measure…` on the smallest iPhone; alternatively shorten title to `Body` (rejected — less clear). If truncation is unacceptable to the owner, follow-up is to consolidate History+Measurements under "Progress".
- **Shared form keyboardType across web.** `decimal-pad` is iOS/Android-only; web shows default keyboard. **Mitigation**: zod accepts comma decimal via `replace(",", ".")` in `parseLengthToCm`/`parseWeightToKg` (already implemented for weights); no special handling needed.

### Platform-specific

- **Date input on web vs native.** A bare text input with `YYYY-MM-DD` format works universally but is mediocre UX on web (where `<input type="date">` is native). **Mitigation accepted**: v1 uses universal text input; v1.1 may swap to a `Platform.OS === 'web' ? input[type=date] : RNCDateTimePicker` shim. No new dep this round.
- **`date-fns/parse` already in deps.** Verified via existing `src/utils/dates.ts:1-7` import. No `expo install` needed.
- **`react-native-svg` not used.** Charts deferred → no SVG render path on web to worry about this round.

### Performance

- **List read fetches all entries.** At ~50/year worst case, full-table read is trivial. **Mitigation**: not needed; if it becomes a problem (year 5: ~250 rows), add `.limit(200)` to the list query — out of scope.
- **Insert/update with 10 nullable numerics.** Single-row write; PostgREST handles fine.
- **Cache hydration cost on cold start.** `["measurements"]` is persisted via the existing `queryPersister` (`src/lib/query-client.ts:9`) — no new persistence config. Small JSON blob; negligible.
- **`measured_at DESC` ordering relies on the composite index.** Verified the index covers `(user_id, measured_at DESC)` and RLS filters by `user_id` server-side, so the index can satisfy the ORDER BY without a sort step.

## Alternativas descartadas

1. **Parent + child schema (`measurement_entries` + `measurement_values`).** Discovery Unknown §1 option B. Descartada porque the metric list is small (10), stable (hypertrophy/recomp norm), and the join cost + loss of type safety + AI-friendliness penalty isn't paid back at single-user scale.
2. **JSON blob (`metrics jsonb`).** Discovery Unknown §1 option C. Descartada porque loses indexed/typed access — charting "biceps over time" would require SQL JSON-path expressions, undermining the whole reason to store the data.
3. **Profile sub-route instead of a 6th tab.** Discovery Unknown §7 option B. Descartada porque owner framed this as a progress-tracking feature; burying it 2 taps deep under Profile makes it feel like a settings screen. Worse discoverability for the primary input flow.
4. **Native date picker (`@react-native-community/datetimepicker`).** Discovery Unknown §4 sub-option. Descartada porque it requires a new dep + a web shim + Expo dev-client work, all for a feature where the owner will probably enter "today" 95% of the time. The text-input fallback ships v1 with zero risk and is swap-replaceable later.
5. **Two migrations (`0005_measurements_schema.sql` + `0006_measurements_rls.sql`).** Discovery Unknown §16 split. Descartada porque the table is unsafe to use without RLS — coupling schema + RLS in one transaction means a partial migration failure can't leave the DB in a state where the table exists without policies.
6. **Per-side L/R columns from v1.** Discovery Unknown §10. Descartada porque (a) most apps default to single, (b) doubling the form to 18 numeric fields hurts the entry UX, (c) splitting later is trivial.
7. **Bodyweight chart on the list screen.** Discovery Unknown §8 option C. Descartada porque the prompt says "show the history of the inputs" — list satisfies; chart is additional. Deferred to v1.1 explicitly so this run doesn't drift.

## Out of scope

- Photos / progress images (Storage wiring not in scope).
- Goals / target values.
- Reminders / push notifications.
- Sharing / export.
- Per-side L/R columns.
- All-metric charts (and bodyweight-only chart). Tap-a-metric-for-trend is deferred to v1.1.
- Stat strip on History tab cross-feature.
- Refactoring `user_preferences` beyond the one new column.
- A `restored_at` / undo-delete flow.
- A standalone progress dashboard combining body + workout metrics.
- Migrating existing weight-from-sessions into `measurement_entries`.
- Imperial weight as a separate column (single source of truth in kg stays).
- Time-of-day field in the form (it's recorded silently in `measured_at`).
- Delta indicators on list rows ("+0.3 kg from last").

## Open questions for the Validator

1. **Migration safety on hosted DB.** Confirm that `ALTER TABLE user_preferences ADD COLUMN length_unit text NOT NULL DEFAULT 'cm'` on a hosted Supabase DB with existing rows is acceptable in a single transaction (it is — Postgres rewrites the row on this kind of ALTER, but the existing-rows count is at most 2 today so cost is nil).
2. **Tab-bar overflow.** Is the iPhone SE / iPhone 13 mini tab bar truncation of "Measurements" → "Measure…" acceptable, or should the title be shorter (`Body`, `Stats`)?
3. **`measured_at` as `timestamptz` vs `date`.** Storing as `timestamptz` (chosen) carries time-of-day even though the UI is date-only. The Validator should confirm this future-proofing is worth the extra column-conversion when the form serializes the date — alternative is `date` with truncation. I chose `timestamptz` because it matches `sessions.started_at` and gives v1.1 room to expose "morning vs evening weight" without a migration.
4. **Empty-state CTA verbiage.** "Log measurement" vs "Add measurement" vs "Log first measurement". I picked "Log measurement" for brevity and verbal parity with the prompt ("input my current measurements").
5. **Should `seed_new_user()` rewrite be in 0005 or a follow-up.** The function rewrite is mechanically required (the function body must reference `length_unit` if we want explicit-not-default semantics). I chose to bundle it into 0005 to keep the feature atomic; flag for Validator if convention says otherwise.
