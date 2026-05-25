# Fix plan — 2026-05-25_1214_blur-commit-skip-when-empty

## Scope

**Inclui (path 3 split, conforme Diagnostician):**

1. **Fix 1 — gate em `<SetInput>.commit()`** para suprimir o PATCH no-op `{weight: null, reps: null}` quando os dois inputs locais estão vazios E a `row` já tem `weight === null && reps === null`. Fecha a race 1 (concurrent-PATCH) para o shape "focused-empty + check" — o shape arquitetural que o brief alvo (Repro A).
2. **Fix 2 — novo e2e (E11)** em `tests/e2e/auto-fill-placeholder-on-check.spec.ts` exercitando o Repro A (foco em input vazio → tap check, sem typing, sem blur explícito). Sem essa spec, o gate do Fix 1 é inverificável end-to-end (E1/E7 não focam inputs, por isso nunca dispararam o `commit()`).
3. **Fix 3 — tightening em `gotoLiveSession`** para aguardar `useLastWorkingSet` ter resolvido antes de liberar o primeiro click. Anchor no placeholder do weight input (`"120"`). Fecha a race 2 (previous-set-not-loaded) que estava mascarada como "race 1 flake" nos relatórios anteriores, e que o regression-report da soft-deleted-session-volume-leak chamou de E7 `:633` NaN.

**NÃO inclui (out of scope — ver seção dedicada):**

- Race 1 para o shape "typed-then-checked" (E2/E3). Tratamento atual via `await weightInput.blur(); waitForTimeout(800)` permanece. Esse shape exige uma estratégia diferente (merge-patches / per-row mutation queue / await commit antes do auto-fill) — separado.
- Refator do `updateSet` em `src/api/sets.ts` para tratar `{weight: null, reps: null}` como no-op no servidor. Mudança de contrato; fora do alvo Option A.
- Gate alternativo no shim `onUpdateSet` em `app/(app)/workout/[sessionId].tsx:464-469`. O gate no `<SetInput>.commit()` é mais perto da fonte (não despacha o PATCH) e cobre o caso por construção.

## Approach

A causa raiz alvo é a race 1 (concurrent-PATCH) descrita pelo Diagnostician: quando o usuário tem um TextInput focado mas vazio e clica no botão de check, o `Keyboard.dismiss()` síncrono do handler dispara um `onBlur` em react-native-web → `<SetInput>.commit()` emite `{weight: null, reps: null}` → mutation paralela ao `updateSet` do auto-fill no mesmo `id`. PostgREST não garante ordem em UPDATEs concorrentes na mesma linha; o write no-op pode pousar depois do auto-fill e clobbar weight/reps.

A estratégia é **suprimir o write na origem** com um gate em `commit()`: se ambos os parses locais retornam `null` E a `row` ainda está com `weight/reps` ambos null, nenhum PATCH é despachado. É um root-cause fix (não symptom-only) para o shape focused-empty, e por construção remove o segundo writer concorrente — independente da plataforma, independente do timing do `Keyboard.dismiss()`.

O trade-off já aceito em `state.md` é que digitar `100` → apagar para `""` → blur (sem check) deixa de tentar gravar `null` no DB. Aceitável porque a `row` já estava com `null` (não há nada a limpar). Documentado no comentário verbatim do gate.

