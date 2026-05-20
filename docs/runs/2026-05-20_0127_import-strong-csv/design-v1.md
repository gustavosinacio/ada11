# Design v1 — 2026-05-20_0127_import-strong-csv

## Goal (1 sentence)
A re-runnable CLI script that imports Strong-app CSV exports into the owner's ada11 Supabase account, with fuzzy exercise reconciliation, a user-reviewable mapping step, and a `source` flag on the resulting records so the UI can distinguish imported from native data later.

## Approach
The script runs in two passes. **Pass 1 (analyze)** parses the CSV, lists every unique exercise name, fuzzy-matches against the user's existing `exercises` library, and writes a **mapping file** (`<csv-dir>/strong-mapping.csv`) with one row per Strong exercise name: `strong_name, suggested_ada11_id, suggested_ada11_name, confidence, action`. The user reviews the mapping in their editor — accepting suggestions, correcting matches, or marking `action = create-new` for genuinely new lifts. **Pass 2 (import)** re-reads the CSV plus the reviewed mapping, groups rows by `(started_at, workout_name)` into sessions, dedupes against existing sessions in the database (natural-key check on `user_id + started_at + name`), creates any `create-new` exercises with `source = 'strong'`, and bulk-inserts sessions + sets in batches.

A small migration adds nullable `source: text` columns to `sessions` and `exercises`. `null` = native (default); `'strong'` = imported via this script. No backfill — existing rows stay null. The columns are independent of the import logic itself; future external sources (e.g. Hevy) reuse the convention with their own string.

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `supabase/migrations/0006_add_source_flag.sql` | new | `ALTER TABLE sessions ADD COLUMN source text; ALTER TABLE exercises ADD COLUMN source text;` plus a CHECK constraint allowing only `null` or known sources (initially `'strong'`). Index on `sessions(user_id, source)` for future filtering. |
| `src/db/schema.ts` | edited | Add `source: text("source")` (nullable) to `sessions` and `exercises` definitions. |
| `src/db/types.ts` | regen | Drizzle inferred types pick up `source: string \| null` on `SessionRow` and `ExerciseRow`. Run `npm run db:generate` or manually keep in sync per project convention. |
| `scripts/import-strong.ts` | new | The CLI entry. ~250-400 lines. Two subcommands: `analyze` (writes mapping CSV) and `import` (reads mapping + imports). Default no-arg runs analyze first, then prompts. |
| `package.json` | edited | Add `"import:strong": "tsx scripts/import-strong.ts"` under `scripts`. |
| `docs/development.md` | edited | Short section "Importing from Strong" describing the two-pass flow. |

## Contratos de I/O

### CLI surface
```
# Pass 1: emit mapping file next to the CSV
npm run import:strong -- analyze <csv-path>

# Pass 2: do the actual import using the (user-reviewed) mapping
npm run import:strong -- import <csv-path> <mapping-csv-path>

# Convenience: alias that runs analyze, opens the mapping for review, waits for confirmation, then imports.
npm run import:strong -- <csv-path>
```

Flags:
- `--user-id <uuid>` (default: looks up via `ADMIN_EMAIL` env)
- `--dry-run` (parses, dedups, mapping-resolves, but no DB writes)
- `--lang <pt|en>` (default `pt`; controls CSV header expectation)
- `--batch-size <N>` (default 500 rows per insert batch)

### Mapping CSV schema (`strong-mapping.csv`)
```
strong_name,action,ada11_exercise_id,ada11_exercise_name,confidence,fuzzy_score
"Bench Press (Barbell)",map,<uuid>,"Bench Press",0.96,high
"Lat Pulldown (Cable)",map,<uuid>,"Lat Pulldown",0.91,high
"Chest Fly (Cable 2nd floor)",create-new,,,low,0.42
"Elíptico",drop,,,-,-
```
Actions: `map` (use existing exercise), `create-new` (create new with name = strong_name, muscles=[]), `drop` (skip every row with this exercise — used for cardio leftovers).

### DB schema diff
```sql
ALTER TABLE sessions ADD COLUMN source text;
ALTER TABLE exercises ADD COLUMN source text;
ALTER TABLE sessions ADD CONSTRAINT sessions_source_valid
  CHECK (source IS NULL OR source IN ('strong'));
ALTER TABLE exercises ADD CONSTRAINT exercises_source_valid
  CHECK (source IS NULL OR source IN ('strong'));
CREATE INDEX sessions_user_source_idx ON sessions (user_id, source) WHERE source IS NOT NULL;
```

