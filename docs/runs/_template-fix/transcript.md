# Transcript — <run-id>

> Append-only chronological log of phases and agent invocations. The Conductor writes one entry per agent return (or per significant phase decision). **Do not summarize or compress** — the full history is needed for post-run review.

## Format

```
### <BRT timestamp> — Conductor → <Agent>
- **Inputs passed**: <run-id, key context, paths read>
- **Returned**: <status / decision / counts / summary>
- **Conductor decision**: <next action>
```

## Entries

(Entries appended below in chronological order as the run progresses.)
