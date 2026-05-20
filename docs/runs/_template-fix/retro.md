# Retro — <run-id>

## Outcome
- **Bug**: <one-line description>
- **Pipeline result**: < shipped | escalated | aborted | direct-fix-no-pipeline >
- **Final commit**: <hash>

## Metrics

| Metric | Value |
|---|---|
| Bug reproduces post-fix? | <no / yes / cannot-test> |
| Bugs found post-merge (7 days) | <count, backfill> |
| Human interventions during run | <count> |
| Implement ↔ Regression rounds | <N> |
| Diagnose redirects | <N> |
| Wall-clock duration | <hh:mm> |
| Token cost (if known) | <usd or "n/a"> |

## What worked
- ...

## What was friction
- ...

## Prompt / schema adjustments to fold back
- <agent prompt that could be tighter>
- <template field that needs adjustment>
- <playbook step that felt redundant or missing>

## Was the pipeline overhead worth it for this fix?
<yes | partially | no — with reasoning>

(If "no" repeatedly across runs, consider whether the bug class is one that should skip the pipeline by default — see Triage section of `docs/playbook-fix.md`.)

## Action items for the playbook
- [ ] <change to `docs/playbook-fix.md`>
- [ ] <change to template>
- [ ] <change to an agent prompt>

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/<run-id>/` on <BRT timestamp>.
