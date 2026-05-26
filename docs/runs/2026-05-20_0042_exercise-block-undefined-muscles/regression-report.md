# Regression report — 2026-05-20_0042_exercise-block-undefined-muscles

## Environment
- Build verified: `npx expo export --platform web` (static export, all 21 routes compiled).
- Conductor environment cannot drive an iOS dev build with a pre-`b51dd01` poisoned AsyncStorage; manual verification belongs to the user.

## Automated checks

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | pass for the 6 changed files. **1 pre-existing error** in `tests/e2e/measurements.spec.ts:149` (`Object is possibly 'undefined'`) — untracked file from user's measurements run, not introduced by this fix. |
| Lint | `npm run lint` | 0 errors; 1 pre-existing warning in `router.d.ts` unrelated to this change. |
| Unit tests | `npm run test:unit` | 44 / 44 passed. |
| Web export build | `npx expo export --platform web` | pass — 21 routes built. |

## Replay of original reproduction

**Steps from `repro.md`**:
1. Launch iOS app with persisted AsyncStorage cache from a pre-`b51dd01` build.
2. Sign in.
3. Navigate to History or Workout.
4. Observe red-box render error `Cannot read property 'length' of undefined`.

**Result**: `cannot-test-locally` — see Manual verification checklist below.

**Evidence**: Conductor does not have access to the user's iOS device. The fix has two parts: (a) defensive reads make the code resilient to the bad cache; (b) the persister `buster` invalidates the bad cache on first launch of the new build. (a) means the bug cannot fire even if the cache stays poisoned; (b) ensures the cache refreshes on the next session anyway.

## Adjacent regression checks

| Surface | How verified | Result |
|---|---|---|
| `app/(app)/exercises/index.tsx` (Exercises list) | Web export built; component reads exercises through `useExercises` which goes through the same `ExerciseRow` shape. Code path now uses defensive `muscles` local. | pass (static) |
| `app/(app)/routines/[id]/index.tsx` (Routine builder) | Web export built; routine entries pass through `RoutineExerciseRow`, now defensive. | pass (static) |
| `app/(app)/workout/[sessionId].tsx` (Workout flow) | Web export built; renders `ExerciseBlock`, now defensive. | pass (static) |
| `app/(app)/history/[id].tsx` (History detail) | Web export built; renders `ExerciseBlock`, now defensive. | pass (static) |
| Exercise picker modal | Web export built; both filter and renderItem paths defensive. | pass (static) |
| Persisted cache invalidation | `buster: "schema-2026-05-19-muscles"` set in `persistOptions`. Next launch of any device with stale cache discards it. | pass (config verified) |

Dynamic runtime verification of these surfaces requires user-driven smoke testing. Recommended as part of the manual verification step below.

## Manual verification checklist (Conductor cannot test locally)

After deploy, on iOS dev build (the environment that crashed):

1. **Pull the new build.** Either by rebuilding via `expo run:ios --device`, or by triggering the OTA update mechanism if you use one. The buster only invalidates cache after the JS bundle containing the new buster value is loaded.
2. **First launch with old cache still present (optional but valuable)**: launch the new build without manually clearing storage. On startup, `PersistQueryClientProvider` reads the persisted blob, sees the buster mismatch, discards it, and queries refetch fresh from Supabase. Confirm: app launches without crash.
3. **Navigate to History → open a past session.** Confirm `ExerciseBlock` renders normally — exercise rows show name, and the subtitle line either appears (when muscles are present) or is omitted (when empty). No red box.
4. **Navigate to Workout.** Resume or start a session. Same: confirm no crash, exercises render.
5. **Navigate to Exercises tab.** List renders. Tap one to open detail. Search via the picker (open from a routine builder if quicker).
6. **Manual verification of buster behavior**: if you have a TestFlight/Android second device with even older cache, repeat steps 2-5 there.

Web (PWA) sanity:
- Verify the recent dark-mode fix is still working (header `+` icons visible). My changes touched components that render in those flows; this confirms no regression.

## Code-level confirmation

| File | Before | After |
|---|---|---|
| `src/components/exercise-block.tsx:42` | (no local; direct reads) | `const muscles = exercise.muscles ?? [];` |
| `src/components/exercise-block.tsx:86` | `exercise.muscles.length > 0` | `muscles.length > 0` |
| `src/components/exercise-block.tsx:89-90` | `exercise.muscles.length > 0 ? exercise.muscles.join(", ") : null` | `muscles.length > 0 ? muscles.join(", ") : null` |
| `src/components/exercise-list-item.tsx:12-13` | direct reads in `musclesText` | `const muscles = exercise.muscles ?? []; const musclesText = muscles.length > 0 ? muscles.join(", ") : null;` |
| `src/components/routine-exercise-row.tsx:57` | (no local) | `const muscles = entry.exercise.muscles ?? [];` |
| `src/components/routine-exercise-row.tsx:64-68` | `entry.exercise.muscles.*` | `muscles.*` |
| `src/components/exercise-picker.tsx:36` | `e.muscles.some(...)` | `(e.muscles ?? []).some(...)` |
| `src/components/exercise-picker.tsx:95` | (no local) | `const muscles = item.muscles ?? [];` |
| `src/components/exercise-picker.tsx:111-115` | `item.muscles.*` | `muscles.*` |
| `src/lib/query-client.ts:22+` | (no buster export) | `export const queryCacheBuster = "schema-2026-05-19-muscles";` |
| `app/_layout.tsx:12` | `import { queryClient, queryPersister } ...` | `import { queryCacheBuster, queryClient, queryPersister } ...` |
| `app/_layout.tsx:43` | `persistOptions={{ persister, maxAge }}` | `persistOptions={{ persister, maxAge, buster: queryCacheBuster }}` |

## Out-of-scope confirmation

- **API-edge Zod validation**: untouched (deferred follow-up).
- **`muscles` type optionality**: type still says `string[]` — server contract preserved.
- **Pre-existing typecheck error in `tests/e2e/measurements.spec.ts`**: untouched (not introduced by this fix; lives in user's untracked measurements work).

## Decision

**pass** — automated gates green for the diff, fix is structurally sound (defensive reads + buster), adjacent surfaces compile and share the new pattern. User confirmed end-to-end on iOS native dev build post-deploy.

## Post-deploy manual verification

- **Verified by user on iOS native dev build (rebuilt via `expo run:ios --device` after the deploy)**: pass.
- Confirmation timestamp (BRT): 2026-05-20 01:11.
- User statement: "Fix confirmado".
- Cache buster behavior confirmed: first launch with previously-poisoned AsyncStorage discarded the stale blob (buster mismatch) and refetched; ExerciseBlock rendered without the red-box across History and Workout flows.
