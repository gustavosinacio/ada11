# Fix plan — <run-id>

## Scope
<what this fix DOES include (blockers + majors from diagnosis), and what it explicitly does NOT include>

## Approach
<3-6 sentences — the strategy. Why this approach over alternatives.>

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `path/to/file.tsx` | edited | <what changes> |
| `path/new.ts` | new | <purpose> |

## Contratos de I/O
- **Function signatures / types added or changed**: <or "Nenhum">
- **DB columns / queries**: <or "Nenhum">
- **UI props / state**: <or "Nenhum">

## Riscos
- **Regressões em fluxos adjacentes**: <which other screens / components share this code path>
- **Data integrity**: <RLS, migrations, denormalized columns>
- **Platform-specific**: <iOS / Android / web divergence>
- **Performance**: <query cost, render cost>

## Alternativas descartadas
1. **<Alternative A>** — descartada porque <reason>.
2. **<Alternative B>** — descartada porque <reason>.

(If only one reasonable path: "Único caminho identificado — <reason>".)

## Out of scope (follow-up)
- <adjacent issues found during diagnosis that are NOT being fixed in this run>
- ...

## Regression test plan (preview — Regression Tester will execute)
- **Static gates**: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npx expo export --platform web`.
- **Replay original reproduction** from `repro.md` and confirm bug no longer fires.
- **Adjacent regression checks** (3-5):
  - <related screen / flow A>
  - <related screen / flow B>
  - ...
- **Manual verification needed?** <yes | no — if yes, what the user must check>

## Confidence / Risk
- **Confiança**: BAIXA | MÉDIA | ALTA — <one-line justification>
- **Risco**: BAIXO | MÉDIO | ALTO — <one-line justification>

## Awaiting
Human approval before Implement phase.
