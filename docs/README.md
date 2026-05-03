# Ada11 — Documentation Index

> If you are an AI agent or new contributor joining this project, **read this file first**, then the other docs in the order listed below. The goal of `docs/` is to compress weeks of context into a few hours of reading.

## What this project is

**Ada11** is a personal gym training tracker. It is a universal app (iOS, Android, web) built by a single developer collaborating with AI assistants. The owner of this repo is Gustavo Inácio (gsinacio94@gmail.com).

The app's job:
- Log gym workouts in real time (sets, reps, weight, RPE).
- Define training routines (templates).
- Review history.
- Sync between phone and desktop.

The owner's constraints:
- **Solo dev + AI** — pick stacks where AI performs well: strict types, large training corpus, stable conventions.
- **Free during testing**, **public-ready** without a rewrite.
- **iPhone is the primary device** (used at the gym). Desktop access secondary.
- **Auth and database security from day one** — even though it's currently a single user.
- **Mobile native is coming**, but web is being built first.

## Reading order for a new agent

| # | File | Why read it |
|---|---|---|
| 1 | [`README.md`](./README.md) (this file) | The overview and how the docs are organized. |
| 2 | [`architecture.md`](./architecture.md) | High-level stack, layered diagram, what each piece does and why. |
| 3 | [`decisions.md`](./decisions.md) | The 6 architectural decisions made, with options considered, what was rejected, and why. **The most important doc** — captures rationale that's not visible from the code. |
| 4 | [`data-model.md`](./data-model.md) | Database schema, RLS, types, sync model. |
| 5 | [`development.md`](./development.md) | Local setup, env vars, dev loop, testing, deploy, troubleshooting. |
| 6 | [`roadmap.md`](./roadmap.md) | What's scaffolded, what's deferred, week-1 build plan. |

## Conventions enforced by the owner's CLAUDE.md (global)

These apply to every interaction in this repo. Treat them as binding:

1. **Pushback before recommending.** If a request has hidden tradeoffs or ambiguous terms ("scalable", "performant"), name the tradeoff first. Don't just answer.
2. **Tier options with explicit "when this is right" criteria.** Avoid "use X" without alternatives. Always declare a default.
3. **Confidence (LOW/MEDIUM/HIGH) and Risk (LOW/MEDIUM/HIGH) on every diagnosis, recommendation, or plan.**
4. **Plan obrigatório.** Before any modification (file edit, package install, branch creation), present a plan with diagnosis, files affected, risks, confidence, risk — and wait for explicit approval.
5. **Validate facts against the source.** Don't build reasoning on user-quoted numbers, file paths, or framework behavior without checking.
6. **Date handling is BRT (America/São_Paulo, UTC-3).** Always.
7. **Distinguish opinion from fact.** Mark "verified", "hypothesis", "personal opinion".

If you're an agent and these feel restrictive — they're a load-bearing part of how this project gets built. Follow them.

## Where to write things

| Where | What |
|---|---|
| `docs/` (this folder) | Architecture, decisions, dev workflow, schema reference. **Stable knowledge.** |
| `README.md` (root) | Quick-start summary. Points back here. |
| Code comments | Only where the **why** is non-obvious (workarounds, hidden invariants, framework gotchas). Never narrate the **what**. |
| Obsidian SecondBrainground (external, see global CLAUDE.md) | Personal investigations, troubleshooting logs, lessons learned. Not in this repo. |

## How to update these docs

When you make an architectural change:
1. Update the relevant doc (`architecture.md`, `decisions.md`, `data-model.md`).
2. Add a new entry to the decision log in `decisions.md` if it changed an earlier decision.
3. Don't let docs drift — outdated docs are worse than no docs because they actively mislead.