(CHECK constraint extends as future sources are added — a separate migration each time. Better than a free-text column with no validation.)

### Dedup natural key
```ts
// For each parsed session candidate before insert:
const existing = await supabase
  .from('sessions')
  .select('id')
  .eq('user_id', userId)
  .eq('started_at', candidate.started_at)
  .eq('name', candidate.name)
  .maybeSingle();
if (existing.data) skip; // session already imported
```

This is enough for re-run safety because Strong's `Data` is precise to the second, and two genuine workouts with identical name + identical second are vanishingly rare.

## Riscos
- **Data integrity**:
  - Service-role inserts bypass RLS. Script must set `user_id` correctly on every row. Mitigation: single `userId` variable resolved once at startup; all inserts derive from it.
  - Auto-created exercises with `muscles: []` will render with no subtitle (visual oddity but not a crash, since the muscles fix shipped today).
  - Dedup key `(user_id, started_at, name)` collisions are possible but extremely rare (two workouts at the same exact second with the same name). Acceptable.
- **UX regressions**:
  - Existing sessions/exercises gain a nullable `source` column. All queries continue to work (filter `is.null` if they want native-only later).
  - The new CHECK constraint is permissive (allows null OR 'strong'); won't reject existing data.
- **Platform**: script is Node-only; never bundles into the app. No mobile risk.
- **Performance**:
  - 12k sets / ~400 sessions / ~156 exercises is small. With batch size 500 and ~30ms per request, total ~30s.
  - The dedup query per candidate session is N round-trips. Optimization: pre-fetch all existing sessions for this user in one query and dedup in memory.
- **Re-run safety**:
  - Without per-row external_id, partial-failure recovery relies on idempotent inserts. Sessions dedup on natural key; sets dedup transitively (we only insert sets for newly-created sessions). If a session was created but its sets failed partway, re-run would skip the session (already exists) and orphan the partial sets. Mitigation: insert sessions and their sets in the same transaction (Supabase RPC or a single `.insert([])` with PostgREST nested resource? Not supported.) → Realistic mitigation: detect partial sessions (session exists but `sets.count = 0`) and either delete + reinsert or fill-in missing sets. Designer flags this as a **major risk** that the Implementer must address.

## Alternativas descartadas
1. **Per-row `external_id` instead of `source` flag** — explicitly rejected by user; they prefer a simple flag.
2. **In-app UI for import** — over-engineering for 1-3 lifetime executions.
3. **Direct SQL `COPY` via psql** — fastest but requires temp table + transform; harder to debug + no fuzzy matching mid-import.
4. **Auto-create all 156 exercises 1:1 without mapping step** — produces a polluted exercise library; user already chose fuzzy+review.
5. **Wipe and re-import on every run** — destructive; deletes any sessions the user logged natively on top of imported data.
6. **Store mapping inside the database** (e.g. `strong_exercise_aliases` table) — useful for repeat exports, but adds schema surface for an imperative process. CSV-as-mapping is simpler and editable.

## Out of scope
- **UI badge** "imported from Strong" on session header / exercise detail. Track as follow-up; trivial 1-line change in components once they read `source`.
- **Strong English-header CSV support** — keep `--lang pt` as the only working mode for v1. Detection logic adds complexity for zero current benefit (user's CSV is Portuguese).
- **Backfill `source = 'native'` for existing rows** — null-as-native is the convention.
- **Cardio metrics modeling** — Decision 8 still defers; cardio rows dropped per user choice.
- **Routine reconstruction from session names** — sessions get `.name` but `routine_id` stays null. The user can manually link if desired.

## Resposta a issues do Validator (none — this is v1)

## Confidence / Risk
- **Confiança**: ALTA — every mapping is verifiable, the schema delta is minimal, the CSV format is fully sampled and understood, and the precedent scripts in `scripts/` confirm the admin-client pattern works.
- **Risco**: MÉDIO — partial-failure recovery without per-row idempotency tokens is the genuine concern (see Riscos). Other risks are LOW.
