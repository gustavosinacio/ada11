# Design v<N> — <run-id>

## Goal (1 sentence)
<what we are building>

## Approach
<3-6 sentences: the strategy. Why this approach over alternatives.>

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `path/to/file.tsx` | edited | <what changes> |
| `path/new.ts` | new | <purpose> |

## Contratos de I/O
- **Function signatures / types added or changed**:
  ```ts
  // exact signature
  ```
- **DB columns / queries**: <exact column names, types, constraints, RLS implications>
- **UI props / state**: <prop shape>

## Riscos
- **Data integrity**: <RLS / migration concerns>
- **UX regressions**: <existing flows that share this code path>
- **Platform-specific**: <iOS / Android / web divergence>
- **Performance**: <query cost, render cost>

## Alternativas descartadas
1. **<Alternative A>** — <one line> — descartada porque <reason>.
2. **<Alternative B>** — <one line> — descartada porque <reason>.

## Out of scope
- <adjacent changes intentionally not made in this run>

## Resposta a issues do Validator (only if v > 1)
- **[BLK-1 / MAJ-1 / etc. from validation-v<N-1>]**: <how this version addresses it>
- ...
