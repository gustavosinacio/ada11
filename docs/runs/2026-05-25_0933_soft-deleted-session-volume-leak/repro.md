# Reproduction — 2026-05-25_0933_soft-deleted-session-volume-leak

## Initial report

> adding a session then removing it still makes the volume of that session
> count towards the total week volume. Why is this happening? How can we
> fix it?

## Refinement (Reproducer-mode work)

The verbal report names ONE surface ("total week volume") but the underlying
defect — three Supabase SELECT call sites that join `sets → sessions!inner`
without filtering on `sessions.deleted_at` — actually leaks into every UI
that derives anything from past finished-session sets. The reproducible
bug class is broader than the user wording suggests:

- **`listWeeklyVolumeRows`** (`src/api/stats.ts:29` SELECT; used by both
  branches at `:53` and `:76`) feeds `useLifetimeWeeklyVolume`, which is
  consumed by:
  - Progress hero (`Max · Now · To PR`) via `useCurrentWeekVolume` /
    `useLifetimeBestWeek` / `usePrsThisWeek`.
  - Weekly Volume Strip on Progress AND on History (`src/components/
    weekly-volume-strip.tsx:82`).
  - Exercises-this-week list (`useExercisesThisWeek` →
    `<ExercisesThisWeekList>`).
  - End-of-session verdict PR detection
    (`app/(app)/workout/verdict/[sessionId].tsx:46`).
  - History weekly summary (`SessionSummaryRow` totals via
    `groupSessionVolumes`).
  - Week drill-down page (`app/(app)/history/week/[isoWeek].tsx:53`).
- **`listSetsForExercise`** (`src/api/progress.ts:13`) feeds
  `useExerciseProgress`, consumed by:
  - Per-exercise progress chart (`app/(app)/exercises/[id]/progress.tsx:45`).
  - `<VolumeTargetSlot>` "chase your best session" target
    (`src/components/volume-target-slot.tsx:37`).
- **`getLastWorkingSetForExercise`** (`src/api/sets.ts:187`) feeds
  `useLastWorkingSet`, used by `<ExerciseBlock>` as the auto-fill
  placeholder for the next working set in a live session
  (`src/components/exercise-block.tsx:114`).

The Conductor's pre-diagnostic (three missing
`.is("sessions.deleted_at", null)` filters at those exact three call sites)
matches what I find independently — `grep -rn 'from("sets"' src/` yields
14 query sites; only those three join `sessions!inner`. The other 11 sets
queries are either single-session-scoped (so the session is already known
non-deleted before the query) or pure UPDATE/INSERT.

A second, secondary defect surfaced while running the repro:
`useSoftDeleteSession` (`src/hooks/use-sessions.ts:114-124`) invalidates
`["sessions"]`, `["sessions","active"]`, and `["stats"]`, but NOT
`["progress"]`. So even after the three SELECTs are fixed, the per-exercise
progress chart and `<VolumeTargetSlot>` will still render stale until the
next manual refetch / cold cache. Flag for the Diagnostician — strictly
this is in scope of "the deleted session's volume keeps showing up".

## Environment that triggers the bug

- Device / browser / build: web (`expo start --web`, Chromium via
  Playwright) running on `localhost:8081`.
- OS / version: macOS 25.2.0 (Darwin); browser = Playwright-bundled
  Chromium 1.59.1.
- System theme: light (the repro screenshots are in light mode; theme is
  orthogonal to the bug — pure data-layer leak).
- Auth state: signed-in confirmed user, freshly created per test via the
  Supabase admin API.
- Network: online; Supabase project at `EXPO_PUBLIC_SUPABASE_URL`.

Native (iOS/Android) was not exercised, but the bug is in
`src/api/{sets,stats,progress}.ts` — shared by every platform. There is no
platform-specific filter elsewhere that would mask the leak on native.

## Affected screens (confirmed)

- `app/(app)/progress/index.tsx` — Progress hero (`Max · Now · To PR`),
  Weekly Volume Strip, Exercises-this-week list. All confirmed leaking in
  screenshot `03-progress-after-delete.png`.
