# Features

[ ] Soft-deleted exercises should remain fully visible in past workout history (sessions, sets, totals, weekly volume aggregates) — only the exercise picker and the Exercises library list should exclude them. Today the history detail filters via the same `useExercises()` query the picker uses (`app/(app)/history/[id].tsx:93,99-104`), so `ExerciseBlock`s for soft-deleted exercises silently disappear while the session header keeps counting their sets toward volume — visible inconsistency. Fix likely needs a separate "include deleted" query/hook for history surfaces, leaving the picker on the current filtered call.

## Done

[x] Allow user to remove exercise from current session in progress.
[x] Measurements screen does not need to live on the bottom bar. It can be moved to the profile page as a button in the page itself
[x] Tela de iniciar treino pode ser unificada com a tela de rotinas, como no strong
[x] when clicking on the measurements, we should see a screen to view what was measured, and then go to the edit measurements when i press an "Edit" button
[x] measurements screen should show a graph to represent progress
[x] history graph for the week needs a click functionality, where i'll see a more detailed view of my progress history
[x] when clicking on an exercise, i want to see a progress graph showing important info
