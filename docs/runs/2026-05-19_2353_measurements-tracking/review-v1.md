# Review v1 — 2026-05-19_2353_measurements-tracking

Reviewing: the diff for the implementation against `design-v2.md`.

## Diff scope

- Diff command: `git diff 43a19995b8a9fc3f116bb3c10979c339c6612dc4...HEAD`
- Files changed: 11 new + 8 edited (= 19) in this feature's scope.
- Lines (this feature only): ~+960 / -8 (excluding unrelated `dark-mode-icon-contrast` doc files).
- Quality gates re-run: `npm run typecheck` clean; `npm run lint` 0 errors / 1 pre-existing warning; `npm run test:unit` 44/44.

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| Migration `0005_measurements.sql` runs in correct order (weight_unit CHECK → length_unit ADD → length_unit CHECK → table → indexes → RLS → trigger) | yes | `supabase/migrations/0005_measurements.sql:24-96` matches design step-for-step. |
| `seed_new_user()` NOT modified (MAJ-1 Path A) | yes | No edits to `0001_rls_and_seed.sql` or `0004_exercise_muscles_array.sql`; column default `'cm'` carries new signups (`0005:31-32`). |
| UNIQUE partial index on `(user_id, date(measured_at AT TIME ZONE 'UTC')) WHERE deleted_at IS NULL` | yes | `0005:68-70`. |
| Composite index plain ASC `(user_id, measured_at)` | yes | `0005:62-63`; matches `sessions_user_started_idx` precedent. |
| 4 RLS policies + `enable row level security`, all gated on `auth.uid() = user_id` | yes | `0005:74-90`; mirror policies in `0001` shape. |
| `touch_updated_at` trigger applied to new table | yes | `0005:93-96`. |
| Drizzle `lengthUnit` column + `measurementEntries` table with composite index | yes | `src/db/schema.ts:38, 173-209`. |
| `LengthUnit`, `MeasurementEntry(Row)`, numerics typed as `string \| null` | yes | `src/db/types.ts:33, 127-146`. |
| `cmToIn` / `inToCm` / `formatLength` / `parseLengthToCm` (mirror kg quartet) | yes | `src/utils/units.ts:54-75`; `CM_PER_IN = 2.54` (`:4`). |
| Reads filter `.is("deleted_at", null)` | yes | `src/api/measurements.ts:104, 115`. |
| `createMeasurement` / `updateMeasurement` discriminate `code='23505'` + `measurement_entries_user_day_idx` and throw typed `DuplicateMeasurementDateError` with `existingDateIso` derived from input | yes | `src/api/measurements.ts:33-58, 134-138, 153-156`. JSDoc carries MIN-2026.05-5 warning. |
| Hook KEYS = `["measurements"]` only; no cross-domain invalidation | yes | `src/hooks/use-measurements.ts:12-15`; grep confirms zero references to `["stats"]/["sessions"]/["sets"]` in the new code, and zero references to `["measurements"]` in workout hooks. |
| `rowToFormValues` adapter co-located in `measurements-form.ts` | yes | `src/utils/measurements-form.ts:228-247`. |
| Section header className `mt-4 mb-2 text-sm font-medium uppercase text-gray-500` on sections 2-6 | yes | `app/(app)/measurements/new.tsx:25-26, 132, 165, 228, 261, 294`; same in `[id].tsx:38-39, 198, 230, 292, 324, 356`. |
| Tab `measurements` placed between `history` and `profile`, icon `Ruler` | yes | `app/(app)/_layout.tsx:6, 42-48`; resulting order Workout / Routines / Exercises / History / Measurements / Profile. |
| Profile length-unit row mirrors weight-unit row's visual treatment | yes | `app/(app)/profile.tsx:78-119`; same bordered card, separated by `border-b border-gray-200 dark:border-gray-800`. |
| `isDirty`-gated save + `confirmDelete({title, message: "This entry will be hidden from your history."})` | yes | `[id].tsx:106-119, 408`. |
| Duplicate-date banner + "Open existing entry" CTA + stale-cache fallback (refetch + inline notice) | yes | `new.tsx:81-104, 310-330`; `[id].tsx:121-146, 372-393`. Edit-screen lookup filters out current `id`. |
| `tests/rls.test.ts` extended with `measurement_entries` block | yes | `tests/rls.test.ts:85-130`. Minimal payload `(user_id, measured_at, weight_kg)`. |
| `tests/seed-and-auth.test.ts` asserts `length_unit === 'cm'` | yes | `tests/seed-and-auth.test.ts:45-50`. |
| `tests/unit/measurements-units.test.ts` covers round-trip + edge cases | yes | 11 tests; round-trip, known values, zero, null/undefined, comma decimal, NaN, conversion. |
| No new `any`; no new `// @ts-ignore` | yes | grep returns zero hits in all new/edited files. |
| No service-role-key or new `EXPO_PUBLIC_*` in client code | yes | grep clean. |
| No raw `.rpc()` calls | yes | grep clean. |

## Issues

### Blockers
None.

### Majors

- **[MAJ-1]** `src/utils/measurements-form.ts:123-127` (and the screens that call it, `app/(app)/measurements/new.tsx:49-79` + `app/(app)/measurements/[id].tsx:72-103`): the date-input regex `^\d{4}-\d{2}-\d{2}$` accepts impossible dates such as `2026-13-99` or `2026-02-30`. `parse(value, "yyyy-MM-dd", new Date())` returns an `Invalid Date` for these, and the immediate `.toISOString()` call throws `RangeError: Invalid time value`. The submit handler only catches `z.ZodError` and `DuplicateMeasurementDateError`, so the RangeError propagates out of `handleSubmit` — the user sees a hard crash / red-screen instead of an inline "Invalid date" error against the Date field. **Fix**: in `buildSubmitPayload`, after `parse(...)`, check `if (Number.isNaN(parsed.getTime())) throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["measuredAt"], message: "Invalid date" }])` before calling `.toISOString()`. Alternatively, tighten the regex to a calendar-aware check inside the schema using `z.string().refine(...)`. Either way the failure mode becomes an inline field error consistent with the rest of the form.

