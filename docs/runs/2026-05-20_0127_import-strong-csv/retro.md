# Retro — 2026-05-20_0127_import-strong-csv

> First feature pipeline run on this conversation that hit real-execution bugs, not just static-gate or design-review bugs. Worth examining what the existing pipeline caught vs missed.

## What worked

- **Discovery sampling of the CSV up front.** Awk-counting 156 unique exercise names, sampling pathological durations ("143h 49min"), and noticing quoted-comma fields all surfaced as Discovery findings — Designer baked clamping, parser-with-quote-support, and TZ handling into the design from the start.
- **Validator's MAJ-1 (partial-failure recovery)** turned out to be the single most important design decision. Three of the four real-run bugs caused PARTIAL state in the DB; the count-based dedup let every re-run converge instead of accumulating duplicates.
- **Validator's MAJ-2 (zero-set session skip)** wasn't activated in this dataset but was correct as a guardrail — without it, sessions whose only exercise was dropped would leave empty session rows.
- **Cross-validation via dry-run after every script change** caught issues quickly (e.g. the create-new undercount, then the false 250-partial).
- **Out-of-scope discipline.** Many adjacent ideas surfaced (UI badge, soft-delete behavior, cache buster policy follow-up) and went to `docs/features.md` instead of bloating this run.

## What was friction

### Static gates passed but real execution failed
Four distinct bugs caught only by live IO:

| Bug | Class | Why static gates missed it |
|---|---|---|
| Timestamp `Date.toISOString()` vs PostgREST `+00:00` mismatch | API serialization | TS types said `string`; no schema/contract test for the round-trip format |
| `.delete().in("id", 642_uuids)` URL too long | HTTP / PostgREST | TS happy; no integration test exercises bulk operations at realistic scale |
| Phase 1 not idempotent (would insert 96 duplicate exercises on re-run) | Behavior across invocations | A unit test in vitest could have asserted "running analyze twice creates 96 exercises once, not 192", but none existed |
| `.select().in()` clipped to 1000 rows silently | Supabase default | Not documented in our docs; Supabase JS doesn't warn |

**Lesson**: for IO-heavy / external-service scripts, static gates are insufficient. The Tester step should include either (a) a live smoke against a small fixture export, or (b) a real-run with a `--limit-N` flag that processes a subset. Both would have caught at least 3 of these.

### User's workflow vs script's assumptions
- `tsx: command not found` (commit `4d52375`) — followed the project's other-scripts convention of `npx tsx` over assuming a globally installed `tsx`.
- `.env.local` not sourced (commit `6fed145`) — script auto-loads now via dotenv. ADMIN_EMAIL was undocumented in `.env.example` — now is.
- The `analyze` command silently overwrites a curated mapping file. Worth a follow-up: refuse to overwrite without `--force`, or merge with existing edits.

### Dry-run was misleading
- First dry-run undercounted (only `map` rows counted; create-new rows skipped). Commit `f7b0835` assigns synthetic placeholder IDs in dry-run mode to mirror real-run grouping. Required for dry-run to be a useful pre-flight check.

### Mapping curation pendulum
- User went through multiple manual curation passes. The `analyze` command being destructive (overwrites existing mapping CSV with fresh fuzzy-only suggestions) cost the user a round of work. Two ways forward:
  - **Refuse overwrite** unless `--force` is passed.
  - **Merge mode**: load existing mapping, only overwrite rows that don't exist yet.
  Defer to the next iteration of the script.

## Prompt / schema adjustments to fold back

- **`docs/playbook.md`** — add a note in the Tester role contract: for IO-heavy scripts (anything that hits a real external service in bulk), prefer a live run on a fixture rather than relying on static gates alone.
- **`fix-designer.md` / `designer.md`** — when designing API-talking code, require explicit acknowledgment of the API's bulk-operation limits (URL length, rate limits, response row caps). Could be a sub-bullet under "Riscos".
- **`scripts/import-strong.ts` follow-ups** (out of scope for this run):
  - Refuse to overwrite a curated mapping file unless `--force`.
  - Add `--limit-N` flag for partial test runs against the real DB.
  - Add a retry wrapper for transient network errors (one of the runs hit ETIMEDOUT mid-batch).

## Was the pipeline overhead worth it for this feature?

**Yes.** The pipeline-imposed Discovery and Validation steps caught the dominant design decisions correctly upfront (MAJ-1, MAJ-2, TZ handling, duration clamp, papaparse for quoted commas). Without them, the import would have hit even more bugs in production.

But the run also shows where the pipeline has a coverage gap: **static gates that pass do not guarantee live execution succeeds for IO-heavy code.** The Implementer's existing rule "typecheck + lint + unit + build" is necessary but not sufficient. A new rule could be: "for scripts that talk to a real external service in bulk, run a smoke against the actual service before reporting done."

## Action items for the playbook

- [ ] Update `docs/playbook.md` Tester role: live smoke for IO-heavy / bulk-operation code, not just static gates.
- [ ] Update `.claude/agents/designer.md` and `.claude/agents/fix-designer.md`: under Riscos, require listing API bulk-operation limits and how the design handles them.
- [ ] Update `.claude/agents/implementer.md`: add "for IO-heavy scripts, run a limited live smoke before reporting done" as a quality bar bullet.
- [ ] Open follow-up issue / feature in `docs/features.md`: `import:strong` analyze should refuse to overwrite a curated mapping CSV.

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-20_0127_import-strong-csv/` on 2026-05-20 16:15.