As duas adições de teste (Fix 2 e Fix 3) são necessárias para tornar o gate verificável e para impedir que a race 2 — independente — continue mascarando-se como "race 1 flake" no relatório do Tester.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/components/set-input.tsx` | edited | Gate em `commit()` (linhas 103-108): early-return quando ambos os parses locais (`weight`/`reps`) são `null` E `row.weight === null && row.reps === null`. Comentário verbatim explicando a race fechada e o trade-off aceito. Uma única responsabilidade na mudança: suprimir o write no-op na origem. |
| `tests/e2e/auto-fill-placeholder-on-check.spec.ts` | edited | Duas adições, ambas sob a mesma responsabilidade ("tornar o gate verificável end-to-end"): (a) novo test case **E11** cobrindo Repro A — focar weight input vazio via `getByPlaceholder("120").first().focus()`, clicar Mark sem typing, assertar exatamente UM PATCH no-fill + DB row com `weight ≈ 120, reps === 8`; (b) tightening do helper `gotoLiveSession` (linhas 259-274) para aguardar o placeholder `"120"` ficar visível no weight input antes de retornar, garantindo que `useLastWorkingSet` resolveu antes de qualquer click. |

Combinei (a) e (b) no mesmo arquivo porque ambos atuam no harness de teste do mesmo feature, e o E11 depende diretamente do tightening do helper (sem ele, o próprio E11 ficaria flaky pela race 2 — exatamente o erro que estamos consertando). Não há razão para split.

## Contratos de I/O

- **Function signatures / types added or changed**: Nenhum. `commit()` permanece com a mesma assinatura (sem args, retorna `void`). `<SetInput>` props permanecem inalteradas — `row: SetRow` já vinha sendo recebida; o gate apenas lê `row.weight` e `row.reps` que já estavam no escopo.
- **DB columns / queries**: Nenhum. Mudança comportamental apenas: **menos** PATCHes despachados no caso focused-empty + check. Nenhuma migração, nenhuma nova query, nenhuma mudança em RLS.
- **UI props / state**: Nenhum. Local state (`weight`, `reps`) inalterado; useState/useEffect inalterados; nenhum re-render extra introduzido.
- **Test contract**: o helper `gotoLiveSession` ganha uma espera adicional (placeholder `"120"` visível) — semântica: "esperar até que `useLastWorkingSet` tenha resolvido". Não muda assinatura pública (continua `(page, sessionId) => Promise<void>`). E11 adiciona uma interceptação de rede `page.on('request', ...)` ou similar para contar PATCHes no `id=eq.<setId>` (sem bloquear/modificar requests). **TODO: Implementer to verify** — checar se algum test do arquivo já estabelece padrão de interceptação; se não houver precedente, optar por `page.on('request')` para contagem (menos invasivo que `page.route`).

**TODO: Implementer to verify** — o brief escreveu `parseFloat0(weight, unit)` no snippet do predicado, mas o arquivo real (`src/components/set-input.tsx:46-58`) define `parseFloat0(s)` com **um único parâmetro** e expõe um helper distinto `kgFromInputString(s, unit)` que é o que o `commit()` original já chama. O Implementer deve usar `kgFromInputString` no gate (não `parseFloat0`) e registrar o desvio em `implementation.md`. Predicado canônico abaixo refletindo o nome real do helper:

```ts
const commit = () => {
  const newWeight = kgFromInputString(weight, unit);
  const newReps = parseInt0(reps);
  // F7 race fix: skip the no-op commit. If both fields are empty AND the
  // row was already null, this is a null→null write that races with the
  // toggle handler's auto-fill updateSet PATCH (no PostgREST ordering
  // guarantee). Suppressing it removes the colliding writer entirely on
  // the focused-empty-input + tap-check path.
  // Accepted trade-off: typing "100" then erasing to "" then blurring
  // without check will also be suppressed — net effect zero because the
  // row was already null (nothing to clear).
  if (
    newWeight === null &&
    newReps === null &&
    row.weight === null &&
    row.reps === null
  ) {
    return;
  }
  onCommit({ weight: newWeight, reps: newReps });
};
```

## Riscos

- **Regressões em fluxos adjacentes**:
  - `app/(app)/history/[id].tsx:310-352` (history-edit): renderiza `<ExerciseBlock>` sem `showCheckable`. Sem botão de check ⇒ sem auto-fill ⇒ sem race 1. O gate continua disparando lá, mas o efeito é o mesmo da situação atual — usuário que abre uma row com `weight=null, reps=null`, foca/desfoca sem digitar, não dispara PATCH. Antes e depois do gate: zero PATCHes. **Sem regressão**. ALTA confiança (verificado por static trace no diagnosis).
  - `<ReadOnlyExerciseBlock>` (`app/(app)/history/[id].tsx:354-362`): sem inputs editáveis. Gate não pode disparar. **Sem regressão**. ALTA confiança.
  - Sessão live com row já populada (não-null): o gate não dispara (`row.weight !== null`). Comportamento idêntico ao atual. **Sem regressão**.
  - Caso plain-blur com erase-to-clear (sem check): usuário digita `100`, apaga, blurra. Local state vazio; `row.weight` ainda `null` (nada committado). Gate suprime o PATCH. Net effect: nada muda no DB (row já era null). **Aceito como trade-off no `state.md` e no comentário verbatim.** Não é regressão funcional — é a mesma decisão arquitetural do F7 retro.

- **Data integrity**:
  - RLS: inalterada. Nenhuma policy tocada.
  - Migrations: nenhuma.
  - Denormalized columns: nenhuma. `sets.weight`/`sets.reps` continuam sendo o caminho único de verdade.
  - Pior caso de dados: o gate **suprime** writes que seriam no-ops; não cria caminho para escrever valores incorretos. Risco de corrupção: zero. ALTA confiança.

- **Platform-specific**:
  - Web (react-native-web): `Keyboard.dismiss()` síncrono ⇒ blur síncrono ⇒ era exatamente onde a race 1 nascia. Gate fecha. Verificado pelo Diagnostician via `node_modules/react-native-web/dist/cjs/modules/dismissKeyboard/index.js:16-18`.
  - iOS/Android: `Keyboard.dismiss()` posta o blur via bridge assíncrona. O blur chega depois do auto-fill, e atualmente o `commit()` clobba o auto-fill. Com o gate, o `commit()` ainda é chamado tardiamente, mas se os locais foram esvaziados E a row tinha sido auto-filled (não-null), o gate **não** dispara (porque `row.weight !== null` no momento do re-render do `<SetInput>`). Então: no native, o gate só fecha o caso em que a row continua null após o auto-fill (cenário onde o usuário nunca tinha digitado nada e o `previousSet` era null) — esse caso é benigno por si só. **Limite a ser confirmado**: o follow-up do native typed-then-checked permanece sem fix neste run.
  - **Atenção**: a `row` lida pelo gate vem das props. O `useEffect` em `set-input.tsx:98-101` reseta o local state quando `row.reps`/`row.weight` mudam. O `commit` é redeclarado a cada render (não memoizado, linha 103), logo cada chamada lê o `row` da render mais recente — sem stale closure. ALTA confiança, mas Implementer deve validar inspecionando que `commit` continua não-memoizado após a edição.

- **Performance**:
  - Render cost: zero. Gate adiciona 2 comparações `=== null` por chamada de `commit()`. Desprezível.
  - Network cost: **melhora**. Menos PATCHes despachados para o PostgREST nos casos focused-empty + blur/check.
  - Bundle size: zero. Sem novas imports.

## Alternativas descartadas

1. **Gate no shim `onUpdateSet` (`app/(app)/workout/[sessionId].tsx:464-469`)** — suprimir o forward para `updateSet.mutateAsync` quando `patch.weight === null && patch.reps === null` e a row já está nula. Descartada porque é mais longe da fonte (o PATCH já foi formatado e empacotado); o `<SetInput>.commit()` é a borda mais próxima do disparo. Também: o shim é compartilhado entre history-edit e live workout; gate no shim aplicaria a ambos, e history-edit pode legitimamente querer escrever `null` em algum cenário futuro (limpar campo via UI ainda inexistente). Manter o gate no componente de input mantém escopo cirúrgico.

2. **Server-side conditional update via RPC** (no-op `UPDATE sets SET weight=null, reps=null WHERE weight IS NOT NULL OR reps IS NOT NULL`) — descartada porque é mudança de contrato no `sets.ts`, exige RPC nova ou template do PostgREST não trivial, e não fecha a race para clientes que ainda não atualizaram. O gate client-side é mais simples, reversível, e localizado.

3. **Merge dos dois patches num único `updateSet`** (que cobriria também E2/E3) — descartada para este run porque exige coordenação entre `<SetInput>.commit()` e o handler de toggle no screen (refs, ou levantar local state para o pai, ou uma mutation queue). Surface significativamente maior. Fica para o follow-up dedicado a E2/E3 (race 1 typed-then-checked).

4. **Per-row mutation queue** (await in-flight `updateSet` antes do próximo) — descartada por motivo similar à #3 (mudança em `useUpdateSet` infra, afeta todos os call sites do hook, não só auto-fill). Caro para o escopo deste run.

5. **Apenas test-side waitForTimeout maior** — descartada categoricamente porque é symptom-masking. Não fecha a race; só esconde do CI.

## Out of scope (follow-up)

- **Race 1 typed-then-checked (E2/E3)**: o mitigation atual (`await weightInput.blur(); waitForTimeout(800)`) permanece. Próximo run dedicado deve avaliar Option B (await commit antes do auto-fill), Option C (merge-patches) ou Option D (per-row queue). Aberto em backlog.
- **Server-side `updateSet` short-circuit** para `{weight: null, reps: null}` quando a row já é null — defesa em profundidade adicional. Não urgente.
- **Gate análogo em `app/(app)/workout/[sessionId].tsx:464-469`** (`onUpdateSet` thunk) como redundância — se a hipótese da closure-prop-staleness do `<SetInput>` se revelar verdadeira em testing native, considerar mover o gate para o thunk. Apenas se evidência empírica aparecer.
- **Aumento da cobertura da E2E**: novos cases para erase-to-clear-then-blur e erase-to-clear-then-check para documentar o trade-off comportamental. Útil para regression em runs futuros tocando essa região.

## Regression test plan (preview — Regression Tester will execute)

- **Static gates**: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npx expo export --platform web`.
- **Replay original reproduction** (`repro.md` Repro A):
  - Rodar o novo E11 com `--repeat-each=10`. Bar: **10/10 verde**.
  - Confirmar via Playwright network log: exatamente UM PATCH (`auto-fill`), nenhum `{weight: null, reps: null}` PATCH paralelo.
