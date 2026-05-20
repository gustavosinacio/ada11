# Design v2 — 2026-05-19_2353_measurements-tracking

> Round 2. Addresses every blocker / major / minor raised in `validation-v1.md` (`no-go`, 2 majors + 7 minors). The carry-forward decisions from v1 (schema shape, metric list, navigation, edit/delete, cache namespace, validation ranges, etc.) remain unchanged except where noted. The big shifts are: (a) drop the `seed_new_user()` rewrite (MAJ-1, Path A), (b) add a UNIQUE partial index on `(user_id, date(measured_at))` and a paired client-side error contract (MAJ-2, Path 1).

## Goal (1 sentence)

Add a measurements vertical that lets the owner log periodic body-weight + body-part circumference entries (and body-fat %), edit / soft-delete them, and review the full chronological history from a new "Measurements" bottom tab.

## Approach

Mirror the `sessions`/`exercises` precedent end-to-end: one new wide nullable table (`measurement_entries`), one new tab with a 3-screen stack (list, new, edit), and an additive `length_unit` column on `user_preferences` so the cm↔in conversion lives at the UI boundary alongside the existing kg↔lbs split. Storage is canonical (kg, cm, %); the UI converts using new `cmToIn`/`inToCm`/`formatLength`/`parseLengthToCm` helpers mirroring the kg quartet. The cache namespace is fully separate (`["measurements"]`) — workout writes do not touch it and vice versa. RLS, soft-delete, `...timestamps`, `user_id` denormalization + index, and the `touch_updated_at` trigger are all applied via the existing array-loop template, inlined into a single new migration `0005_measurements.sql` scoped to this feature (no edits to `0001`). History is list-only v1: tap a row → edit screen; no charts. Duplicate same-day entries are prevented at the Postgres layer (UNIQUE partial index) with a friendly client-side fallback.

