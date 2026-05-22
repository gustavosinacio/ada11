# Retro — 2026-05-21_2155_volume-math-wrong

## Outcome

- **Bug**: "Volume count seems really wrong" (THIS WEEK 26.2k kg) + "Previous PR calculation seems wrong" (Volume to PR 4.9k Bench).
- **Pipeline result**: **shipped** — but as a re-scoping rather than a kernel fix. No math bug was found; the report turned out to be a UX/spec issue (k-shorthand obscuring the real number) plus a separate data-integrity bug logged for a follow-up run.
- **Final commit**: not yet committed (working tree dirty after Implementer phase; user to commit per their workflow).

## Metrics

| Metric | Value |
|---|---|
| Bug reproduces post-fix? | code-level: no. user-visual confirmation: pending. |
| Bugs found post-merge (7 days) | tbd |
| Human interventions during run | 1 (AskUserQuestion for spec decision — necessary, not a process failure) |
| Implement ↔ Regression rounds | 1 (single pass; no rework) |
| Diagnose redirects | 0 |
| Wall-clock duration | ~25 min (21:55 → 22:20 BRT) |
| Token cost (if known) | n/a |

## What worked

- **The diagnostic script paid for itself.** `scripts/debug-weekly-volume.ts` (drafted in the previous session) reproduced both displayed values exactly against prod data. Without it, the run would have flailed for the bug class.
- **Reproducer + Diagnostician inline** (Conductor playing both roles per playbook §67-73). Same artifacts as a true subagent dispatch, no context-handoff overhead, faster iteration when the diagnosis is "no math bug — spec question".
- **AskUserQuestion-style branching** caught the actual user need (no abbreviation) which a "fix the math" mindset would have missed entirely. Worth re-using when the Diagnostician finds "no bug, just spec".
- **Quality gates green on first pass.** The kernel change is one line + mechanical test updates; nothing surprised.

## What was friction

- **No subagent dispatch for custom bug-fix agents.** Had to fall back to the inline-Conductor mode. Worked, but means the audit trail for Reproducer/Diagnostician/Fix-Designer is the same artifact files written by one Conductor instead of three distinct agent invocations. Acceptable per playbook §67-73 but worth tracking.
- **Skill tool didn't recognize `pipeline-fix`** even though the SKILL.md is on disk. Couldn't invoke via `/pipeline-fix`; user had to confirm "are you using the pipeline" mid-run because there was no visible Skill invocation. Possibly a registration issue or a system-reminder list that excludes some skills.
- **Mandatory approval gate vs. AskUserQuestion**. Playbook requires approval after Fix Designer; the spec-question UI doubled as approval. Worked in practice but is not what the playbook prescribes.

## Prompt / schema adjustments to fold back

- Reproducer prompt: add a hint that "if the displayed value matches the DB sum, do not infer a math bug — frame it as a spec / display question and route to Conductor for user clarification, even if the user wrote it up as a bug."
- Fix-plan template: add a "spec decision recap" field that documents which AskUserQuestion answers fed the fix-plan, for run-archaeology.
- Playbook §How-to-start: add an explicit "if Diagnostician returns no-bug-just-spec, the Conductor MAY use AskUserQuestion to gather the spec choice before writing fix-plan.md" clause.

## Was the pipeline overhead worth it for this fix?

**Yes**. Triage said pipeline-worthy because of multi-file regression risk + visual evidence required. The diagnosis path saved an entire wrong fix (the user's instinct was to "fix the math" which would have produced a different wrong number) and surfaced a real, unrelated bug for the backlog. The artifacts also document why the displayed values were not a math bug — useful next time someone asks "why is 26.21k correct".

## Action items for the playbook

- [ ] Document the inline-Conductor fallback prominently in `docs/playbook-fix.md` (already noted at §67-73 but worth a "How to start a run" reference).
- [ ] Add a "spec-vs-math" framing to the Diagnostician prompt.
- [ ] Consider whether AskUserQuestion mid-pipeline should be a documented approval-gate variant.

## Archive

- Archived to vault: pending (Conductor will run the archive command after the user confirms they want to ship).
