# CLAUDE.md — ada11

Project-specific instructions for Claude Code agents working in this repo. Global rules in `~/.claude/CLAUDE.md` apply too.

## Read first

- `docs/README.md` — project overview, reading order, conventions enforced.
- `docs/playbook.md` — **multi-agent development pipeline** used for non-trivial features.
- `docs/playbook-fix.md` — **multi-agent bug-fix pipeline** used for non-trivial bugs.

## When to use the agent pipeline

Use the pipeline (Discovery → Design → Validate → Implement → Review → Test) defined in `docs/playbook.md` for any feature that:

- Touches more than one file, OR
- Adds a new screen, new DB column, or new endpoint, OR
- Is explicitly tagged to use the pipeline.

Use direct Claude Code interaction (no pipeline) for: typo fixes, single-line edits, doc-only changes, dependency bumps.

**How to invoke**: `/pipeline <feature description>`. The skill at `.claude/skills/pipeline/SKILL.md` puts the current session in the Conductor role and runs the full checklist from `docs/playbook.md`.

## When to use the bug-fix pipeline

Use the bug-fix pipeline (Reproducer → Diagnostician → Fix Designer → Implementer → Regression Tester) defined in `docs/playbook-fix.md` for any bug that:

- Has a vague or unclear reproduction, OR
- Could touch more than one file, OR
- Has regression risk (shared code paths, queries, auth, RLS, migrations), OR
- Is a UI bug where visual evidence is needed.

Trivial fixes (typo, obvious 1-line, dependency bump) bypass the pipeline — the Triage step in the playbook handles that decision.

**How to invoke**: `/pipeline-fix <bug description or screenshot reference>`. The skill at `.claude/skills/pipeline-fix/SKILL.md` puts the current session in the Conductor role for the bug-fix pipeline.

## Pipeline conductor notes

- The Conductor is the main session running the pipeline. It invokes the six agents via the Agent tool, with `subagent_type` matching the filename under `.claude/agents/{discovery,designer,validator,implementer,reviewer,tester}.md`.
- **Hard rule**: agents do not invoke other agents. The Conductor routes.
- Round budgets enforced by the Conductor — see `docs/playbook.md` for the table.

## Vault archival

End-of-run artifacts archive to:

```
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/SecondBrainground/AIground/multi-agent-pipeline/pipeline-runs/<run-id>/
```

## Interaction signaling

Always play the macOS Glass sound whenever the user is needed to act — questions to answer, plan approvals, blockers, completion of an autonomous run. The user is frequently AFK during pipeline runs and wants an audible cue, not a silent prompt that lingers unread.

```bash
afplay /System/Library/Sounds/Glass.aiff
```

Trigger it:

- Immediately before any `AskUserQuestion`, `ExitPlanMode`, or any text turn that ends with a question / decision request.
- At the end of every autonomous multi-step run (the existing "Glass on completion" rule still applies).
- When a pipeline hits a blocker that needs human input.

Do **not** trigger it for routine progress updates or interim tool outputs.

## Identity / context

- Owner: Gustavo Inácio. Project email = `gsinacio94@gmail.com`.
- Dates: BRT (America/São_Paulo, UTC-3). Today is 2026-05-19.