## Decisions on unknowns (all 20, carried from v1 with v2 deltas marked)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Schema shape | **A. Wide table** with nullable numeric columns. | Single-user scale; metric list is small and stable; matches `sessions`/`sets` "wide nullable" pattern; type-safe + AI-friendly. |
| 2 | Metrics list (v1) | `weight_kg`, `body_fat_pct`, `neck_cm`, `chest_cm`, `biceps_cm`, `forearm_cm`, `waist_cm`, `hips_cm`, `thigh_cm`, `calf_cm` — single columns (no L/R). | 10 metrics + notes; covers hypertrophy/recomp core. Shoulders deferred; trivial 1-line ALTER later. |
| 3 | Length unit | Add `user_preferences.length_unit text NOT NULL DEFAULT 'cm'` + `CHECK (length_unit IN ('cm','in'))`. **v2 delta**: also add a parallel `CHECK (weight_unit IN ('kg','lbs'))` constraint on the existing `weight_unit` column for symmetry (MIN-2). New Profile toggle row mirrors `weight_unit`. New `useLengthUnit()` + `useSetLengthUnit()` hooks. | Established "one source of truth, conversion at UI boundary" rule (`docs/decisions.md:160-161`). Symmetric CHECKs are defensive depth — cheap, matches the `set_type` precedent (`schema.ts:160-163`). |
| 4 | Date model | **Hybrid**: stored as `timestamptz` `measured_at`, defaulting to `now()` on create. UI exposes a date-only text input (`YYYY-MM-DD`) defaulting to today, parsed via `date-fns/parse`. Time-of-day is auto-recorded but not exposed in the form. | Zero new deps. Universal across iOS/Android/web. Owner can backfill yesterday by editing the date string. Native picker swap-in remains a v1.1 option behind the same input contract. |
| 5 | Edit | Yes, editable via `[id].tsx` template. `reset(data)` in `useEffect`, `isDirty` gates Save. | Matches every other resource in the codebase. |
| 6 | Delete | Soft-delete (`deleted_at = now()`). | Universal invariant. |
| 7 | Navigation | **New tab "Measurements" between History and Profile**, icon `Ruler`. **v2 delta (MIN-7)**: explicitly insert the `<Tabs.Screen name="measurements" />` block at `app/(app)/_layout.tsx` BETWEEN line 33 (closing tag of `history`) and line 35 (opening tag of `profile`). | Owner framed this as a progress-tracking feature parallel to History. iPhone tab-bar at 6 is tight but acceptable. |
| 8 | History view | List-only v1. Newest-first chronological list, tap row → edit screen. No charts. | Tight scope; bodyweight chart deferred to v1.1. |
| 9 | Empty-state copy | `"No measurements logged yet. Log your first to start tracking progress."` + CTA `"Log measurement"`. | Mirrors `exercises/index.tsx:43-54` shape exactly. |
| 10 | L/R sides | Single column per metric. | Cheaper to split later than to merge. |
| 11 | Cache namespace | `KEYS = { all: ["measurements"], detail: (id) => ["measurements", id] }`. Strictly separate from `["stats"]`, `["sessions"]`, `["sets"]`. **No cross-domain invalidation in either direction.** | Two unrelated domains; cross-domain invalidation would obscure the contract. |
| 12 | Notes column | Include nullable `notes text`. | Cheap, mirrors `sessions.notes`. |
| 13 | Validation ranges | `weight_kg`: 20-400. `body_fat_pct`: 2-60. All circumferences: 5-250. `notes`: ≤500 chars. All numeric fields individually optional; **at least one numeric field required per entry**. Ranges enforced at zod/UI layer (no DB CHECK on numeric ranges, matching `sets.weight`/`reps` precedent). | Wide bounds avoid false rejects on heavier users; low bounds catch typos. |
| 14 | Body-fat % | Include `body_fat_pct numeric(4,1)` (0.0-100.0, optional). | One column; meaningful for recomp tracking. |
| 15 | Tab icon | `Ruler` from `lucide-react-native`. | Distinctive vs the existing 5 icons. |
| 16 | Migration coupling | **One new migration `0005_measurements.sql`** doing, in order: (a) the parallel `CHECK (weight_unit IN ('kg','lbs'))` on `user_preferences`; (b) `ALTER TABLE user_preferences ADD COLUMN length_unit ... CHECK ...`; (c) `CREATE TABLE measurement_entries (...)`; (d) `CREATE INDEX measurement_entries_user_measured_idx ON measurement_entries (user_id, measured_at)` — plain ASC index, Postgres reads it backwards for `ORDER BY measured_at DESC` (MIN-1); (e) `CREATE UNIQUE INDEX measurement_entries_user_day_idx ON measurement_entries (user_id, date(measured_at AT TIME ZONE 'UTC')) WHERE deleted_at IS NULL` (MAJ-2); (f) one `do $$ ... $$` block applying the 4-policy RLS template for `measurement_entries` + `enable row level security`; (g) one `do $$ ... $$` block applying `touch_updated_at` on `measurement_entries`. **No `seed_new_user()` rewrite** — see decision 18. No edits to `0001`. | Additive-only convention. Splitting into 0005+0006 was considered (Discovery flagged it) — rejected because the table is unsafe without RLS; one transaction is the atomic unit. |
| 17 | RLS test extension | Extend `tests/rls.test.ts` with a `measurement_entries` block: A inserts → B reads/updates/deletes → all must yield zero rows. | Mandatory per security boundary. |
| 18 | **Seed test extension (v2 delta — MAJ-1 Path A)** | The new `length_unit` column relies on its `DEFAULT 'cm'`; the existing `seed_new_user()` function INSERTs only `user_id` and `weight_unit`, so the new column's default fills in for new signups with zero code change. **`seed_new_user()` is NOT rewritten in `0005`.** The seed-and-auth test gains one assertion: `prefs[0].length_unit === 'cm'` (covering the default-on-insert path), and the SELECT call is updated to fetch `length_unit`. | Path A (recommended by validator). Path B (rewriting the function) was rejected because the only payoff is "explicit insert" semantics, at the cost of copy-pasting all 31 rows of `0004`'s exercise block verbatim — a silent footgun if the Implementer misses even one row. Default-driven semantics are equally correct and Implementer-proof. Existing rows in `user_preferences` (≤2 today) also pick up `'cm'` from the same default. |
| 19 | Time-of-day | Stored automatically (`measured_at` = `now()` on create, preserved on update unless user changes the date). Not exposed in v1 UI. Same-day uniqueness uses `date(measured_at AT TIME ZONE 'UTC')` — see decision 16/MAJ-2. | Raw data captured for future use without UI noise; uniqueness uses the UTC date floor to avoid timezone-flap edge cases. |
| 20 | Deltas | Out of scope. | Owner did not ask. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/db/schema.ts` | edited | (1) Add `lengthUnit: text("length_unit").notNull().default("cm")` column to `userPreferences` (line ~37). (2) Add new `measurementEntries` table export at end of file: `id` (uuid, pk), `userId` (uuid, fk → authUsers, cascade, notNull), `measuredAt` (timestamptz, notNull, default `now()`), the 10 numeric columns (`weight_kg`, `body_fat_pct`, 8 `*_cm`), `notes` (text), `...timestamps`, with **two** indexes: `user_measured_idx` composite `(user_id, measured_at)` (plain ASC — Drizzle does not need `.desc()`; Postgres scans backwards for `ORDER BY ... DESC`), and `user_day_idx` UNIQUE on `(user_id, date(measured_at AT TIME ZONE 'UTC'))` partial `WHERE deleted_at IS NULL`. The unique index is expressed in Drizzle as a raw SQL index using `sql\`\`` because Drizzle's typed index builder does not support `date(... AT TIME ZONE ...)` expressions or partial predicates ergonomically. |
| `src/db/types.ts` | edited | Add `export type LengthUnit = "cm" \| "in"` next to `WeightUnit`. Add `MeasurementEntry`/`NewMeasurementEntry` inferred types. Add `MeasurementEntryRow` snake_case type matching the PostgREST response shape (numerics typed as `string \| null`). Re-export `measurementEntries` from schema. |
| `src/utils/units.ts` | edited | Add `cmToIn(cm: number): number`, `inToCm(inches: number): number`, `formatLength(cm: number \| null \| undefined, unit: LengthUnit): string`, `parseLengthToCm(input: string, unit: LengthUnit): number \| null`. Mirror the kg quartet line-for-line. Constant `CM_PER_IN = 2.54`. |
| `src/utils/measurements-form.ts` | **new** (v2 delta — MIN-3) | Shared transform / parsing utilities for the measurements form: `parseOptionalDecimal(s: string): number \| null` (trims, replaces `,` with `.`, returns `null` for empty/NaN), `buildSubmitPayload(values: MeasurementFormValues, weightUnit, lengthUnit): MeasurementInput` (runs each metric string through the right parser — `parseWeightToKg` for weight, `parseLengthToCm` for circumferences, `parseOptionalDecimal` for body-fat — and converts `YYYY-MM-DD` → ISO via `date-fns/parse`), and `measurementsSchema` (the zod schema; see Contratos §Form schema). Co-locating these keeps `new.tsx` and `[id].tsx` symmetric. |
| `src/api/preferences.ts` | edited | Extend `UserPreferencesRow` with `length_unit: LengthUnit`. Add `setLengthUnit(unit: LengthUnit): Promise<UserPreferencesRow>` mirroring `setWeightUnit`. |
| `src/hooks/use-preferences.ts` | edited | Add `useLengthUnit(): LengthUnit` (defaults `"cm"`) and `useSetLengthUnit()` mutation. No changes to `KEY` or `usePreferences()`. |
| `app/(app)/profile.tsx` | edited | Add a second toggle row below the weight-unit row labeled "Length unit", values `cm`/`in`, wired to `useLengthUnit()` + `useSetLengthUnit()`. Visual treatment identical to the existing toggle. Wrap both rows in the same bordered card. |
| `app/(app)/_layout.tsx` | edited | Insert a 6th `<Tabs.Screen name="measurements" ... />` **between line 33 (closing `</Tabs.Screen>`-equivalent of `history`) and line 35 (opening `<Tabs.Screen` of `profile`)**, icon `<Ruler color={color} size={size} />`. Add `Ruler` to the `lucide-react-native` import on line 2. The resulting order is Workout / Routines / Exercises / History / **Measurements** / Profile. |
| `src/api/measurements.ts` | new | Five functions: `listMeasurements()`, `getMeasurement(id)`, `createMeasurement(input)`, `updateMeasurement(id, patch)`, `softDeleteMeasurement(id)`. Mirrors `src/api/exercises.ts` shape. **Error contract**: `createMeasurement` and `updateMeasurement` catch Supabase errors with `error.code === '23505'` (unique_violation) on the `measurement_entries_user_day_idx` constraint and re-throw as a typed `DuplicateMeasurementDateError extends Error { existingDate: string }` so the UI can render the dedicated copy without string-matching the message. |
| `src/hooks/use-measurements.ts` | new | TanStack Query hooks: `useMeasurements()`, `useMeasurement(id)`, `useCreateMeasurement()`, `useUpdateMeasurement()`, `useSoftDeleteMeasurement()`. `KEYS = { all: ["measurements"], detail: (id) => ["measurements", id] }`. Invalidation set: `["measurements"]` umbrella only. **Does NOT invalidate `["stats"]` or `["sessions"]`.** |
| `app/(app)/measurements/_layout.tsx` | new | `<Stack screenOptions={{ headerShown: false }} />` wrapper. Mirrors `app/(app)/exercises/_layout.tsx`. |
| `app/(app)/measurements/index.tsx` | new | List screen. Uses `useMeasurements()`. Loading / error / empty / `FlatList` of `<MeasurementListItem>`. `headerRight` = Plus button → `/(app)/measurements/new`. Empty-state copy per decision 9. Pull-to-refresh. |
| `app/(app)/measurements/new.tsx` | new | Form screen. `react-hook-form` + zodResolver. Fields grouped into 6 sections (see UI spec §Screen 2). Save → `createMeasurement(...)` → on success `router.back()`. On `DuplicateMeasurementDateError`, render inline banner + "Edit existing entry instead" button → router pushes `/(app)/measurements/[id]` for the existing row (fetched via list query). |
| `app/(app)/measurements/[id].tsx` | new | Edit screen. `useMeasurement(id)` → `reset(data)`. Same field set + grouping. `isDirty` gates Save. Soft-delete button at bottom with `confirmDelete`. |
| `src/components/measurement-list-item.tsx` | new | List-row Pressable. Top line: formatted date. Sub-line: best 2-of-3 of `{weight, body-fat, waist}` summary. Falls back gracefully when fields are null. Chevron-right affordance. |
| `supabase/migrations/0005_measurements.sql` | new | Single migration. Steps in order: (1) `ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_weight_unit_check CHECK (weight_unit IN ('kg','lbs'))`; (2) `ALTER TABLE user_preferences ADD COLUMN length_unit text NOT NULL DEFAULT 'cm'`; (3) `ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_length_unit_check CHECK (length_unit IN ('cm','in'))`; (4) `CREATE TABLE public.measurement_entries (...)`; (5) `CREATE INDEX measurement_entries_user_measured_idx ON public.measurement_entries (user_id, measured_at)`; (6) `CREATE UNIQUE INDEX measurement_entries_user_day_idx ON public.measurement_entries (user_id, date(measured_at AT TIME ZONE 'UTC')) WHERE deleted_at IS NULL`; (7) one `do $$ ... $$` RLS block (4 policies + enable RLS) with `tables text[] := array['measurement_entries']`; (8) one `do $$ ... $$` trigger block applying `touch_updated_at` on `measurement_entries`. **No `create or replace function public.seed_new_user()` block** — see decision 18. |
| `tests/rls.test.ts` | edited | Append a `measurement_entries` block after the existing `exercises` block: A inserts a row with `user_id: a.user.id`, B attempts read/update/delete, each must yield zero rows. |
| `tests/seed-and-auth.test.ts` | edited | After the existing `weight_unit === 'kg'` assertion, add `if (prefs[0]!.length_unit !== "cm") throw new Error(...)`. Update the `.select(...)` call to include `length_unit`. The existing `≥ 25` exercises assertion is **unaffected** because `seed_new_user()` is not modified. |
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
    // Plain ASC composite. Postgres reads it backwards for ORDER BY measured_at DESC
    // (matches the sessions_user_started_idx convention at schema.ts:122).
    userMeasuredIdx: index("measurement_entries_user_measured_idx").on(
      t.userId,
      t.measuredAt,
    ),
    // UNIQUE partial expression index — expressed via raw SQL because Drizzle's
    // typed index builder does not support date(... AT TIME ZONE ...) or WHERE
    // ergonomically. Functional contract is enforced server-side regardless;
    // the runtime in production is the SQL migration below, not Drizzle.
  }),
);
```

**Note on the unique index in Drizzle**: the source of truth for the unique partial index is the SQL migration. Drizzle's TypeScript builder lacks first-class support for date-truncation expressions + `WHERE`, so we leave it out of the `t => ({ ... })` block rather than mis-encode it. The migration is what runs in production. This mirrors the existing precedent where Drizzle source is partial (e.g. CHECK constraints in `schema.ts:160-168` are typed in TS but RLS in `0001` is only in SQL).

### Row type (snake_case, what hooks/screens consume)

```ts
export type MeasurementEntryRow = {
  id: string;
  user_id: string;
  measured_at: string;          // ISO timestamptz
  weight_kg:    string | null;  // numeric → string per Supabase JS
  body_fat_pct: string | null;
  neck_cm:      string | null;
  chest_cm:     string | null;
  biceps_cm:    string | null;
  forearm_cm:   string | null;
  waist_cm:     string | null;
  hips_cm:      string | null;
  thigh_cm:     string | null;
  calf_cm:      string | null;
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
  measuredAt: string;            // ISO string (form converts YYYY-MM-DD → ISO at submit)
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

export class DuplicateMeasurementDateError extends Error {
  constructor(public readonly measuredDate: string) {
    super(`A measurement already exists for ${measuredDate}.`);
    this.name = "DuplicateMeasurementDateError";
  }
}

export function listMeasurements(): Promise<MeasurementEntryRow[]>;
export function getMeasurement(id: string): Promise<MeasurementEntryRow>;
export function createMeasurement(input: MeasurementInput): Promise<MeasurementEntryRow>;
export function updateMeasurement(id: string, patch: MeasurementInput): Promise<MeasurementEntryRow>;
export function softDeleteMeasurement(id: string): Promise<void>;
```

**Duplicate-date error contract**: `createMeasurement` / `updateMeasurement` perform their insert/update against Supabase. If the call returns `{ error }` with `error.code === '23505'` (PostgreSQL `unique_violation`) AND the error references `measurement_entries_user_day_idx`, the API throws a typed `DuplicateMeasurementDateError` carrying the offending `YYYY-MM-DD` (extracted from the input — not the error message, which is fragile). All other errors propagate as-is.

### Hook surface (`src/hooks/use-measurements.ts`)

```ts
const KEYS = {
  all: ["measurements"] as const,
  detail: (id: string) => ["measurements", id] as const,
};

export function useMeasurements();
export function useMeasurement(id: string | undefined);
export function useCreateMeasurement();
export function useUpdateMeasurement();
export function useSoftDeleteMeasurement();
```

**Invalidation contract:**
- `useCreateMeasurement` / `useUpdateMeasurement` / `useSoftDeleteMeasurement` invalidate **only** `["measurements"]` (plus `setQueryData` on `KEYS.detail(id)` for updates).
- They do **NOT** touch `["stats"]`, `["sessions"]`, `["sets"]`, `["exercises"]`, `["routines"]`.
- Workout/exercise/routine hooks do **NOT** touch `["measurements"]` (zero code change needed; they simply never reference the key).

### Units helpers (`src/utils/units.ts`)

```ts
const CM_PER_IN = 2.54;

export function cmToIn(cm: number): number;                                    // cm / CM_PER_IN
export function inToCm(inches: number): number;                                // inches * CM_PER_IN
export function formatLength(cm: number | null | undefined, unit: LengthUnit): string;
//   null/undefined -> "—"; else `${value.toFixed(1)} ${unit}`
export function parseLengthToCm(input: string, unit: LengthUnit): number | null;
//   parseFloat with comma-to-dot replace; NaN/empty -> null; cm passthrough, in via inToCm
```

### Form schema + submit pipeline (`src/utils/measurements-form.ts`) — v2 delta, MIN-3

The form holds strings everywhere; the submit pipeline parses + transforms to canonical numbers and ranges are checked on the canonical (kg/cm/%) values. Specified exactly so the Implementer doesn't invent a pattern.

```ts
import { z } from "zod";
import { parse } from "date-fns";
import { parseWeightToKg, parseLengthToCm } from "./units";
import type { LengthUnit, WeightUnit } from "@/db/types";
import type { MeasurementInput } from "@/api/measurements";

// --- Form-side value shape: ALL fields are strings (or empty string). RHF
//     defaultValues mirror this shape exactly. -----------------------------
export type MeasurementFormValues = {
  measuredAt: string;
  weightKg: string;
  bodyFatPct: string;
  neckCm: string;
  chestCm: string;
  bicepsCm: string;
  forearmCm: string;
  waistCm: string;
  hipsCm: string;
  thighCm: string;
  calfCm: string;
  notes: string;
};

export const emptyMeasurementFormValues = (today: Date): MeasurementFormValues => ({
  measuredAt: formatDateInput(today), // "YYYY-MM-DD"
  weightKg: "", bodyFatPct: "",
  neckCm: "", chestCm: "", bicepsCm: "", forearmCm: "",
  waistCm: "", hipsCm: "", thighCm: "", calfCm: "",
  notes: "",
});

// --- Zod schema operates on STRINGS, validates the shape, then a top-level
//     .refine() enforces "at least one metric provided" on the canonical values
//     extracted by transform. Range checks live in checkRanges() called inside
//     the same .refine() (or as a separate .superRefine() chain). -----------
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optStr  = z.string().trim().optional().or(z.literal(""));

export const measurementsSchema = z.object({
  measuredAt: dateStr,
  weightKg: optStr, bodyFatPct: optStr,
  neckCm: optStr,   chestCm: optStr,   bicepsCm: optStr, forearmCm: optStr,
  waistCm: optStr,  hipsCm: optStr,    thighCm: optStr,  calfCm: optStr,
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

// --- Submit pipeline: parse strings → canonical numbers → range-check →
//     build MeasurementInput. Throws zod-shaped errors on range failure so
//     RHF surfaces them inline against the right field. ---------------------
export function parseOptionalDecimal(s: string): number | null {
  const trimmed = (s ?? "").trim().replace(",", ".");
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

const RANGES: Record<keyof Omit<MeasurementInput, "measuredAt" | "notes">, [number, number]> = {
  weightKg:   [20, 400],
  bodyFatPct: [2, 60],
  neckCm:     [5, 250],
  chestCm:    [5, 250],
  bicepsCm:   [5, 250],
  forearmCm:  [5, 250],
  waistCm:    [5, 250],
  hipsCm:     [5, 250],
  thighCm:    [5, 250],
  calfCm:     [5, 250],
};

export function buildSubmitPayload(
  values: MeasurementFormValues,
  weightUnit: WeightUnit,
  lengthUnit: LengthUnit,
): MeasurementInput {
  const measuredAtIso = parse(values.measuredAt, "yyyy-MM-dd", new Date()).toISOString();

  const weightKg   = values.weightKg   === "" ? null : parseWeightToKg(values.weightKg, weightUnit);
  const bodyFatPct = parseOptionalDecimal(values.bodyFatPct);
  const neckCm     = values.neckCm    === "" ? null : parseLengthToCm(values.neckCm,    lengthUnit);
  const chestCm    = values.chestCm   === "" ? null : parseLengthToCm(values.chestCm,   lengthUnit);
  const bicepsCm   = values.bicepsCm  === "" ? null : parseLengthToCm(values.bicepsCm,  lengthUnit);
  const forearmCm  = values.forearmCm === "" ? null : parseLengthToCm(values.forearmCm, lengthUnit);
  const waistCm    = values.waistCm   === "" ? null : parseLengthToCm(values.waistCm,   lengthUnit);
  const hipsCm     = values.hipsCm    === "" ? null : parseLengthToCm(values.hipsCm,    lengthUnit);
  const thighCm    = values.thighCm   === "" ? null : parseLengthToCm(values.thighCm,   lengthUnit);
  const calfCm     = values.calfCm    === "" ? null : parseLengthToCm(values.calfCm,    lengthUnit);

  const payload: MeasurementInput = {
    measuredAt: measuredAtIso,
    weightKg, bodyFatPct,
    neckCm, chestCm, bicepsCm, forearmCm, waistCm, hipsCm, thighCm, calfCm,
    notes: values.notes.trim() === "" ? null : values.notes.trim(),
  };

  // Range check on canonical values.
  const issues: { path: keyof MeasurementInput; message: string }[] = [];
  for (const [key, [min, max]] of Object.entries(RANGES) as [keyof typeof RANGES, [number, number]][]) {
    const v = payload[key];
    if (v != null && (v < min || v > max)) {
      issues.push({ path: key, message: `Must be between ${min} and ${max}` });
    }
  }
  if (issues.length > 0) {
    throw new z.ZodError(
      issues.map((i) => ({ code: z.ZodIssueCode.custom, path: [i.path], message: i.message })),
    );
  }

  // At-least-one metric required.
  const anyMetric =
    weightKg != null || bodyFatPct != null ||
    neckCm != null || chestCm != null || bicepsCm != null || forearmCm != null ||
    waistCm != null || hipsCm != null || thighCm != null || calfCm != null;
  if (!anyMetric) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ["weightKg"],
      message: "Log at least one measurement",
    }]);
  }

  return payload;
}
```

**Submit handler (in `new.tsx` / `[id].tsx`):**

```ts
const onSubmit = handleSubmit(async (values) => {
  let payload: MeasurementInput;
  try {
    payload = buildSubmitPayload(values, weightUnit, lengthUnit);
  } catch (e) {
    if (e instanceof z.ZodError) {
      e.errors.forEach((issue) => setError(issue.path[0] as keyof MeasurementFormValues, { message: issue.message }));
      return;
    }
    throw e;
  }
  try {
    await create.mutateAsync(payload);   // or update.mutateAsync({ id, patch: payload })
    router.back();
  } catch (e) {
    if (e instanceof DuplicateMeasurementDateError) {
      setDuplicateError(e); // UI renders banner — see Screen 2 spec
      return;
    }
    throw e;
  }
});
```

This is the contract — the Implementer copies the pattern verbatim. No "invent a pattern" room.

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

**Indexes:**
- `measurement_entries_user_measured_idx (user_id, measured_at)` — plain ASC; Postgres scans backwards for `ORDER BY measured_at DESC`.
- `measurement_entries_user_day_idx UNIQUE (user_id, date(measured_at AT TIME ZONE 'UTC')) WHERE deleted_at IS NULL` — enforces no two active rows per user per UTC calendar day.

**RLS policies:** 4 policies (`select`/`insert`/`update`/`delete`), all gated by `auth.uid() = user_id`, applied via the `do $$ ... $$` template from `0001_rls_and_seed.sql:17-44` with a single-element array `array['measurement_entries']`.

**Trigger:** `touch_updated_at` applied via the same `do $$ ... $$` template from `0001_rls_and_seed.sql:114-130`, single-element array.

### `user_preferences` changes

```sql
-- Symmetric CHECK on the existing column (v2 delta — MIN-2)
alter table public.user_preferences
  add constraint user_preferences_weight_unit_check
  check (weight_unit in ('kg','lbs'));

