# Discovery — 2026-05-20_0127_import-strong-csv

## Feature prompt
Import a Strong-app CSV export (~12,381 rows, ~7 years of history) into ada11. User answered 6 scoping questions (see `state.md`): kg, BRT, fuzzy+manual exercise mapping, drop cardio, CLI script, source-flag on records (no external_id).

## Scope summary
A reusable CLI import that ingests the Strong CSV, fuzzy-maps exercise names to the ada11 library, creates sessions + sets in batched inserts under the owner's Supabase user, and tags inserted rows with `source = 'strong'` so the UI can later show "imported" badges. New `scripts/import-strong.ts`, a small migration for `source` columns, and an optional UI badge (deferred to a follow-up).

## Affected files (verified)
- `src/db/schema.ts:106-125` — `sessions` table; need new `source: text("source")` column.
- `src/db/schema.ts:42-58` — `exercises` table; need new `source: text("source")` column (auto-created exercises during import get `'strong'`).
- `src/db/types.ts:?` — inferred `SessionRow` and `ExerciseRow` will need the new field reflected (Drizzle types should regenerate).
- `supabase/migrations/0005_measurements.sql` — last migration; next will be `0006_add_source_flag.sql`.
- `scripts/create-user.ts:1-43` — pattern for service-role admin scripts (read env from `.env.local`, `createClient(url, serviceRole, {auth:{persistSession:false}})`).
- `src/api/sessions.ts:38-60` — current `startSession` pattern (session insert with `started_at`, optional `name`, `notes`). Imports bypass this and insert directly.
- `src/api/sets.ts:33-69` — current `logSet` pattern. Imports bypass and bulk-insert.
- `package.json:6-21` — scripts block; add `import:strong`.

## CSV format details (verified from the file)
- Columns (header row, Portuguese): `Data, Nome do treino, Duração, Nome do exercício, Ordem da série, Peso, Reps, Distância, Segundos, Notas, Notas do treino, RPE`.
- Date range: 2019-11-08 → 2026-05-18 (~7 years).
- **156 unique exercise names**, mostly English ("Bench Press (Barbell)", "Lat Pulldown (Cable)"), with variants ("Chest Fly (Cable 2nd floor)" vs "Chest fly (Cable) 3rd floor") and one Portuguese ("Elíptico").
- **Duration format**: `"10min"`, `"1h"`, `"1h 23min"`, `"13h 39min"`, and pathological `"143h 49min"` (workouts where Strong didn't auto-close for days). Need a parser that copes with all + clamps absurd values.
- **Notes contain commas** → naive `awk -F,` parsing breaks (sample: a duration column reads ` bicepenis"` because of unbalanced quotes in a neighboring notes field). The script MUST use a proper CSV parser (e.g. `papaparse` or a small hand-rolled one with quoted-field support).
- **RPE** is mostly empty; when present, integers 1-10.
- **Cardio markers**: rows where `Distância > 0` OR `Segundos > 0`. To be DROPPED per user decision.
- **Workout grouping**: rows in the same `Data + Nome do treino` are one session. Same `Data` across multiple `Nome do treino`s would be unusual but the script should handle both (key on `Data + name`).

## Relevant conventions (verified by reading code)
- **Scripts**: `scripts/<name>.ts` invoked via `npx tsx`. Read secrets from `.env.local`. Use Supabase service-role client (`createClient(url, serviceRole, {auth:{persistSession:false}})`). See `scripts/create-user.ts`.
- **Migrations**: numbered sequentially. Hand-written SQL under `supabase/migrations/`. Schema.ts changes are paired with a matching migration.
- **Weight storage**: numeric(6,2) in kg internally; UI converts via `user_preferences.weight_unit`.
- **Timestamps**: `timestamp with time zone`, stored UTC.
- **RLS**: `auth.uid() = user_id` everywhere. Service-role bypasses RLS but the script must still insert with the correct `user_id`.
- **Soft delete**: `deleted_at IS NULL` filter in queries. Inserts default `deleted_at = null`.

## Constraints
- **Data**:
  - `sessions` requires `user_id`, `started_at` (with TZ). `ended_at` nullable.
  - `sets` requires `user_id`, `session_id`, `exercise_id`, `set_number`, `set_type`, `completed_at`. Imported sets → `set_type = 'working'`, `parent_set_id = null`. `set_number` per (session, exercise) — Strong's "Ordem da série" maps cleanly.
  - `exercises` requires `user_id`, `name`, `muscles` (default `'{}'`). Imported auto-created exercises start with empty muscles array; user fills in later if desired.
  - FK `sets.exercise_id` has `onDelete: restrict` — cannot delete an exercise that has sets pointing to it. Important for any re-import "wipe" strategy.
- **UI**: deferred. The UI badge for `source = 'strong'` is out of scope for this run (note as follow-up).
- **Platform**: script is Node, runs on macOS. No mobile concern.
- **Auth**: service-role key required. Script reads `.env.local`. User must run on a trusted machine.
- **Performance**: 12k rows. Supabase JS bulk insert tops out around 1k rows per request (PostgREST limit). Need batching.

## Existing precedents
- `scripts/create-user.ts` — service-role admin script pattern, env var validation, exit codes.
- `scripts/measurements.ts` (if exists) — recent feature import flow precedent (user added measurements feature).
- Drizzle schema + migration pairing: the muscles migration (`0004_exercise_muscles_array.sql`) and the measurements migration (`0005_measurements.sql`) demonstrate the convention.

## Unknowns (Designer must resolve OR escalate)
- **Idempotency without external_id**: user explicitly rejected per-record `external_id`. The script must still be safe to re-run with a partially-imported state. Strategy: rely on `(user_id, started_at, name)` natural key for sessions; check existence before insert. The Designer must specify this dedup logic.
- **Source flag scope**: `sessions.source` is unambiguous. Should `exercises.source` exist too? Argument for: distinguishes auto-created vs seeded vs user-created exercises. Argument against: more surface area. Designer should pick.
- **Mapping file location and format**: a generated CSV in `scripts/` or in user's iCloud? The script's UX matters. Designer to specify.
- **Default for unmatched exercises**: if fuzzy match fails AND mapping says "create new", what `muscles` value? Empty is safe but renders as "blank subtitle" in lists.
- **Strong CSV column header is in Portuguese for THIS export, but Strong supports English too**. Should the parser auto-detect, or require Portuguese only? Designer to decide (default: require explicit `--lang pt|en` flag, default `pt`).

## Out-of-scope flags
- **UI badge for imported sessions** — defer to follow-up.
- **Cardio import** — user explicitly drops; no schema work for cardio metrics.
- **Routine reconstruction from Strong workout names** — sessions get `name` but no `routine_id` (Strong doesn't have routines as first-class entities).
- **Personal records / progress charts re-calculation** — these are computed from sets on demand; no extra work needed.