- **Adjacent regression checks**:
  - E1 + E7 do `auto-fill-placeholder-on-check.spec.ts` com `--repeat-each=10`. Fix 3 (`gotoLiveSession` tightening) deve eliminar o E7 `:633` NaN flake do regression-report da soft-deleted-session-volume-leak run. Bar: **10/10 verde**.
  - E2/E3/E4/E5/E6/E8/E9/E10 da mesma spec — sem `--repeat-each` é suficiente (o mitigation `await weightInput.blur(); waitForTimeout(800)` deles permanece). Bar: single run verde.
  - `tests/e2e/rest-timer-auto-start.spec.ts` — usa um helper similar `gotoLiveSession`; verificar que o tightening do anchor (se for compartilhado) não quebra (deve ser additive). Bar: passa.
  - History-edit smoke (`app/(app)/history/[id].tsx`): editar uma row antiga, mudar weight, blurrar. Confirmar que o commit chega ao DB (gate não suprime — porque `weight !== null` na entrada).
  - Live workout sem prior session (Repro: usuário novo, nenhuma sessão prévia): focar input vazio, blurrar sem digitar, sem check. Antes: PATCH no-op. Depois: nenhum PATCH. Confirmar que o UI continua coerente (sem warning, sem error toast).
  - Unit test suite completa: `npm run test:unit` → 364/364 esperado.
