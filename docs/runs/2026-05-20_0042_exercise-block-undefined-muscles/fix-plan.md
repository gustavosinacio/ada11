# Fix plan — 2026-05-20_0042_exercise-block-undefined-muscles

## Scope

**Inside this run:**
1. Defensive reads on every `exercise.muscles.*` consumer site (4 components).
2. Add a `buster` to the TanStack Query persister so future schema-incompatible cached data is invalidated automatically.

**NOT in this run** (see `Out of scope` below).

## Approach

The diagnosis identified two collaborating defects: consumer code trusts the TS type while the runtime value can be `undefined` from stale persisted cache, and the persister has no versioning so schema-incompatible cache rehydrates indefinitely. Fixing only one is insufficient — defensive reads alone leave the structural gap open for the next migration; bumping the buster alone doesn't help the user's current poisoned cache because the buster only invalidates AFTER the user upgrades to the build that has it.

The two-part fix is small and mechanical. Defensive reads use the pattern already present in `app/(app)/exercises/[id]/index.tsx:52` (`data.muscles ?? []`) — fall back to an empty array at the top of each consumer once, then the rest of the consumer code reads the local variable. The buster is a single string parameter; today we set it to `"schema-2026-05-19-muscles"` so any cache from before this build is invalidated on first launch.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/components/exercise-block.tsx` | edited | Replace direct reads of `exercise.muscles.*` with a local `const muscles = exercise.muscles ?? []` at the top of the body; use `muscles` in the existing guards (lines 86, 89-90). |
| `src/components/exercise-list-item.tsx` | edited | Same pattern: `const muscles = exercise.muscles ?? []`; use it on line 13. |
| `src/components/routine-exercise-row.tsx` | edited | Same pattern: `const muscles = entry.exercise.muscles ?? []`; use it on lines 64, 67-68. |
| `src/components/exercise-picker.tsx` | edited | Apply pattern inside the `useMemo` filter (line 36) AND in the list item render (lines 111, 114-115). The filter path uses `(e.muscles ?? [])` inline because the filter operates on each item in a loop; the list item render uses a local `const`. |
| `src/lib/query-client.ts` | edited | Add `buster: "schema-2026-05-19-muscles"` to the `createAsyncStoragePersister` config. Brief comment explaining: bump this string when a schema change invalidates persisted query shape. |

## Contratos de I/O

- **Function signatures / types**: Nenhum. The TS type `muscles: string[]` is unchanged.
- **DB columns / queries**: Nenhum.
- **UI props / state**: Nenhum. Local `const muscles` is internal to each component.
- **Persister contract**: cache key remains `"ada11-query-cache"`; `buster` is read by `@tanstack/query-async-storage-persister` and any persisted blob whose buster doesn't match is discarded on rehydration → one-time refetch on next launch.

## Riscos

- **Regressões em fluxos adjacentes**:
  - All 4 components touched are read by multiple screens (Workout, History, Routines builder, Exercise picker, Exercise library). Risk of rendering regression is very low — we only ADD a defensive fallback; the existing logic on a present `muscles` array is byte-identical.
  - The persister buster invalidates ALL persisted queries on the user's next launch, not just exercises. This is a one-time refetch cost — TanStack Query will re-issue every active query. On a slow connection users may see a brief loading state on screens that were previously instant from cache. Acceptable tradeoff for correctness.
- **Data integrity**: none — no schema or query changes.
- **Platform-specific**: the fix lands the same way on iOS, Android, and web. iOS is the user-reported environment; Android is predicted to need the same fix; web users get the cache refetch on next visit but were already on fresh cache today.
- **Performance**: one-time refetch on every device's next launch (cache invalidation cost). Steady-state behavior is identical to today.

## Alternativas descartadas

1. **Symptom-only fix: defensive reads, skip buster.** Descartada porque deixa a próxima migração com a mesma armadilha. Custa 1 linha a mais resolver direito.
2. **Marcar `muscles` como opcional no tipo (`muscles?: string[]`)** — descartada: propaga `undefined` por todo o app, força defensive reads em sítios futuros sem que o tipo reflita a realidade do servidor (Postgres garante array não-nulo). Discordância intencional servidor↔cliente é pior que cache stale.
3. **Reset incondicional do AsyncStorage no startup do build atual** — descartada: dispara reset em todos os usuários, descarta sessão (se persistida) e outros estados além do query cache. Buster faz isso de forma cirúrgica.
4. **Adicionar validação Zod no edge da API para todo response do Supabase** — descartada: refactor grande, foge do escopo de bug-fix; vale considerar como follow-up estrutural separado.

## Out of scope (follow-up)

- **API-edge Zod validation** for Supabase responses — guarantee that runtime values match TS types at the boundary. Separate, larger refactor; track as a hardening task.
- **Cache version policy** — formalize when to bump `buster` (e.g. include it in `docs/decisions.md`; tie it to migration numbers). Worth doing once but doesn't block this fix.
- **Generalizing the defensive read into a helper** like `normalizeExercise(row)` — 4 sites is below the abstraction threshold; revisit if a 5th site appears.

## Regression test plan (preview — Regression Tester will execute)

- **Static gates**: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npx expo export --platform web`.
- **Replay original reproduction** from `repro.md`: cannot replay locally (Conductor has no iOS device with the poisoned cache). Will produce a manual-verification checklist for the user.
- **Adjacent regression checks**:
  - **Web PWA** still works (header `+` icons, exercise list, routine list — sanity check the recent dark-mode fix is intact).
  - **Exercise picker search** with a query that matches a muscle string ("chest") returns results, doesn't crash even if persisted cache is hostile.
  - **Workout flow / History detail** in web mode render `ExerciseBlock` with an exercise that has `muscles: []` (empty array — different from `undefined` but exercises the guard).
- **Manual verification needed?** YES, on iOS:
  1. Open the iOS dev build (the one that crashed).
  2. Either: (a) launch with the existing AsyncStorage in place — first launch on the new build should silently invalidate cache via the buster and refetch — OR (b) clear AsyncStorage manually before launch to simulate first-install behavior.
  3. Navigate to History → open a past session. Confirm `ExerciseBlock` renders without the red-box error.
  4. Navigate to Workout → start or resume a session. Same.
  5. Navigate to Exercises tab. Pick an exercise. Confirm picker search works.

## Confidence / Risk

- **Confiança**: ALTA — root cause traced to file:line with evidence; fix is mechanical (1 const + replace direct reads) and follows an existing pattern in `app/(app)/exercises/[id]/index.tsx:52`.
- **Risco**: BAIXO — defensive reads are additive; buster forces a one-time refetch on next launch (acceptable). No type contract changes; no server-side changes.

## Awaiting

Human approval before Implement phase.