-- New column with default + CHECK
alter table public.user_preferences
  add column length_unit text not null default 'cm';

alter table public.user_preferences
  add constraint user_preferences_length_unit_check
  check (length_unit in ('cm','in'));
```

**No `seed_new_user()` rewrite.** Existing rows in `user_preferences` will get `length_unit='cm'` via the column default (the `add column ... default 'cm'` ALTER backfills existing rows during the column-rewrite). The seed function does not need to be rewritten because the INSERT in the existing function omits `length_unit` and the column default fills it for newly inserted rows just as it does for the backfill. Verified semantically against `0004_exercise_muscles_array.sql:50-52` where the existing `INSERT INTO user_preferences (user_id, weight_unit)` would, after `0005`, insert `length_unit = 'cm'` by default on new signups.

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

Same skeleton as `app/(app)/exercises/index.tsx`.

- `Stack.Screen options={{ title: "Measurements", headerShown: true, headerRight: Plus → /measurements/new }}`.
- Container: `<View className="flex-1 bg-white dark:bg-black">`.
- Branches:
  - **Loading**: centered `<ActivityIndicator />`.
  - **Error**: centered red text.
  - **Empty**: gray-500 one-liner `"No measurements logged yet. Log your first to start tracking progress."` + primary button `"Log measurement"` → `/(app)/measurements/new`.
  - **Populated**: `<FlatList>` of `<MeasurementListItem>` newest-first, `RefreshControl`.

### Screen 2 — `app/(app)/measurements/new.tsx` (New entry)

`ScrollView` with `px-6 py-6`. `Stack.Screen options={{ title: "New measurement", headerShown: true }}`.

**Form grouped into 6 sections (v2 delta — MIN-4).** Each section header uses `<Text className="mt-4 mb-2 text-sm font-medium uppercase text-gray-500">` (matches the Profile screen's "Preferences"/"About" section style):

| Section | Header | Fields |
|---|---|---|
| 1 | (no header — first section flush at top) | `Date` (text input, `YYYY-MM-DD`, defaults to today) |
| 2 | `Weight & body fat` | `Weight` (decimal-pad, placeholder = current `weightUnit`), `Body fat %` (decimal-pad, placeholder `%`) |
| 3 | `Upper body` | `Neck`, `Chest`, `Biceps`, `Forearm` (all decimal-pad, placeholder = current `lengthUnit`) |
| 4 | `Core` | `Waist`, `Hips` (decimal-pad, placeholder = current `lengthUnit`) |
| 5 | `Lower body` | `Thigh`, `Calf` (decimal-pad, placeholder = current `lengthUnit`) |
| 6 | `Notes` | `Notes (optional)` — `Textarea`, max 500 |

All fields use `<Controller>` from `react-hook-form`. Inline error via `Input.error`.

**Buttons:** `Save measurement` (primary, `loading={create.isPending}`) and `Cancel` (secondary, `router.back()`).

**Dark mode tokens:** identical to `routines/new.tsx`.

**Submit flow:** see `src/utils/measurements-form.ts` pipeline above (`buildSubmitPayload` + try/catch on zod / `DuplicateMeasurementDateError`).

**Duplicate-date error UI:** when `DuplicateMeasurementDateError` is caught, render an inline banner above the Save button:

> `You already have a measurement for {YYYY-MM-DD} — edit it instead?` — followed by a secondary button `Open existing entry` that calls `router.replace("/(app)/measurements/[id]", { id: existingId })`. The existing ID is found by reading the `useMeasurements()` query cache and selecting the row whose `date(measured_at)` matches. Banner styling: `border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-3 rounded-lg mb-4 text-amber-900 dark:text-amber-100`.

### Screen 3 — `app/(app)/measurements/[id].tsx` (Edit entry)

Same as Screen 2 with:
- Title `"Edit measurement"`.
- `reset(data)` in `useEffect` once `data` arrives — converts canonical kg/cm/% strings back into display strings using `formatWeight`/`formatLength`/`pct.toFixed(1)` (form holds DISPLAY strings; submit re-parses to canonical via `buildSubmitPayload`).
- Save button gated by `isDirty`.
- Delete button at bottom inside a `mt-6 border-t pt-6` block.
- `confirmDelete({ title: "Delete measurement?", message: "This entry will be hidden from your history." })` → on confirm → `softDelete.mutateAsync(id)` → `router.back()`.
- Editing an entry's date to collide with another existing entry surfaces the same `DuplicateMeasurementDateError` banner pattern. The `WHERE deleted_at IS NULL` clause on the unique index means soft-deleted rows do not block re-entry.

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
- Line 2 (`mt-0.5 text-sm text-gray-500`): headline metrics.
- Line 3 (only if `entry.notes`): `text-xs text-gray-400 mt-1`, `numberOfLines={1}`.
- `<ChevronRight />` affordance right-aligned.

### Profile toggle row (`app/(app)/profile.tsx`)

Drop **inside the existing bordered card**, adding a second row separated by `border-t border-gray-200 dark:border-gray-800`. Reuses the toggle pattern verbatim, swapping `"kg"|"lbs"` → `"cm"|"in"` and `useSetWeightUnit` → `useSetLengthUnit`.

### Tab placement (v2 delta — MIN-7)

In `app/(app)/_layout.tsx`, the new tab is inserted **between line 33 (closing `/>` of the `history` `<Tabs.Screen>`) and line 35 (opening `<Tabs.Screen` of `profile`)**. The full insertion block:

```tsx
<Tabs.Screen
  name="measurements"
  options={{
    title: "Measurements",
    tabBarIcon: ({ color, size }) => <Ruler color={color} size={size} />,
  }}