- `app/(app)/history/index.tsx:1-70` — History list header
  (`WeeklyVolumeStrip` at `:55`). Confirmed leaking in screenshot
  `06-history-survivor-after-delete.png` (THIS WEEK = 1,600 kg even though
  only the 100 kg survivor session is in the list below).
- `app/(app)/history/week/[isoWeek].tsx:53` — week drill-down (same
  `useLifetimeWeeklyVolume` dependency; not screenshotted but identical
  data path).
- `app/(app)/workout/verdict/[sessionId].tsx:46` — end-of-session verdict
  PR detection (`useLifetimeWeeklyVolume`; not screenshotted because
  triggering a verdict screen for a deleted session is contrived, but the
  data path is the same).
- `app/(app)/exercises/[id]/progress.tsx:45` — per-exercise progress chart
  (`useExerciseProgress` → `listSetsForExercise`; not screenshotted but
  data path confirmed).
- `src/components/volume-target-slot.tsx:37` — "chase your best session"
  target (`useExerciseProgress`; same).
- `src/components/exercise-block.tsx:114` — auto-fill placeholder for
  next working set in a live session
  (`useLastWorkingSet` → `getLastWorkingSetForExercise`; same).

## Steps to reproduce

### Variant A — single-session user (Progress page)

1. Create a confirmed user (`tests/e2e/weekly-volume-strip.spec.ts:47-56`
   pattern).
2. Seed ONE finished session in the current ISO week via admin API:
   - Started 1h ago, ended now, `ended_at` non-null, `deleted_at` null.
   - 5 sets × 100 kg × 3 reps on the seed exercise = 1,500 kg.
3. Sign in via UI, navigate to `/progress`, wait for hydration.
4. **Baseline screenshot**: `screenshots/01-progress-before-delete.png` —
   hero reads `Max 1,500 kg · Now 1,500 kg · To PR 0 kg`; THIS WEEK card
   reads `1,500 kg`; strip shows a bar at `5/25`; LEGS list shows
   `Back Squat · Best session 1,500 kg · Now 1,500 kg`.
5. Soft-delete the session via admin
   (`UPDATE sessions SET deleted_at = now() WHERE id = …`) — equivalent
   to the user tapping "Delete workout" on the History detail screen
   (`app/(app)/history/[id].tsx:155`) or "Cancel workout" on the live
   workout screen (`app/(app)/workout/[sessionId].tsx:369`). Both wire
   to `useSoftDeleteSession` → `softDeleteSession` in `src/api/
   sessions.ts:115-121`.
6. Clear the persisted TanStack cache
   (`localStorage.removeItem("ada11-query-cache")`) + reload, to defeat
   any client cache and force a fresh fetch.
7. Navigate back to `/progress`.
8. **Observed** (`screenshots/03-progress-after-delete.png`): the page
   renders **identically** to step 4. Every surface still counts the
   1,500 kg from the deleted session. Playwright assertion confirmed:
   `Progress page still shows '1,500 kg' after soft-delete? true`.
9. **Expected**: hero should read `Max 0 kg · Now 0 kg · To PR 0 kg`,
   THIS WEEK card should disappear (strip returns null when all buckets
   are zero — `src/components/weekly-volume-strip.tsx:99-102`), LEGS
   list should be empty.

### Variant B — survivor + deleted session (History page)

1. Steps 1-2 as above, but seed TWO sessions:
   - Survivor (earlier today): 1 set × 100 kg × 1 rep = 100 kg.
   - Doomed (later today): 5 sets × 100 kg × 3 reps = 1,500 kg.
   - Total before delete = 1,600 kg.
2. Sign in, navigate to `/history`.
3. **Baseline screenshot**:
   `screenshots/05-history-survivor-before-delete.png` — THIS WEEK reads
   `1,600 kg`, two `Workout` rows under it.
