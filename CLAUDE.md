# CLAUDE.md — ada11

Project-specific instructions for Claude Code agents working in this repo. Global rules in `~/.claude/CLAUDE.md` apply too.

## Read first

- `docs/README.md` — project overview, reading order, conventions enforced.
- `docs/playbook.md` — **multi-agent development pipeline** used for non-trivial features.

## When to use the agent pipeline

Use the pipeline (Discovery → Design → Validate → Implement → Review → Test) defined in `docs/playbook.md` for any feature that:

- Touches more than one file, OR
- Adds a new screen, new DB column, or new endpoint, OR
- Is explicitly tagged to use the pipeline.

Use direct Claude Code interaction (no pipeline) for: typo fixes, single-line edits, doc-only changes, dependency bumps.

## Pipeline conductor notes

- The Conductor is the main session running the pipeline. It invokes the six agents via the Agent tool, with `subagent_type` matching the filename under `.claude/agents/{discovery,designer,validator,implementer,reviewer,tester}.md`.
- **Hard rule**: agents do not invoke other agents. The Conductor routes.
- Round budgets enforced by the Conductor — see `docs/playbook.md` for the table.

## Vault archival

End-of-run artifacts archive to:

```
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/SecondBrainground/AIground/multi-agent-pipeline/pipeline-runs/<run-id>/
```

## Identity / context

- Owner: Gustavo Inácio. Project email = `gsinacio94@gmail.com`.
- Dates: BRT (America/São_Paulo, UTC-3). Today is 2026-05-19.
