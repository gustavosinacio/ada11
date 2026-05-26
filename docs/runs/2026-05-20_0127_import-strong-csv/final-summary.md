# Final summary — 2026-05-20_0127_import-strong-csv

## Outcome
- **Feature**: CLI importer for Strong-app CSV exports, with fuzzy exercise reconciliation, count-based partial-failure recovery, BRT→UTC date normalization, cardio drop, and `source` flag on imported rows.
- **Pipeline result**: shipped + executed end-to-end. 7 years of workout history (642 sessions / 11,607 sets / 96 new exercises) imported into the production account.
- **Final commit**: `49aac97`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (data in DB, final dry-run = steady state) — pending user visual on app |
| Human interventions during run | 2 (approval after Validator; approval to commit + db:push + import) + curation passes on mapping CSV |
| Total round-trips (sum of all loops) | D↔V: 1 (no respins), I↔R: 1 (no respins). Real-run discoveries (4 bugs found post-merge but pre-import-completion) folded inline. |
| Design ↔ Validate rounds | 1 |
| Implement ↔ Review rounds | 1 |
| Implement ↔ Test rounds | 1 (with real-run hardening — 4 bugs caught only by live execution, not by static gates) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | start (01:27) → end (16:15) ≈ ~14h elapsed (user-side curation of mapping took most of that time; net Conductor work much shorter) |
| Token cost | n/a |

## Files delivered
- `supabase/migrations/0006_add_source_flag.sql` (new) — applied to prod.
- `src/db/schema.ts` (edited) — source column on sessions + exercises.
- `src/db/types.ts` (edited) — source field on row types.
- `scripts/import-strong.ts` (new, ~500 lines after hardening) — full importer.
- `package.json` (edited) — papaparse + @types/papaparse + date-fns-tz devDeps; `import:strong` alias.
- `docs/development.md` (edited) — "Importing from Strong" section.
- `.env.example` (edited) — ADMIN_EMAIL documented.

## Commit chain
- `1fb33ac` feat(import): Strong CSV importer + source flag on sessions/exercises
- `4d52375` fix(scripts): use npx tsx for import:strong alias
- `6fed145` fix(import): auto-load .env.local + helpful ADMIN_EMAIL error
- `f7b0835` fix(import): dry-run was undercounting create-new sets/sessions
- `49aac97` fix(import): real-run hardening — 4 bugs found during actual run

## Mapping curation summary
- 156 unique Strong exercise names.
- After user curation: 49 → 59 maps (10 unified to existing library), 96 create-new.
- 0 drops (user chose to import everything; cleanup of cardio/junk exercises deferred to post-import via app soft-delete).

## Out of scope (open follow-ups)
- **UI badge** "Imported from Strong" — added to `docs/features.md`? (Implicit pending — `source` column is in place but no consumer reads it yet.)
- **Soft-delete behavior** for exercises with sets — see `docs/features.md` entry added in this conversation.
- **Cardio modeling** — deferred per Decision 8.
- **Strong English-header CSV** — `--lang` flag not implemented (no current need).
- **Per-row external_id** — explicitly rejected; `source` flag chosen instead.
- **API-edge Zod validation** for Supabase responses — would catch the TS-type-vs-runtime divergence class (see Decision 9 + the muscles run for context).

## Next steps for the owner
- Visually verify in the app (see `regression-report.md` manual checklist).
- Cleanup orphan / unwanted exercises via the app's exercise list (soft-delete). Note: per the just-added features.md entry, soft-delete currently hides the exercise from history visualization too — that inconsistency is a separate planned fix.

## Bugs found post-merge (backfill within 7 days)
- (none yet — owner updates this section as bugs surface)

## Notes (backfill)
- This run set a new pattern: the real-run discovery surfaced 4 bugs that static gates could not have caught (PostgREST URL limits, Supabase pagination defaults, timestamp serialization mismatch, idempotency requirement for re-runs). Worth a retro action item to improve real-execution coverage in the Tester step for IO-heavy scripts.

## Archive
- Will be archived to vault on completion.