- **Manual verification needed?** Sim, leve. O usuário (Gustavo) deve rodar localmente um único smoke no app web:
  1. Abrir uma sessão live com um exercício que tem prior session.
  2. Focar o weight input vazio (sem digitar).
  3. Tocar no botão de check.
  4. Verificar visualmente que: row fica verde (checked), weight aparece com o valor da prior session, reps idem, volume `> 0 kg`. Network tab: um único PATCH (`id=eq.<setId>`) com `{weight: "120.00", reps: 8, completed_at: ...}` — sem PATCH paralelo carregando `weight: null`.

## Confidence / Risk

- **Confiança**: ALTA — root cause da race 1 (focused-empty shape) está identificada por static trace + evidência cross-source (Reproducer + Diagnostician + F7 retro convergem); o gate é por construção a inversa do predicado "no-op write"; o trade-off já está aceito no `state.md`; APIs verificadas no source real (`kgFromInputString`, `parseInt0`, `row` já em props).
- **Risco**: BAIXO — mudança de ~5 LOC no componente de input, reversível com revert simples; sem mudança em schema, RLS, contratos de hook, ou bundle; sem novas dependências; cobertura de teste expande (não contrai); o único caminho onde o gate altera comportamento usuário-visível (erase-then-blur sem check em row já-null) tem efeito DB líquido zero.

## Awaiting

Human approval before Implement phase.
