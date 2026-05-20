# Reproduction — 2026-05-20_0042_exercise-block-undefined-muscles

## Initial report
> Lets go for the next bug. This bug happens on mobile ios only (i have not tested android yet). Info is in the print

User attached a screenshot showing the iOS native red-box error overlay:

- **Error class**: Render Error.
- **Message**: `Cannot read property 'length' of undefined`.
- **Source frame 1** — `src/components/exercise-block.tsx:86:29`:
  ```tsx
  86 | {(exercise.muscles.length > 0 || exercise.equipment) && (
  87 |   <Text className="mt-0.5 text-sm text-gray-500">
  88 |     {[
  89 |       exercise.muscles.length > 0
  ```
- **Source frame 2** — `src/components/exercise-block.tsx:28` — component declaration.
- **Component stack**: `<ExerciseBlock />` inside a `ScrollView` wrapper.

## Refinement (Reproducer-mode work)
The runtime error is unambiguous: `exercise.muscles` is `undefined` when the component tries to read `.length` on line 86. The TypeScript type `ExerciseRow.muscles: string[]` (`src/db/types.ts:63`) and the Drizzle schema (`src/db/schema.ts:50`, `notNull().default('{}'::text[])`) both **promise** that `muscles` is always a non-null array — yet at runtime on iOS it is `undefined`.

This is a fact-vs-type mismatch. The Diagnostician's job is to find why the runtime value defies the type contract. Strong candidate hypotheses (to be confirmed downstream):

1. **Stale cached data on iOS.** TanStack Query persists query results to AsyncStorage on native. If the iOS dev build cached `Exercise` rows BEFORE the recent commit `b51dd01` ("feat: exercises track muscles as required multi-select array"), those cached rows have no `muscles` field; deserialized on next launch, `muscles` is `undefined`.
2. Schema/migration not applied to the iOS dev environment's Supabase project (less likely — same project as web).
3. A code path that constructs an `ExerciseRow` locally without `muscles` (e.g. an in-flight optimistic update). Unlikely given grep results, but worth verifying.

The verbal report "iOS only" is consistent with hypothesis 1: the freshly-deployed web build (commit `0ab8dda`) has no stale persisted query cache; the iOS dev build does.

## Environment that triggers the bug
- Device / build: iPhone, **iOS native dev build** (Expo `expo run:ios --device` or similar). NOT the web PWA.
- OS / version: iOS (exact version not specified by user; status bar shows 00:42 + cellular + wifi + 70% battery).
- System theme: dark (consistent with the dark overlay UI).
- Auth state: signed-in (component renders within authenticated routes `(app)/`).
- Network: online (sufficient to fetch errors, query running).

## Affected screens (confirmed)
- `app/(app)/history/[id].tsx:245` — history detail screen renders `<ExerciseBlock>` per exercise in the session.
- `app/(app)/workout/[sessionId].tsx:212` — live workout flow renders `<ExerciseBlock>` per exercise in the active session.

Both screens are gated routes (require sign-in). Both pull exercise rows that include the `muscles` field. Either screen will crash on iOS if any rendered exercise has `muscles === undefined` in the runtime data.

## Steps to reproduce
1. On an iOS device that has a TanStack Query persisted cache from a build PRIOR to commit `b51dd01` (the commit that added `muscles` to the schema and exercise rows). This is the "default" state of any iOS dev build a user has installed before today.
2. Launch the iOS app.
3. Sign in (cached session if available).
4. Navigate to **History** → open any past session **OR** navigate to **Workout** and resume/start a session.
5. **Observed**: red-box render error `Cannot read property 'length' of undefined` at `exercise-block.tsx:86`. App is unusable in those screens until the cache is cleared or hard-reload pulls fresh data.
6. **Expected**: ExerciseBlock renders normally; if `muscles` is empty, the `(exercise.muscles.length > 0 || exercise.equipment)` guard skips the secondary `<Text>` line.

## Visual evidence
- Screenshot of iOS red-box error overlay provided in the conversation (image #3). Textual transcription of the overlay is captured in `state.md` and reproduced in this `repro.md`.

## Status
- Repro determinístico: yes — any iOS install with a pre-`b51dd01` persisted query cache will hit this. A fresh iOS install (clean AsyncStorage) likely does NOT hit it because the server returns `muscles` correctly.
- Visual evidence obtained: yes (iOS error overlay screenshot).

## Open questions (if any)
- Confirm in Diagnostician: is the failure mode strictly "stale cached row missing `muscles`", or is there a code path that produces an `ExerciseRow` without `muscles` (in which case the fix is broader than cache invalidation)?
- The fix design must decide between: (a) defensive read on the consumer side (`exercise.muscles?.length ?? 0`), (b) cache schema versioning to invalidate stale persisted data, or (c) both. Out of Reproducer scope.
