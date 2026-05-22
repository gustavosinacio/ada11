# Final summary — <run-id>

## Outcome
- **Feature**: <one-line description>
- **Pipeline result**: < shipped | escalated | aborted >
- **Branch / final commit**: <branch / final commit hash>

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | <yes / no / not-tested> |
| Human interventions during run | <count> |
| Total round-trips (sum of all loops) | <count> |
| Design ↔ Validate rounds | <N> |
| Implement ↔ Review rounds | <N> |
| Implement ↔ Test rounds | <N> |
| Implementer soft-callbacks | <N> |
| Wall-clock duration | <hh:mm> |
| Token cost (if known) | <usd or "n/a"> |

## Why we stopped (only if escalated or aborted)
- <reason>
- <open questions for human>

## Artifacts
- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md) (... and later versions if any)
- [`validation-v1.md`](./validation-v1.md) (...)
- [`implementation.md`](./implementation.md)
- [`review-v1.md`](./review-v1.md) (...)
- [`test-report-v1.md`](./test-report-v1.md) (...)
- [`transcript.md`](./transcript.md)
- [`questions.md`](./questions.md) (only if Implementer soft-called back)
- [`retro.md`](./retro.md) (filled in by owner after reviewing artifacts)

## Bugs found post-merge (backfill within 7 days)
- (none yet — owner updates this section as bugs surface)

## Notes (backfill)
- ...

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/<run-id>/` on <BRT timestamp>