4. Soft-delete the doomed session via admin.
5. Clear cache + reload + navigate to `/history`.
6. **Observed** (`screenshots/06-history-survivor-after-delete.png`):
   THIS WEEK card STILL reads `1,600 kg`, but the session list under it
   shows only the survivor row (`Workout · Mon, May 25 · 1h 0m · 100 kg`)
   — a side-by-side contradiction in the same screen. Playwright
   assertion: `History strip still shows '1,600 kg' after delete? true`.
7. **Expected**: THIS WEEK should read `100 kg` (only the survivor).

### Why two variants

Variant A originally also captured `/history` (screenshot
`04-history-after-delete.png` shows "No sessions yet"). That was a false
negative: `app/(app)/history/index.tsx:45-50` short-circuits to the
empty state when `useSessions` returns zero rows, which hides the strip
entirely. Variant B forces the strip to render and proves the leak is
present there too — the empty-state short-circuit was masking, not
fixing, the bug.

## Visual evidence

All paths absolute:

- `/Users/gustavoinacio/github/ada11/docs/runs/2026-05-25_0933_soft-deleted-session-volume-leak/screenshots/01-progress-before-delete.png`
  — baseline Progress page with seeded 1,500 kg session.
- `/Users/gustavoinacio/github/ada11/docs/runs/2026-05-25_0933_soft-deleted-session-volume-leak/screenshots/02-history-before-delete.png`
  — baseline History page (single seeded session).
- `/Users/gustavoinacio/github/ada11/docs/runs/2026-05-25_0933_soft-deleted-session-volume-leak/screenshots/03-progress-after-delete.png`
  — **bug evidence**: Progress page still shows 1,500 kg everywhere after
  soft-delete + cache clear + reload.
- `/Users/gustavoinacio/github/ada11/docs/runs/2026-05-25_0933_soft-deleted-session-volume-leak/screenshots/04-history-after-delete.png`
  — History collapses to "No sessions yet" empty state (false negative;
  see Variant B rationale above).
- `/Users/gustavoinacio/github/ada11/docs/runs/2026-05-25_0933_soft-deleted-session-volume-leak/screenshots/05-history-survivor-before-delete.png`
  — baseline History with two seeded sessions (1,600 kg total).
- `/Users/gustavoinacio/github/ada11/docs/runs/2026-05-25_0933_soft-deleted-session-volume-leak/screenshots/06-history-survivor-after-delete.png`
  — **bug evidence**: History strip still shows 1,600 kg after deleting
  the 1,500 kg session, even though the session list below correctly
  shows only the surviving 100 kg session.

## Status

- Repro determinístico: yes — both Playwright variants reproduce 100 %
  of the time. Tied to the SELECT shape, not to any race.
- Visual evidence obtained: yes — 6 screenshots (4 directly relevant, 2
  contextual baselines).

## Open questions (if any)

1. **Should `useSoftDeleteSession.onSuccess` invalidate `["progress"]`
   too?** Today it invalidates `["sessions"]`, `["sessions","active"]`,
   `["stats"]`. The per-exercise progress chart and `<VolumeTargetSlot>`
   read through `["progress", exerciseId]` (`use-progress.ts:7`), which
   would stay stale until next mount / manual refetch. The three-SELECT
   fix below cures the cold path; this invalidation gap is the
   warm-cache equivalent. Diagnostician should call this in or out of
   scope explicitly.
2. **Should `useDeleteSet` / `useUpdateSet` / `useRemoveExerciseFromSession`
   also invalidate `["progress"]`?** Same logic — set-level edits inside
   a finished session change `listSetsForExercise` output but
   `["progress"]` is only invalidated on the per-session cache. Out of
   scope for the verbal report ("removing a session") but worth flagging
   so the Diagnostician can rule it in or out.
3. **`getLastWorkingSetForExercise` (`src/api/sets.ts:182-203`)** — the
   auto-fill placeholder reads "most recent completed working/dropset
   from a finished session" and would happily return a set whose parent
   session is soft-deleted. This is the lowest-visibility leak (no
   number on screen, just a wrong placeholder) but is part of the same
   defect class. Worth a single regression assertion in the eventual
   test.
