# Implementation — 2026-05-20_0127_import-strong-csv

Based on: `design-v1.md` and `validation-v1.md` (go decision; 2 majors + 4 minors to address). Baseline commit: `15fab51`.

## Files changed

- `supabase/migrations/0006_add_source_flag.sql` (new) — adds nullable `source text` to `sessions` and `exercises`; CHECK constraint `source IN (null, 'strong')`; partial index `sessions(user_id, source) WHERE source IS NOT NULL`.
- `src/db/schema.ts` (edited) — adds `source: text("source")` to both `exercises` and `sessions` Drizzle tables.
- `src/db/types.ts` (edited) — adds `source: string | null` to `ExerciseRow` and `SessionRow` hand-written PostgREST types.
- `scripts/import-strong.ts` (new) — ~430-line CLI importer with `analyze` and `import` subcommands, Papa CSV parser, BRT→UTC via `date-fns-tz`, Jaccard token-overlap fuzzy match, batched bulk inserts.
- `package.json` (edited) — adds `papaparse`, `@types/papaparse`, `date-fns-tz` as devDependencies; adds `"import:strong": "tsx scripts/import-strong.ts"` script alias.
- `docs/development.md` (edited) — "Importing from Strong" section between Schema changes and Auth setup.

## Deviations from design

- **MAJ-1 (partial-failure recovery)**: implemented strategy (a) per validator's suggestion. After existing-sessions fetch, the script also queries set counts per existing session id (chunked to 1000 ids per `.in()` call for safety). For each session candidate where the natural key already exists, the script compares `existing_count` vs `candidate.sets.length`:
  - equal → skip (already complete);
  - different → delete the existing session (cascades to sets via FK `onDelete: cascade`) and reinsert. This preserves idempotency without needing per-row external_id.
- **MAJ-2 (zero-set sessions)**: implemented. After mapping is applied, the script filters `groups` deleting any session group whose `.sets.length === 0`. Console output reports how many were skipped for transparency.
- **MIN-1 (typecheck after schema change)**: confirmed. `tsc --noEmit` passes with the new nullable `source` column on both `SessionRow` and `ExerciseRow`; existing code that doesn't read `.source` is unaffected (null type widens silently).
- **MIN-2 (TZ via `date-fns-tz`)**: implemented. `parseStrongDateToUtc` calls `fromZonedTime("YYYY-MM-DDTHH:mm:ss", "America/Sao_Paulo")` — host-TZ-independent.
- **MIN-3 (duration clamp)**: implemented. `parseDurationSec` clamps `total = h*3600 + m*60 + s` to `MAX_DURATION_SEC = 6 * 60 * 60` before returning.
- **MIN-4 (drop qualitative confidence; keep `fuzzy_score`)**: implemented. Mapping CSV schema is `strong_name, action, ada11_exercise_id, ada11_exercise_name, fuzzy_score` (no `confidence` field). Single threshold (`FUZZY_LOW = 0.5`): ≥0.5 → suggest `map`; <0.5 → suggest `create-new`. Drop `FUZZY_HIGH` distinction — the user reviews the file regardless.

## Soft callbacks made (during this implementation pass)
- None.

## Quality gates
- [x] `npm run typecheck` passed.
- [x] `npm run lint` passed (0 errors; 1 pre-existing warning in `router.d.ts` unrelated to this change). Two transient `@typescript-eslint/array-type` warnings in `scripts/import-strong.ts` were fixed by switching `Array<{...}>` to `{...}[]`.
- [x] Relevant unit tests pass: `npm run test:unit` → 51/51.
- [x] `npx expo export --platform web` passed — all routes built (including the user's measurements work).
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` (the script's `console.log` calls are intentional progress/UX output for a CLI).

## Notes for Reviewer / Tester

- The script needs `EXPO_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_EMAIL` in env. Source `.env.local` before invoking via `set -a && . ./.env.local && set +a`.
- The migration `0006_add_source_flag.sql` has NOT been applied to the live database by this run. The user must run `npm run db:push` before running the import script; without it, every insert containing `source: 'strong'` will fail the CHECK constraint that doesn't yet exist (actually it will fail on `source` column not existing).
- The `analyze` step only SELECTs from `exercises`; it does not mutate. Safe to run before applying the migration **as long as** the `exercises.source` column being absent is OK — but the script tries to select only `id, name`, so it's fine.
- The `import` step writes to `sessions`, `sets`, and `exercises`. Migration must be applied first.
- Suggested user-facing test order:
  1. `npm run db:push` — apply migration.
  2. `npm run import:strong -- analyze "<csv-path>"` — produces `strong-mapping.csv`.
  3. Review `strong-mapping.csv` in editor.
  4. `npm run import:strong -- import "<csv-path>" "<mapping-path>" --dry-run` — confirm counts.
  5. Drop `--dry-run` to actually import.
  6. Sanity-check in the app: open History, see imported sessions.

## Out of scope (confirmed)

- UI badge "Imported from Strong" — deferred follow-up; this run lays the schema groundwork (`source` column).
- Backfill `source = 'native'` on existing rows — null = native by convention.
- Strong English-header CSV support — `--lang` flag not added.
- Cardio metric modeling — Decision 8 still defers.
