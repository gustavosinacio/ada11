# Review v1 — 2026-05-20_0127_import-strong-csv

Reviewing: the diff for the implementation against `design-v1.md`.

## Diff scope
- Diff command: `git diff 15fab51..HEAD` (baseline recorded in `state.md`).
- Files changed: 6 (1 new migration, 1 schema, 1 types, 1 new script, 1 package.json, 1 docs).
- Lines: ~+500 / -2 (script + migration dominate).

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| Migration adds `source text` to `sessions` and `exercises` with CHECK + partial index | yes | `supabase/migrations/0006_add_source_flag.sql` lines 18-37 confirm. |
| Drizzle schema mirrors the migration | yes | `src/db/schema.ts` adds `source: text("source")` on both tables (nullable). |
| Hand-written PostgREST types updated | yes | `src/db/types.ts` `ExerciseRow` and `SessionRow` add `source: string \| null`. |
| MAJ-1: count-based partial-failure recovery | yes | `scripts/import-strong.ts` `importCommand` Phase 3 fetches existing sessions + set counts; Phase 4 deletes partial sessions before reinsert. |
| MAJ-2: zero-set session skip | yes | `importCommand` Phase 2 filters `groups` deleting entries where `sets.length === 0` before dedup. |
| MIN-2: TZ via `date-fns-tz` | yes | `parseStrongDateToUtc` uses `fromZonedTime(iso, "America/Sao_Paulo")`. Host TZ irrelevant. |
| MIN-3: duration clamp to 6h | yes | `parseDurationSec` returns `Math.min(total, MAX_DURATION_SEC)` with `MAX_DURATION_SEC = 6*60*60`. |
| MIN-4: drop `confidence`, keep `fuzzy_score` | yes | Mapping CSV uses 5 columns: `strong_name, action, ada11_exercise_id, ada11_exercise_name, fuzzy_score`. |
| Quality gates green | yes | typecheck 0 errors; lint 0 errors (1 pre-existing); 51/51 unit; web export builds. |

All claims grounded.

## Issues

### Blockers
- *(none)*

### Majors
- *(none)*

### Minors
- **[MIN-1]** `scripts/import-strong.ts:resolveUserId` uses `auth.admin.listUsers()` without paginating. For personal use this is fine (≤50 users in the project). If the Supabase project ever grows past 50 users, an unmatched email would silently fail. Acceptable as-is given the project's solo-dev posture, but flag in `retro.md` as future maintenance.
- **[MIN-2]** `scripts/import-strong.ts:parseStrongDateToUtc` uses `s.replace(" ", "T")` to build the ISO-ish string. If Strong ever exports dates without seconds (e.g. `"2019-11-08 06:39"`), this still parses but coverage is uncertain. Current export has full `HH:mm:ss` everywhere — non-issue today. Note in retro.
- **[MIN-3]** The CHECK constraint in migration 0006 lists only `'strong'` as an allowed non-null value. When a future source is added, the constraint must be DROPped and re-CREATEd in a new migration. Document the pattern in `docs/decisions.md` (next to Decision 9 about the cache buster) so future migrations follow it without surprise. Minor follow-up.
- **[MIN-4]** `scripts/import-strong.ts:analyzeCommand` writes `strong-mapping.csv` to the same directory as the CSV input — that directory is the user's iCloud Drive in the documented usage. Writing to iCloud generally works but is subject to sync conflicts if the file is open elsewhere. Acceptable for the one-time-ish flow; mention in `retro.md`.

## Security checklist
- [x] **RLS**: existing policies on `sessions`, `sets`, `exercises` gate on `auth.uid() = user_id`. The new `source` column is additive — no policy change needed. CHECK constraints sit at column-level, applied to inserts regardless of who calls them.
- [x] **Secrets**: `SUPABASE_SERVICE_ROLE_KEY` only appears in `scripts/import-strong.ts` (Node-only, never bundled). Verified by grep — no service-role token referenced in `src/`, `app/`, or `components/`.
- [x] **Raw SQL via `rpc`**: the script does not call `rpc()`. All inserts are PostgREST-typed; no string concatenation of user input.
- [x] **EXPO_PUBLIC_*** env vars: unchanged; nothing new exposed to the client bundle.

## Style / convention checklist
- [x] No new `any` types.
- [x] No new `// @ts-ignore`.
- [x] Comments narrate *why* (e.g. "clamped to MAX_DURATION_SEC because Strong sometimes leaves workouts open for days"), not *what*.
- [x] Imports follow project style — Node built-ins (`node:fs`, `node:path`) first, then third-party.
- [x] New files placed correctly: migration under `supabase/migrations/`, script under `scripts/`.

## Decision

**pass** — 0 blockers, 0 majors, 4 minors (none of which block). Implementation matches design + addresses all validator-flagged majors and minors.

Recommendation: invoke Tester.
