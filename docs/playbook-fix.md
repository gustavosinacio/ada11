# ada11 Bug-Fix Pipeline

A debug-focused pipeline. Mirrors the feature pipeline structure (`docs/playbook.md`) but with phases tuned for fixing existing code rather than building new functionality. This file is the operational contract — agents read it for context.

## When to use

Use the pipeline for any bug that:
- Has a vague or unclear reproduction.
- Could touch more than one file, OR
- Has regression risk (touches shared code paths, queries, auth, RLS, migrations).
- Is a UI bug where visual evidence is needed to nail down the symptom.

## When NOT to use (trivial fixes — direct fix instead)

- Typo with a clear cause.
- Single-line edit where the fix is obvious from the report.
- Stylistic adjustments / lint cleanup.
- Dependency bump triggered by a security advisory.

For these, fix directly and skip the pipeline. The Conductor's Triage step is responsible for this decision.

## The pipeline

```
[user bug report]
    │
    ▼
1. INTAKE + TRIAGE   (Conductor decision: pipeline or direct fix?)
    │ pipeline
    ▼
2. REPRODUCER        →  repro.md   (visual evidence MANDATORY for UI bugs)
    │
    ▼
3. DIAGNOSTICIAN     →  diagnosis.md
    │
    ▼ ◀───────────────┐  (≤1 redirect from later phases if root cause was wrong)
4. FIX DESIGNER      →  fix-plan.md
    │ ← human approval gate
    ▼
5. IMPLEMENTER       →  diff + implementation.md
    │
    ▼ ◀───────────────┐  (≤2 I↔R rounds)
6. REGRESSION TESTER →  regression-report.md
    │ pass
    ▼
7. CONDUCTOR finalizes:
   - updates state.md to `done`
   - archives run to the vault
   - asks user for visual confirmation (when applicable)
   - writes retro.md
```

## Roles and contracts

| # | Agent | Tool whitelist | Reads | Writes | Decision returned |
|---|---|---|---|---|---|
| 1 | Reproducer | Read, Grep, Glob, Bash (read) | bug report, repo (read-only) | repro.md | done / needs-input |
| 2 | Diagnostician | Read, Grep, Glob, Bash (read) | repro.md, source | diagnosis.md | done / needs-input / escalate |
| 3 | Fix Designer | Read, Write | repro.md, diagnosis.md | fix-plan.md | done / needs-input |
| 4 | Implementer (reused from feature pipeline) | Read, Edit, Write, Bash, Grep, Glob | fix-plan.md | code + implementation.md | done / blocked-question / budget-exhausted |
| 5 | Regression Tester | Read, Bash, Write | repro.md, fix-plan.md, implementation.md | regression-report.md | pass / fail / budget-exhausted |

**Hard rule**: an agent does NOT invoke another agent. Each returns to the Conductor with a recommendation. The Conductor (main session — owner + assistant) routes.

Agent definitions live in `.claude/agents/*.md`. The Implementer is reused from the feature pipeline — same agent, same boundaries.

### Subagent dispatch in this environment

Custom agent files under `.claude/agents/*.md` are NOT auto-discoverable as `Agent(subagent_type: ...)` values in this Claude Code deployment — only the 6 built-in types (`claude`, `claude-code-guide`, `Explore`, `general-purpose`, `Plan`, `statusline-setup`) dispatch. The custom files in `.claude/agents/` are **role specs**, not dispatchable subagents.

How the pipeline runs in practice: the Conductor (the main session) plays each role inline by reading the agent file as its operational contract and executing its job in the same conversation. Artifact contracts are still enforced — each role writes its specific output file with the schema from `docs/runs/_template-fix/`. The trade-off vs true isolated subagents is that role boundaries depend on Conductor discipline; the upside is that artifact pipelining works identically and there's no context-handoff overhead.

If a future environment supports custom subagent dispatch, switch to true `Agent(subagent_type: <role>, ...)` invocations with no other changes — the role specs are written assuming that surface.

## Round budgets

| Loop | Budget | When exhausted |
|---|---|---|
| Implement ↔ Regression | 2 | Conductor escalates to human |
| Diagnose redirect (from Implementer or Regression Tester) | 1 per run | Conductor escalates to human |

There is **no Designer ↔ Validator loop** here. The bug-fix scope is small enough that a single Fix Designer output + human approval is sufficient. If the fix designer concludes the cause isn't actually fixable as a bug (it's a refactor), the Conductor escalates and may switch to the feature pipeline.

When a budget is exhausted, the Conductor:
1. Marks `state.md` status as `escalated`.
2. Updates `retro.md` with a "Why we stopped" section.
3. Pings the human with the open questions.

