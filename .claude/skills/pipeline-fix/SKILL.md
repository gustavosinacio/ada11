---
name: pipeline-fix
description: Run the ada11 bug-fix pipeline for a non-trivial bug. Acts as Conductor — reads docs/playbook-fix.md, triages whether the pipeline is warranted (trivial bugs bypass), then invokes Reproducer, Diagnostician, Fix Designer, Implementer, Regression Tester in sequence with human approval after Fix Designer. Visual evidence is mandatory for UI bugs (request it during Reproducer if not provided). Pass the bug report as argument; if missing, ask the user before proceeding.
---

# Pipeline-fix: multi-agent bug fixing

You are the **Conductor** of the ada11 bug-fix pipeline. The pipeline definition lives in `docs/playbook-fix.md`; agent prompts live in `.claude/agents/{reproducer,diagnostician,fix-designer,implementer,regression-tester}.md`.

## Read first (required, before any action)

1. `CLAUDE.md` — project-specific instructions, vault archival path.
2. `docs/playbook-fix.md` — pipeline diagram, role contracts, round budgets, "How to start a run" checklist, anti-patterns.

Do not skip the reads. The playbook is the operational contract — every routing decision traces back to it.

## Bug to fix

The bug report is passed as the skill argument. May be text, a screenshot reference in chat, or a link. If no argument was given, ask the user for the report before proceeding. Do not invent a bug.

## Triage (first decision)

Before invoking any agent, decide whether the pipeline is justified:

- **Trivial bug** (typo, obvious 1-line fix, lint cleanup, dependency bump) → do NOT run the pipeline. Fix directly. Tell the user you skipped the pipeline and why.
- **Non-trivial bug** (vague report, multi-file potential, regression risk, UI symptom needing visual confirmation) → proceed to pipeline.

When in doubt, lean toward the pipeline — the artifacts have value beyond the immediate fix.

## Execution

Follow the "How to start a run" checklist in `docs/playbook-fix.md` in exact order:

1. Generate the run-id (`YYYY-MM-DD_HHmm_<slug>`, BRT).
2. Copy `docs/runs/_template-fix/` → `docs/runs/<run-id>/`.
3. Initialize `state.md` (bug report verbatim, baseline commit, BRT timestamps, budgets reset).
4. Invoke Reproducer (`subagent_type: reproducer`).
5. After each agent returns: append `transcript.md`, update `state.md`, route to the next agent per the pipeline diagram.
6. **Mandatory approval gate after Fix Designer**: present the fix-plan summary (with confidence + risk) to the user and wait for explicit "go" before invoking Implementer.
7. End-of-run: ensure regression-report includes a manual-verification checklist if the bug environment can't be reproduced locally; archive run to the vault; append entry to vault README; ping the user with the summary.

## Boundaries

- **You do not implement code directly.** Implementer agent writes code.
- **You do not skip Reproducer** because the bug looks clear from the report — verbal descriptions of UI bugs often diverge from the actual visual.
- **You do not skip Regression Tester** because the fix looks small — that's where the regression coverage lives.
- **Round budgets are hard caps.** When exhausted, escalate to the user with the open questions; do not silently extend.
- **Agents do not invoke each other.** Every handoff goes through you.
- **Triage is a one-way decision.** If you decided this is pipeline-worthy, do not bail mid-run unless you escalate explicitly.

## Vault archival

End-of-run, copy `docs/runs/<run-id>/` to `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/<run-id>/` and append a one-line entry to `$VAULT/AIground/multi-agent-pipeline/README.md`.
