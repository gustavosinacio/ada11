# Retro — 2026-05-21_2330_strong-import-setnumber

## Outcome

- **Bug**: Strong CSV importer's `parseInt("Ordem da série") ?? 1` fallback corrupted set_number values for any row Strong exported with non-numeric markers ("D" dropset, "A" alternate, "F" failure). Side-effect on the in-app UI: history detail / "Anterior" / progress page ordering scrambled within affected groups.
- **Pipeline result**: **shipped** — but as a re-scoped run: importer code deleted (user's pragmatic call) instead of fixed, backfill done via CSV-aware Node script, partial unique index added at DB layer.
- **Final commit**: pending (this run is the third in tonight's session; not yet committed at retro-write time).

## Metrics

| Metric | Value |
|---|---|
| Bug reproduces post-fix? | no (0 duplicate `(session, exercise, set_number)` groups; visual confirmation pending user) |
| Bugs found post-merge (7 days) | tbd |
| Human interventions during run | 3 (CSV vs SQL choice, "delete importer" pivot, location of CSV file) |
| Implement ↔ Regression rounds | 1 (single pass; the dry-run discoveries forced two re-pivots during fix-plan, not after) |
| Diagnose redirects | 0 (initial diagnosis stayed correct; only the SCOPE multiplied 24× when the windowed estimate was generalised) |
| Wall-clock duration | ~60 min (23:30 → 00:30 BRT) |
| Token cost | n/a |
| Rows affected in prod | 7,933 row updates + 1 manual fix for the bonus native dup |
| Migrations applied | 1 (`0008_sets_unique_set_number.sql`) |

## What worked

- **Read-only diagnostic first.** `debug-strong-setnumber.ts` (now deleted) revealed the scope was 24× larger than the initial estimate before any write was attempted. Refused-to-write until the picture was complete.
- **Dry-run + sanity assertion.** The backfill script ran in dry-run by default and refused to apply when simulated post-state had any collisions. Caught the missing fingerprint matches before any DB row moved.
- **Fingerprint matching for renamed exercises.** 11 user-renamed Strong exercises auto-resolved by matching the multiset of `(session_started_at, weight, reps)` between CSV and DB — no manual intervention required from the user.
- **The DB unique index doing its job as a smoke test.** Migration refused to land because of the native Leggiday dup → forced us to discover the second bug class (native quick-double-tap race) instead of shipping a half-clean state.
- **User's "delete the importer" pivot.** Saved ~1-2 hours of work that would have produced one-shot code maintenance burden. The unique index now protects all future write paths regardless of who wrote them.

## What was friction

- **The "46 rows" estimate was wrong by 24×.** The trailing-8-weeks slice from the prior run's diagnostic was used unchallenged. Future bug-fix runs: any stat that supports decision-making should be FULL-history or explicitly marked as windowed.
- **Numeric string format mismatches** (`"4.50"` CSV vs `"4.5"` DB) silently produced empty fingerprint matches. Took a re-run to spot. Canonicalisation needed for any equality compare across mixed string/number boundaries.
- **One-shot `update` script no-op'd silently.** The first `fix-leggiday-dup.ts` used a fabricated full UUID; `.eq("id", non-matching)` returns no rows but no error, and the success log lied. Required adding `.select()` + row-count assertion to catch.
- **Skill-tool registration for `pipeline-fix`** still not available in this env. Conductor ran the run inline per playbook §67-73, but the user explicitly asked mid-run "are you using the pipeline?" because no skill invocation was visible.
- **Backfill volume was high (7,933 rows) for a bug affecting 1,118 rows.** This is correct behaviour — clean groups containing dropsets needed full renumbering — but the high update count needed explanation in the regression report so the user didn't worry.

## Prompt / schema adjustments to fold back

- Reproducer prompt: when generalising a stat, explicitly note "windowed" vs "full-history" and surface both numbers if the cost is bounded.
- Fix Designer prompt: if the planned scope of writes is more than 2× the count of rows reported as "bad" in the diagnosis, call out why explicitly in the fix-plan.
- Add a "Fingerprint matching utility" pattern to `docs/playbook-fix.md` as a known approach for "stable matching when bare names fail" — used twice now (this run + the prior volume-math run).
- One-shot script convention: always `.select()` after `.update()`, assert row count > 0, log the explicit row count rather than "Renumbered X".

## Was the pipeline overhead worth it for this fix?

**Yes.** The pipeline structure (read-only diagnostic before any write, mandatory approval gate after Fix Designer, dry-run before apply, post-apply verification) caught at least three things that would have shipped silently otherwise: the 24× scope underestimate, the format-mismatch fingerprint failure, and the bonus native dup. A direct "edit importer, run SQL, deploy" approach would have left at least one of those un-noticed.

## Action items for the playbook

- [ ] Document "windowed vs full-history" disclaimer convention in the Reproducer template.
- [ ] Add the fingerprint-matching utility pattern to a "common techniques" section of `docs/playbook-fix.md`.
- [ ] Update the one-shot script convention: `update` + `select` + row-count assert.
- [ ] (Cross-run) Investigate why `pipeline-fix` skill isn't registered in the Skill tool's available list, since the project's `.claude/skills/pipeline-fix/SKILL.md` does exist.

## Archive

- Archived to vault: pending (Conductor archives after commit).