## How to start a run (Conductor checklist)

1. **Intake + Triage** — read the bug report. Decide:
   - Trivial → direct fix, skip pipeline, note the choice to the user.
   - Non-trivial → continue.
2. **Generate run-id** — `YYYY-MM-DD_HHmm_<slug>` in BRT (today is 2026-05-20). Slug = 2-4 kebab-case words describing the bug. Example: `2026-05-20_0930_history-tab-crashes-on-empty-week`.
3. **Create folder** — copy `docs/runs/_template-fix/` to `docs/runs/<run-id>/`.
4. **Initialize `state.md`** — paste the user's bug report verbatim, record branch + `git rev-parse HEAD` baseline, set timestamps in BRT, reset budgets.
5. **Invoke Reproducer** via the Agent tool with `subagent_type: reproducer`. Pass the bug report + run-id.
6. **After each agent returns**:
   - Append a `transcript.md` entry (timestamp, agent, inputs, returned, your routing decision).
   - Update `state.md` (owner, phase, status, decrement budget if a loop iterated).
   - Route to the next agent per the pipeline diagram.
7. **Approval gate after Fix Designer**: present the fix plan with confidence/risk to the user; wait for explicit "go" before invoking Implementer.
8. **Hard rule** — do NOT skip pipeline steps once you decided this is a pipeline-worthy bug. The triage decision is upstream; once made, run the full pipeline.
9. **At end of run** (success, fail, or escalated):
   - Update `state.md` to `done` (or `escalated`).
   - Write `retro.md` (the human owner often fills this in after reviewing; the Conductor can pre-fill metrics).
   - Archive: `cp -r docs/runs/<run-id> "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/<run-id>"`.
   - Append a one-line entry to `$VAULT/AIground/multi-agent-pipeline/README.md` linking the run.
   - Ping the human with the summary + (if applicable) manual-verification checklist.

## Metrics to track (in retro.md)

| Metric | How to measure | Why |
|---|---|---|
| Bug reproduces post-fix? | Regression Tester's verdict + user confirmation | Outcome quality |
| Bugs found post-merge (7 days) | Owner backfills `retro.md` | Real quality signal |
| Human interventions during run | Count every time the owner had to answer a question or unblock | Process autonomy |
| Implement ↔ Regression rounds | Count | Diagnosis quality — high = root cause was wrong |
| Diagnose redirects | Count | Cause-finding quality |
| Wall-clock duration | start → done | Process speed |
| Pipeline overhead worth it? | Subjective yes / partially / no per run | Triage calibration |

## Vault archival

Same as feature pipeline:

```
$VAULT = ~/Library/Mobile Documents/iCloud~md~obsidian/Documents/SecondBrainground
$VAULT/AIground/multi-agent-pipeline/
  README.md
  pipeline-runs/<run-id>/
```

End-of-run, the Conductor copies `docs/runs/<run-id>/` to the vault and appends a one-line entry to the vault `README.md`.

## Anti-patterns to watch

- **Skipping Reproducer** because "the bug seems clear from the report" — verbal descriptions of UI bugs frequently diverge from the visual artifact. Always run Reproducer; always request screenshot for UI bugs.
- **Patching symptom instead of root cause** — Diagnostician must identify the cause; if the fix only addresses the visible symptom, mark it explicitly and let the human decide.
- **"While I'm here" cleanup** — bundling adjacent fixes inflates regression surface. Out-of-scope items go to `fix-plan.md` and `retro.md` as follow-ups.
- **Inventing test cases without running them** — Regression Tester must execute. "Looks fine in the code" is not a regression check.
- **Round budgets silently extended** — if you need more rounds, the contract is broken. Surface via escalation, don't quietly continue.

## Retro per run

After each run, write `retro.md` in the run folder with:

- What worked.
- What was friction.
- Prompt / schema adjustments to fold back.
- Was the pipeline overhead worth it for this fix?

Patterns across retros drive updates to this playbook and the agent definitions in `.claude/agents/`.

## When to escalate to the feature pipeline

If during Diagnose or Fix Designer it becomes clear the "fix" is actually a refactor or design change (multi-screen rearchitecture, new abstractions, schema changes), stop the bug-fix pipeline and consider switching to the feature pipeline (`docs/playbook.md`). Note the switch in `state.md` and `transcript.md`; archive the partial run before starting fresh.

## Reference

- Project overview — `docs/README.md`.
- Feature pipeline (for new functionality) — `docs/playbook.md`.
- Global agent rules — `~/.claude/CLAUDE.md`.
- Agent definitions — `.claude/agents/*.md`.
- First debug run (reference example) — `docs/runs/2026-05-20_0012_dark-mode-icon-contrast/`.
