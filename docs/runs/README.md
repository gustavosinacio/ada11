# Pipeline runs

This folder holds the artifacts produced by the [multi-agent development pipeline](../playbook.md).

## Structure

```
docs/runs/
  README.md              # this file
  _template/             # copy this for each new run
  <run-id>/              # one folder per run, format: YYYY-MM-DD_HHmm_<slug>
    state.md             # live state of the run
    discovery.md         # Discovery agent output
    design-v1.md         # Designer output (v2, v3 ... if re-design rounds)
    validation-v1.md     # Validator output (matching version)
    implementation.md    # Implementer output
    review-v1.md         # Reviewer output (v2 if re-review)
    test-report-v1.md    # Tester output (v2 if re-test)
    questions.md         # only if Implementer soft-called back
    transcript.md        # append-only chronological log
    final-summary.md     # outcome + metrics
    retro.md             # post-run reflection (filled in by owner)
```

## Run-id format

`YYYY-MM-DD_HHmm_<slug>` in BRT (America/São_Paulo). Today is 2026-05-19. Slug is 2-4 kebab-case words describing the feature.

Example: `2026-05-19_1430_weekly-volume-stat`.

## Lifecycle

1. **Start** — copy `_template/` to a new run folder. Initialize `state.md` (prompt, baseline commit, timestamps, budgets).
2. **In progress** — the Conductor (main Claude Code session) routes between agents per `../playbook.md`. Every agent invocation writes a `transcript.md` entry. `state.md` updates after each agent return.
3. **End** — `final-summary.md` filled in. Run folder copied to the vault at `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/<run-id>/`.
4. **Retro** — owner reviews artifacts and writes `retro.md` with what worked, what to change, prompts to tighten.

## Why both repo and vault

- **Repo (`docs/runs/`)** — tied to the codebase. Diffs reference commit hashes that live in this repo. Useful for future agents to read prior runs while working in this checkout.
- **Vault (`$VAULT/AIground/multi-agent-pipeline/pipeline-runs/`)** — durable across machines via iCloud, wikilink-friendly for cross-run review, survives any `git clean` or branch operations.

The repo copy may eventually be pruned (e.g. `.gitignore` if commits get heavy); the vault is the durable record.

## Git policy

Run folders ARE committed by default — future agents reading the repo benefit from seeing prior runs (especially `retro.md` and `final-summary.md`). If repo size becomes an issue, revisit; for now, commit them.
