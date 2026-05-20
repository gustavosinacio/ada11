# ada11 Multi-Agent Development Pipeline

A 6-stage pipeline for developing non-trivial features. Each stage has one responsible agent; agents return to a Conductor that routes between them. This file is the operational contract — agents read it to understand the pipeline, their boundaries, and the handoffs.

## The pipeline

```
[user prompt]
    │
    ▼
1. DISCOVERY  →  discovery.md
    │
    ▼
2. DESIGN     →  design-v1.md ◀────────────┐
    │                                       │
    ▼                                       │  (≤3 D↔V rounds)
3. VALIDATE   →  validation-v1.md ──────────┘
    │ go
    ▼
4. IMPLEMENT  →  diff + implementation.md ◀────┐
    │                                           │
    ▼                                           │  (≤2 I↔R rounds)
5. REVIEW     →  review-v1.md ──────────────────┘
    │ pass
    ▼                                           ┐
6. TEST       →  test-report-v1.md ◀────────────┤  (≤2 I↔T rounds)
    │ pass                                      │
   (back to Implementer if fail) ───────────────┘
    │
    ▼
7. CONDUCTOR finalizes:
   - writes final-summary.md
   - archives run to the vault
   - pings the human
```

## Roles and contracts

| # | Agent | Tool whitelist | Reads | Writes | Decision returned |
|---|---|---|---|---|---|
| 1 | Discovery | Read, Grep, Glob, Bash (read) | prompt, repo, docs/ | discovery.md | done / needs-input |
| 2 | Designer | Read, Write | discovery.md, prior validation if re-design | design-vN.md | done / needs-input |
| 3 | Validator | Read, Grep, Glob | discovery.md, design-vN.md | validation-vN.md | go / no-go / budget-exhausted |
| 4 | Implementer | Read, Edit, Write, Bash, Grep, Glob | design, validation, review (if re-implement) | code, implementation.md, questions.md | done / blocked-question / budget-exhausted |
| 5 | Reviewer | Read, Bash, Grep | diff, design, implementation | review-vN.md | pass / fail / budget-exhausted |
| 6 | Tester | Read, Bash, Write | design, implementation, review | test-report-vN.md | pass / fail / budget-exhausted |

**Hard rule**: an agent does NOT invoke another agent. Each returns to the Conductor with a recommendation. The Conductor (the main session — owner + assistant) routes.

Agent definitions live in `.claude/agents/*.md`.

## Round budgets

| Loop | Budget | When exhausted |
|---|---|---|
| Design ↔ Validate | 3 | Conductor escalates to human, logs unresolved concerns |
| Implement ↔ Review | 2 | Conductor escalates to human |
| Implement ↔ Test | 2 | Conductor escalates to human |
| Implementer soft-callback to Designer | 2 per run | Conductor escalates to human |

When a budget is exhausted, the Conductor:
1. Marks `state.md` status as `escalated`.
2. Writes `final-summary.md` with a "Why we stopped" section.
3. Pings the human with the open questions.

## How to start a run (Conductor checklist)

1. **Generate run-id** — `YYYY-MM-DD_HHmm_<slug>` in BRT (today is 2026-05-19). Slug = 2-4 kebab-case words describing the feature. Example: `2026-05-19_1430_weekly-volume-stat`.
2. **Create folder** — copy `docs/runs/_template/` to `docs/runs/<run-id>/`.
3. **Initialize `state.md`** — paste the user's prompt verbatim; record branch + `git rev-parse HEAD` baseline; set timestamps in BRT; reset budgets.
4. **Invoke Discovery** via the Agent tool with `subagent_type: discovery`. Pass the prompt + run-id.
5. **After each agent returns**:
   - Append a `transcript.md` entry (timestamp, agent, inputs, returned, your routing decision).
   - Update `state.md` (owner, step, round, status, decrement budget if a loop iterated).
   - Route to the next agent per the pipeline diagram.
6. **Hard rule** — do NOT skip pipeline steps. The quality gates depend on every stage running. Speed comes from agents producing tight artifacts, not from bypassing stages.
7. **At end of run** (success, fail, or escalated):
   - Write `final-summary.md` with the metrics table.
   - Archive: `cp -r docs/runs/<run-id> "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/<run-id>"`.
   - Append a one-line entry to `$VAULT/AIground/multi-agent-pipeline/README.md` linking the run.
   - Ping the human with the summary.

## Metrics to track (in final-summary.md)

| Metric | How to measure | Why |
|---|---|---|
| Feature works end-to-end? | Tester's golden path verdict | Outcome quality |
| Bugs found post-merge (7 days) | Owner backfills `final-summary.md` | Real quality signal |
| Human interventions during run | Count every time the owner had to answer a question or unblock | Process autonomy |
| Total round-trips | Sum across all loops (D↔V, I↔R, I↔T, soft callbacks) | Contract clarity — high = inputs unclear |
| Wall-clock duration | start → final-summary | Process speed |
| Token cost | From Claude Code billing | Reference only |

## Vault archival

End-of-run artifacts are archived to a project-external location for cross-run reference:

```
$VAULT = ~/Library/Mobile Documents/iCloud~md~obsidian/Documents/SecondBrainground
$VAULT/AIground/multi-agent-pipeline/
  README.md
  pipeline-runs/<run-id>/
```

At end of each run, the Conductor:
1. Copies `docs/runs/<run-id>/` to `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/<run-id>/`.
2. Appends a one-line wikilink entry to `$VAULT/AIground/multi-agent-pipeline/README.md`.

The repo-local `docs/runs/<run-id>/` stays committed; the vault copy is the durable cross-machine archive.

## Anti-patterns to watch

- **Conductor skipping steps** because "the answer is obvious" — breaks the quality gates. Don't.
- **Validator rubber-stamping** — if zero issues found, search deeper. Real software always has issues.
- **Implementer guessing at ambiguity** — soft-callback exists for this. Use it.
- **Tester reading code instead of running it** — that's the Reviewer's job. Tester must execute.
- **Round budgets silently extended** — if you need more rounds, the contract is broken. Surface it via escalation, don't quietly continue.

## Retro per run

After each run, write `retro.md` in the run folder with:

- What worked.
- What was friction.
- Any prompt or schema adjustments to fold back into the pipeline.

Patterns across retros drive updates to this playbook and the agent definitions in `.claude/agents/`.

## When NOT to use the pipeline

- Typo fixes.
- Single-line edits with obvious intent.
- Doc-only changes.
- Dependency bumps (use `expo install` and confirm).

For these, use Claude Code directly — the pipeline overhead is not justified.

For **bugs** (vague repro, regression risk, multi-file potential, UI symptoms), use the **bug-fix pipeline** in `docs/playbook-fix.md` (skill: `/pipeline-fix`) instead.

## Reference

- Project overview — `docs/README.md`.
- Architecture — `docs/architecture.md`.
- Data model — `docs/data-model.md`.
- Dev workflow — `docs/development.md`.
- Architectural decisions — `docs/decisions.md`.
- Roadmap — `docs/roadmap.md`.
- Global agent rules — `~/.claude/CLAUDE.md`.
- Agent definitions — `.claude/agents/*.md`.