### Minors

- **[MIN-1]** `src/hooks/use-measurements.ts:26-27`: `useMeasurement(id)` uses `id ? KEYS.detail(id) : KEYS.all` as the queryKey when `id` is undefined. Combined with `enabled: Boolean(id)` the query never runs, but the observer still binds to the umbrella `["measurements"]` slot, sharing it with `useMeasurements()` which has a different `queryFn`. In practice Expo Router guarantees `id` for `[id].tsx` so the branch never triggers, but the fallback is a code smell — two observers should not share a key with different fetchers. **Fix**: use a sentinel detail key like `["measurements", "__pending"]` or simply leave the queryKey as `KEYS.detail(id ?? "")` since the query is disabled anyway.

- **[MIN-2]** `src/utils/measurements-form.ts:129-148`: non-numeric input in a metric field (e.g. user types `"abcd"` in Weight) is silently coerced to `null` by `parseWeightToKg` / `parseLengthToCm` / `parseOptionalDecimal` returning `null` on `NaN`. The field is dropped without an inline error. If the user typed garbage in only some fields the entry saves with those fields nulled; if all fields are garbage they get the `"Log at least one measurement"` error on `weightKg` (wrong field for a parsing problem). **Fix**: distinguish "empty" from "unparseable" — when the trimmed string is non-empty but `parseFloat` is `NaN`, push a per-field issue `{path: key, message: "Enter a number"}` into the same issues array used for range checks.

- **[MIN-3]** `src/components/measurement-list-item.tsx:48-52`: `try { format(parseISO(entry.measured_at), ...) } catch { dateLabel = entry.measured_at.slice(0, 10) }` is defensive coding around a server-controlled ISO string. The catch never fires in practice and the fallback masks a future regression (e.g. PostgREST changing the format). **Fix**: drop the try/catch — let it surface if the server ever returns malformed data.

- **[MIN-4]** `src/utils/units.ts:74` (`parseLengthToCm`) and `:22` (`parseWeightToKg`): both functions skip the `.trim()` that `parseOptionalDecimal` (`src/utils/measurements-form.ts:79`) applies. Inputs with leading/trailing whitespace parse correctly via `parseFloat` (which trims internally), but mixed-with-letters inputs like `"91.4 cm"` parse to `91.4` and silently pass through. Minor inconsistency. **Fix**: trim inside the parsers for symmetry, or document that `parseFloat`'s permissive behavior is intentional.

- **[MIN-5]** `app/(app)/measurements/new.tsx:35-37`: two pieces of related local state (`duplicateError`, `lookupNotice`) reset together at the top of every submit (`:50-51`) and are tightly coupled. Could be collapsed into one `duplicateState` reducer, but it's a readability nit. **Fix**: optional consolidation; OK as-is.

## Security checklist

- [x] RLS: `measurement_entries` has `enable row level security` + 4 policies gated on `auth.uid() = user_id` (`0005_measurements.sql:74-90`). All new `.from("measurement_entries")` calls land on this RLS-protected table. The new RLS regression test (`tests/rls.test.ts:85-130`) gates B's read/update/delete.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` or other service-role token referenced in any new code under `app/` or `src/`. Grep clean.
- [x] No raw SQL via `.rpc()` introduced. Grep clean.
- [x] No new `EXPO_PUBLIC_*` env vars; the new code uses the existing `~/lib/supabase` client only.

## Style / convention checklist

- [x] No new `any`. Grep clean across all 19 changed/new files.
- [x] No new `// @ts-ignore`. Grep clean.
- [x] Comments narrate *why*, not *what*. Spot-checked the migration header, the Drizzle-index commentary in `schema.ts`, the JSDoc on `DuplicateMeasurementDateError` — all justify decisions.
- [x] Imports follow project style — package imports first, then `~/` aliased project imports.
- [x] New files placed in conventional folders: `src/api/`, `src/hooks/`, `src/utils/`, `src/components/`, `app/(app)/measurements/`, `supabase/migrations/`, `tests/unit/`.

## Decision

**pass**

Reasoning:
- 0 blockers, 1 major (MAJ-1: invalid-date RangeError crash on submit), 5 minors. The decision rule (0 blockers, ≤1 major → pass) is satisfied.
- MAJ-1 should be fixed before shipping but is not a release blocker on its own — failure mode is local to the Measurements form and the path requires user input of an impossible date. Flag for the Tester to confirm whether it surfaces as a noticeable crash on web/native; if so the Implementer should land the one-line `isNaN(parsed.getTime())` guard as follow-up.
- All checklist items pass: RLS gate on the new table, four policies, RLS test extension, cache namespace isolation in both directions, no `any` / `@ts-ignore`, no service-role-key in client code, no new EXPO_PUBLIC vars, no raw RPC. Implementer's `done` claim holds up against the diff.
- The five minors are quality polish, not correctness issues. Recommend tracking but not gating.

Note for the Tester: try submitting an impossible-but-regex-passing date like `2026-13-99` or `2026-02-30` in `new.tsx` / `[id].tsx` to confirm the crash signature. Other date-edge cases like `2026-02-29` (a non-leap year — 2026 is not a leap year) should produce the same RangeError.
