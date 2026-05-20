# Implementation — 2026-05-20_0042_exercise-block-undefined-muscles

Based on: `fix-plan.md` (approved by user on 2026-05-20 00:51). Baseline commit: `0ab8dda`.

## Files changed

- `src/components/exercise-block.tsx` (edited) — added `const muscles = exercise.muscles ?? [];` after `useState`; replaced 3 direct reads (`exercise.muscles.length`, `exercise.muscles.join`) with `muscles.*`.
- `src/components/exercise-list-item.tsx` (edited) — added the same defensive const, used it in the `musclesText` derivation.
- `src/components/routine-exercise-row.tsx` (edited) — added `const muscles = entry.exercise.muscles ?? [];` before the return; replaced 3 direct reads with `muscles.*`.
- `src/components/exercise-picker.tsx` (edited) — inline guard `(e.muscles ?? []).some(...)` in the filter; added `const muscles = item.muscles ?? [];` inside `renderItem`; replaced 3 `item.muscles.*` reads with `muscles.*`.
- `src/lib/query-client.ts` (edited) — added exported `queryCacheBuster = "schema-2026-05-19-muscles"` with a comment explaining when to bump.
- `app/_layout.tsx` (edited) — imported `queryCacheBuster`; passed it as `buster` in `persistOptions` of `<PersistQueryClientProvider>`.

## Deviations from plan

- **Persister `buster` location**: the plan said "add `buster` to `createAsyncStoragePersister` config". After reading the library types, the `buster` option does not live on the persister constructor — it lives on `PersistQueryClientProvider`'s `persistOptions`. Implementation exports the buster string from `src/lib/query-client.ts` for cohesion with the persister and consumes it in `app/_layout.tsx`. Two-file change instead of one; outcome equivalent and intent preserved.

## Soft callbacks made

- None.

## Quality gates

- [x] `npm run typecheck` — pass for the 6 changed files. **One pre-existing error** in `tests/e2e/measurements.spec.ts:149` (`Object is possibly 'undefined'` on `pageErrors[0]`). That file is untracked (user's previous measurements run, not committed) and not touched by this fix; flagging here for transparency.
- [x] `npm run lint` — 0 errors. 1 pre-existing warning in `router.d.ts` unrelated to this change.
- [x] `npm run test:unit` — 44 / 44 passed (includes the unit tests added by the previous measurements run, all green).
- [x] `npx expo export --platform web` — all 21 routes built successfully.
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log`.

## Process notes (for retro)

- During the replace_all sweep on `exercise.muscles → muscles`, the new const's own initializer line was also rewritten (`const muscles = muscles ?? []` — self-reference). Typecheck caught it (`TS7022: implicitly any` + `TS2448: used before declaration`); fix was a 3-edit restore of the initializers. **Lesson for the Implementer**: when introducing a local name that shadows a property access, use targeted replacements (with surrounding context) or replace the access pattern *before* introducing the const, not after.

## Notes for Regression Tester

- **Replay original repro (iOS)**: cannot replay locally — Conductor has no iOS device with the poisoned cache. Produce a manual-verification checklist in `regression-report.md` for the user.
- **Adjacent regression checks** (executable locally on web):
  - `exercises/index` — list renders.
  - `routines/[id]/index` — routine builder renders.
  - `workout/[sessionId]` — workout flow renders.
  - `history/[id]` — history detail renders.
  - Exercise picker (modal opened from routine builder) — search returns results, no crash.
- **Buster behavior**: on first launch after deploy, `PersistQueryClientProvider` will discard the persisted cache because the `buster` string differs from any previously persisted run. Every device sees a one-time refetch on next launch (acceptable).
