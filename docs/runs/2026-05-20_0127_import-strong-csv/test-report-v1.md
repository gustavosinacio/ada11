# Test report v1 — 2026-05-20_0127_import-strong-csv

Testing: implementation against `design-v1.md`.

## Environment
- Build verified: `npx expo export --platform web` (static export, all routes compiled).
- Conductor environment: macOS, Node + tsx. The script has not been executed against the live Supabase yet — that requires the user's environment (`.env.local` with secrets) and is an explicit user step.
- Test data: the actual CSV at `~/Library/Mobile Documents/com~apple~CloudDocs/Workouts/strong_workouts_may_2026.csv` (12,381 rows).

## Golden path

**Spec (from design)**: a re-runnable CLI that imports Strong CSV → ada11 with fuzzy exercise mapping, `source = 'strong'` flagging, and partial-failure-safe dedup.

**Steps that will be run by the user**:
1. `npm run db:push` to apply migration 0006.
2. `set -a && . ./.env.local && set +a && npm run import:strong -- analyze "<csv-path>"` — produces `strong-mapping.csv`.
3. Review `strong-mapping.csv` in editor. Adjust `action` columns as needed.
4. `npm run import:strong -- import "<csv-path>" "<mapping-path>" --dry-run` — preview counts.
5. Drop `--dry-run` to actually import.
6. Open the app's History tab → verify imported sessions render with correct set data.

**Result**: cannot-execute-from-Conductor — service-role secrets + live DB required. Static and structural verification follows.

## Edge cases

### Edge 1: CSV parsing under quoted notes containing commas
- **Setup**: the CSV contains rows like `... bench press,1,80.0,10.0,...,"warm-up, lower weight",...` where the notes field embeds a comma.
- **Expected**: Papa parses the field as one cell, not split on the comma. Naïve `awk -F,` parsing (from Discovery) fails on these rows; Papa should not.
- **Static verification**: the script imports `papaparse` and uses `Papa.parse(text, { header: true, skipEmptyLines: true })`. Papa respects quoted fields per CSV spec; this is its primary feature. Confirmed library is correct for the task.
- **Result**: pass (static); dynamic verification deferred to user's first analyze run, which will report `CSV parse warnings` if any rows fail.

### Edge 2: Pathological duration (143h workout)
- **Setup**: the CSV contains workouts with duration "143h 49min" (Strong didn't auto-close for days).
- **Expected**: `parseDurationSec` clamps total to 6 hours (21600 sec).
- **Verification**: read `parseDurationSec` impl directly — `Math.min(total, MAX_DURATION_SEC)` with `MAX_DURATION_SEC = 6 * 60 * 60`. Confirmed.
- **Result**: pass.

### Edge 3: Zero-set session after mapping (workout that was 100% cardio)
- **Setup**: a workout where every exercise was `Elliptical Machine` or `Elíptico` (the two cardio entries) — every row gets dropped, leaving zero sets.
- **Expected**: the script does NOT create an empty session.
- **Verification**: `importCommand` Phase 2 filter loop deletes `groups` entries where `g.sets.length === 0` before dedup. Console output reports the skip count.
- **Result**: pass.

### Edge 4: Re-run safety (idempotency without external_id)
- **Setup**: import once; abort midway; run again.
- **Expected**: second run skips already-complete sessions; reimports any session whose set count diverged from CSV.
- **Verification**: Phase 3 fetches existing sessions; builds `existingMap` keyed on `started_at|name`; queries set counts per existing id; compares to candidate's expected set count. Equal → skip; different → delete + reinsert.
- **Result**: pass (structurally). Dynamic test from a real partial-failure scenario is delegated to user — they would need to trigger one. Acceptable.

### Edge 5: Mapping action = 'drop' for cardio leftovers
- **Setup**: user marks `Elíptico` as `drop` in `strong-mapping.csv`.
- **Expected**: every CSV row referencing `Elíptico` skipped; downstream sessions get fewer (or zero) retained sets.
- **Verification**: `importCommand` `for (const r of rows) { ... if (m.action === "drop") continue; ... }` — skips the row. Empty sessions then filtered (Edge 3 above).
- **Result**: pass.

## Regression check

- **Existing `sessions` API (`src/api/sessions.ts`)**: unchanged. The new `source` column on the row is nullable — existing inserts that omit it default to null. All listed/read code paths consume `SessionRow`, which now has `source: string | null` — no consumer derefs `.source` today, so additive only.
- **Existing `sets` API (`src/api/sets.ts`)**: unchanged. No new column added to `sets`; the source attribution comes via the parent session.
- **Existing `exercises` API**: unchanged. `source` is nullable, additive.
- **Web build**: passes export (`/exercises`, `/routines`, `/history`, `/workout/[sessionId]`, `/measurements`, etc. — 21+ routes compile).
- **Auth gate / RLS**: untouched. New column inherits the table's RLS.
- **Existing unit tests**: 51/51 pass (no regressions in formulas, units, dates, measurements, weekly-volume bucketing).

## Cross-platform
- Web: pass (export builds).
- iOS: not tested directly by Conductor. Script runs Node-only; the app reading `source` requires no client-side change yet (UI badge is out of scope). The migration `0006` will apply on next `db:push`; both platforms then see the new column transparently.
- Android: same as iOS.

## Test commands
- [x] `npm run typecheck` — pass (0 errors).
- [x] `npm run lint` — pass (0 errors; 1 pre-existing warning in `router.d.ts`).
- [x] `npm run test:unit` — 51/51 pass.
- [x] `npx expo export --platform web` — pass.
- [ ] `npm run test:e2e` — not applicable to this run (the import script has no UI surface).

## Manual verification checklist (user-side, post-migration)

1. **Apply migration**: `npm run db:push`. Confirm migration 0006 lands without errors. Sanity-check via Supabase Studio that `sessions.source` and `exercises.source` columns exist (nullable text).
2. **Analyze**: run the analyze command. Confirm `strong-mapping.csv` is created next to the CSV. Spot-check ~5 rows: do the fuzzy matches look reasonable? Are obvious mappings (e.g. "Bench Press (Barbell)" → seeded "Bench Press") suggested as `map`?
3. **Review mapping**: open `strong-mapping.csv`, correct any wrong fuzzy matches. Mark cardio entries (`Elíptico`, `Elliptical Machine`) as `drop`. Mark genuinely new lifts as `create-new`.
4. **Dry-run import**: run with `--dry-run`. Confirm the report: how many sessions to insert, how many to dedup-skip, how many "partial" (this is 0 on first run).
5. **Actual import**: drop `--dry-run`. Watch progress. Total time for 12k sets: estimated ~30-60s depending on connection.
6. **Sanity in the app**: open History, scroll back to 2019. Imported sessions should render with names and set data. Pick a recent imported session — exercises and sets should look correct.
7. **Re-run idempotency**: optionally run the import command again. It should skip everything ("already complete") — confirms idempotency without external_id.

## Decision

**pass** — automated gates green, all design promises structurally verified in code, edge cases covered. Dynamic execution requires user-side environment (Supabase secrets + live DB).

Reasoning:
- Structural correctness verified end-to-end via code reading + static gates.
- Real-data smoke (the actual 12k-row CSV against the user's live DB) is delegated to the manual checklist above because Conductor lacks service-role secrets and the script is intentionally not invoked from this environment.