/>
```

`Ruler` added to the import on line 2: `import { Dumbbell, History, ListChecks, Ruler, User, Wrench } from "lucide-react-native";`.

### Empty-state copy (exact strings, v2 reconciled — MIN-6)

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
| Duplicate-date banner | `You already have a measurement for {YYYY-MM-DD} — edit it instead?` |
| Duplicate-date banner CTA | `Open existing entry` |

### Dark-mode tokens

`bg-white dark:bg-black`, `text-black dark:text-white`, `text-gray-500`, `text-gray-400`, `border-gray-100/200 dark:border-gray-900/800`, primary button `bg-black dark:bg-white` + `text-white dark:text-black`. Amber banner tokens added for the duplicate-date case (see Screen 2). No other new tokens.

## Riscos & mitigações

### Data integrity

- **RLS template skipped on the new table.** Highest-severity bug class in this codebase. **Mitigation**: `0005_measurements.sql` includes the 4-policy + `enable row level security` block inline; `tests/rls.test.ts` is extended with a `measurement_entries` block as a regression gate.
- **`length_unit` CHECK constraint vs. existing rows.** Existing rows pick up `'cm'` via the column default during the ALTER, then the CHECK is added. `'cm' IN ('cm','in')` is satisfied for all backfilled rows. **Mitigation**: ALTER ordering in the migration is (a) add column with default, (b) add CHECK constraint.
- **New `weight_unit` CHECK vs. existing rows (v2 delta — MIN-2).** Existing rows already store `'kg'` (the function default) so `'kg' IN ('kg','lbs')` is satisfied. If any row somehow holds another value, the ALTER fails atomically (no partial-state risk). **Mitigation**: the ALTER is in a transaction; if it fails, the migration aborts cleanly.
- **Numeric precision overflow.** `numeric(6,2)` caps at 9999.99. `weight_kg` up to 400 is fine; `body_fat_pct` is `numeric(4,1)` (max 999.9, validated to ≤60 at UI). Circumferences at 250 cm are fine.
- **Soft-delete forgotten in reads.** All list/get queries must `.is("deleted_at", null)`. **Mitigation**: explicitly included in `listMeasurements`/`getMeasurement` per the `exercises` precedent.
- **Composite index direction (MIN-1 reconciled).** Index is plain ASC `(user_id, measured_at)` in both the Drizzle source and the SQL migration. Postgres can scan it backwards for `ORDER BY measured_at DESC` — same as `sessions_user_started_idx` (`schema.ts:122`). The earlier v1 wording claiming `DESC` is dropped.
- **Duplicate same-day entries (v2 delta — MAJ-2).** UNIQUE partial index on `(user_id, date(measured_at AT TIME ZONE 'UTC')) WHERE deleted_at IS NULL` enforces one active row per user per UTC calendar day. Edge case: a measurement created in BRT at 21:00 (UTC 00:00 next day) and another at BRT 22:00 the same evening will land on different UTC days and not collide — acceptable given the owner is sole user and lives in BRT; documenting this corner so the validator sees we considered it. Soft-deleted rows do not block re-entry (the `WHERE deleted_at IS NULL` clause). Client-side: `DuplicateMeasurementDateError` thrown by the API layer surfaces a friendly banner with a deep-link to the existing entry.
- **Seed regression risk (v2 delta — MAJ-1).** v1 planned to rewrite `seed_new_user()`. v2 drops the rewrite entirely; the existing function's `INSERT INTO user_preferences (user_id, weight_unit)` is unaffected and the new column's `DEFAULT 'cm'` fills `length_unit` for new signups. The full 31-row exercise block in `0004` continues to seed unmodified. The `tests/seed-and-auth.test.ts` `≥ 25` exercises assertion is therefore preserved without code change.

### UX regressions

- **Profile toggle layout overflow on small screens.** Adding a second toggle row grows the Profile screen by ~80px. ScrollView already wraps the screen; no clipping risk.
- **6th tab on iPhone causes label truncation.** "Measurements" is the longest of the 6 labels. iOS may truncate to `Measure…` on the smallest iPhones. Acceptable for v1; consolidation under "Progress" is a documented follow-up.
- **Long form on a single screen.** Even grouped into 6 sections, 12 fields is still long. **Mitigation**: section headers (MIN-4) chunk the visual scan; ScrollView accommodates; user is expected to fill ~3-5 fields per entry in practice, not all 10.
- **Duplicate-date banner confusion.** If the user genuinely wants to log a second measurement on the same day (e.g. morning + evening weight), v1 blocks this. **Mitigation**: documented in Out of scope; v1.1 could expose time-of-day. Banner CTA gives a clear next step.

### Platform-specific

- **Date input on web vs native.** A bare text input with `YYYY-MM-DD` format works universally but is mediocre UX on web. **Mitigation accepted**: v1 universal text input; v1.1 may swap to `Platform.OS === 'web' ? <input type=date> : RNCDateTimePicker`.
- **`date-fns/parse` import (v2 delta — MIN-5).** `date-fns` v4.1.0 is in `package.json:31`; `parse` is a v4 export. No new dep, no `expo install`. Citation tightened to the manifest line, not the unrelated `dates.ts` import list.
- **`react-native-svg` not used.** Charts deferred; no SVG render path on web to worry about this round.

### Performance

- **List read fetches all entries.** At ~50/year worst case, full-table read is trivial.
- **Insert/update with 10 nullable numerics.** Single-row write; PostgREST handles fine.
- **UNIQUE partial index cost.** Single index lookup per insert; partial predicate keeps it small. Negligible.
- **`measured_at DESC` ordering via the composite index.** Verified the index covers `(user_id, measured_at)` and RLS filters by `user_id` server-side, so the index can satisfy the ORDER BY in either direction.
- **Cache hydration cost on cold start.** `["measurements"]` is persisted via the existing `queryPersister` — no new persistence config.

## Alternativas descartadas

1. **Parent + child schema (`measurement_entries` + `measurement_values`).** Discovery Unknown §1 option B. Rejected: metric list is small (10), stable, and join cost + loss of type safety + AI-friendliness penalty isn't paid back at single-user scale.
2. **JSON blob (`metrics jsonb`).** Discovery Unknown §1 option C. Rejected: loses indexed/typed access; charting "biceps over time" would require SQL JSON-path expressions.
3. **Profile sub-route instead of a 6th tab.** Rejected: progress-tracking framing makes Profile feel wrong; worse discoverability for the primary input flow.
4. **Native date picker (`@react-native-community/datetimepicker`).** Rejected: new dep + web shim + Expo dev-client work for a feature where "today" is the 95% case.
5. **Two migrations (`0005_measurements_schema.sql` + `0006_measurements_rls.sql`).** Rejected: table is unsafe without RLS; one atomic transaction is safer.
6. **Per-side L/R columns from v1.** Rejected: doubles form size; splitting later is trivial.
7. **Bodyweight chart on the list screen.** Rejected: out of scope; deferred to v1.1 explicitly.
8. **v2 NEW: Rewriting `seed_new_user()` to include `length_unit` explicitly (MAJ-1 Path B).** Rejected: payoff is purely "explicit insert" semantics; cost is copy-pasting all 31 exercise rows from `0004` verbatim, with a silent regression if any row is missed. The `DEFAULT 'cm'` constraint covers the new-user case for free and is impossible to break by Implementer oversight. (Validator's recommended Path A.)
9. **v2 NEW: Changing `measured_at` to `date NOT NULL DEFAULT current_date` to enable a trivial UNIQUE constraint (MAJ-2 Path 2).** Rejected: loses time-of-day capture for v1.1 ("morning vs evening weight"). The hybrid `timestamptz` + UNIQUE partial expression index preserves the time data while still preventing accidental same-day duplicates.
10. **v2 NEW: Client-side-only duplicate guard (MAJ-2 alternative).** Rejected: race-condition prone (two windows / two devices), and pure client-side validation is bypassable. Server-side UNIQUE + client-side friendly error is the standard pattern. The validator's recommended Path 1.
11. **v2 NEW: Allowing duplicates explicitly (MAJ-2 Path 3).** Rejected: produces ambiguous chart points and history rows; owner phrased the prompt as singular ("input my current measurements") and the cost of preventing duplicates is one index.
12. **v2 NEW: Numeric-shaped zod schema (`z.number().nullable()`).** Rejected (MIN-3): incompatible with RHF + `<Input>` value-prop expecting strings. String-shaped schema + canonical-value transform inside `buildSubmitPayload` matches codebase precedent (`routines/new.tsx:12-15`, `exercises/new.tsx:14-21`).

## Out of scope

- Photos / progress images (Storage wiring not in scope).
- Goals / target values.
- Reminders / push notifications.
- Sharing / export.
- Per-side L/R columns.
- All-metric charts (and bodyweight-only chart). Tap-a-metric-for-trend deferred to v1.1.
- Stat strip on History tab cross-feature.
- Refactoring `user_preferences` beyond the new column + parallel CHECK.
- A `restored_at` / undo-delete flow.
- A standalone progress dashboard combining body + workout metrics.
- Migrating existing weight-from-sessions into `measurement_entries`.
- Imperial weight as a separate column (single source of truth in kg stays).
- Time-of-day field in the form (recorded silently in `measured_at`).
- Delta indicators on list rows ("+0.3 kg from last").
- Multi-entry-per-day support (blocked by UNIQUE partial index by design; lift in v1.1 if needed).

## Resposta a issues do Validator (v1)

| Issue | Severity | Where addressed in v2 |
|---|---|---|
| **MAJ-1** — `seed_new_user()` rewrite risks dropping the exercise seed block | major | **Decision 18** + §user_preferences changes + §Riscos > Data integrity ("Seed regression risk"). Chosen **Path A**: drop the rewrite entirely; rely on `DEFAULT 'cm'` for both backfill (existing rows) and new-signup INSERTs (column default fills it). The `tests/seed-and-auth.test.ts` `≥ 25` exercises assertion is untouched. |
| **MAJ-2** — duplicate same-day strategy missing | major | **Decision 16** (migration step 6) + §DB columns > Indexes + §API surface (`DuplicateMeasurementDateError`) + §Screen 2 duplicate-date error UI + §Riscos > Data integrity. Chosen **Path 1**: UNIQUE partial index on `(user_id, date(measured_at AT TIME ZONE 'UTC')) WHERE deleted_at IS NULL`; API surfaces a typed `DuplicateMeasurementDateError` on Postgres `23505`; UI renders a banner with a deep-link to the existing entry. |
| **MIN-1** — Drizzle index DESC claim vs ASC encoding | minor | §Drizzle table snippet + §DB columns > Indexes + §Riscos > Data integrity now consistently describe the index as **plain ASC** with Postgres reading it backwards for `ORDER BY DESC`. The `DESC` claim is dropped from the column-shape table; no `.desc()` modifier in the Drizzle source. |
| **MIN-2** — asymmetric CHECK constraints | minor | **Decision 3** + §user_preferences changes (step 1 of the migration adds the parallel `CHECK (weight_unit IN ('kg','lbs'))`). Both columns symmetric. |
| **MIN-3** — incoherent form schema (string inputs vs numeric zod) | minor | **New file `src/utils/measurements-form.ts`** + §Contratos > Form schema + §Screen 2 submit flow. Schema is fully string-shaped (`z.string().trim().optional().or(z.literal(""))`); range validation runs on canonical (kg/cm/%) numbers inside `buildSubmitPayload`. Implementer copies the pattern verbatim. |
| **MIN-4** — 12-field form is a wall | minor | §Screen 2 > "Form grouped into 6 sections" table. Section headers `<Text className="mt-4 mb-2 text-sm font-medium uppercase text-gray-500">`; field-to-section assignments enumerated. |
| **MIN-5** — `date-fns/parse` citation wrong | minor | §Riscos > Platform-specific. Citation tightened to `package.json:31` (`"date-fns": "^4.1.0"`); `parse` is a v4 export. |
| **MIN-6** — duplicate delete-confirm copy | minor | §Empty-state copy table + §Screen 3 spec both now read `"This entry will be hidden from your history."`. The longer "restore the database" wording is removed. |
| **MIN-7** — tab insertion order not pinned | minor | **Decision 7** + §Tab placement spec. Insertion is **between line 33 (closing `/>` of `history`) and line 35 (opening `<Tabs.Screen` of `profile`)** in `app/(app)/_layout.tsx`. Resulting order documented: Workout / Routines / Exercises / History / Measurements / Profile. |

## Open questions for the Validator

None blocking. Two soft considerations for the validator to weigh, neither of which requires a re-design round:

1. **UNIQUE index timezone choice.** Picked UTC (`date(measured_at AT TIME ZONE 'UTC')`) for the unique key because it matches how `measured_at` is stored and avoids the index expression depending on session timezone. Owner lives in BRT (UTC-3), so a measurement logged after BRT 21:00 will land on the next UTC day. Practical impact: near-zero (owner doesn't log late at night). If this becomes a problem, switching to `'America/Sao_Paulo'` is a one-line index recreate.
2. **`tests/rls.test.ts` insert payload.** The new test must insert a row with at least `user_id` (RLS check) and `measured_at` (NOT NULL with default). Since all other columns are nullable, a minimal insert is fine. Flagging so the Implementer knows the bar is low.
