# Transcript — 2026-05-20_2034_soft-deleted-exercises-in-history

### 2026-05-20 20:34 BRT — Conductor (setup)
- Run folder initialized. Branch `main`, baseline `52d7a76`. Budgets reset.

### 2026-05-20 20:35 BRT — Conductor → Discovery
- **Inputs**: run-id, prompt verbatim, instructions to enumerate `useExercises`/`useExercise` consumers, decide pattern (a/b/c), check weekly-volume-strip + week drill-down for name lookups.
- **Returned**: `done`. Bug isolated to `history/[id].tsx:41` (shares `useExercises()` with picker). Affected history surfaces enumerated: `history/[id].tsx`, `workout/[sessionId].tsx`, `exercises/[id]/index.tsx` (edit), `exercises/[id]/progress.tsx` (header title). Unaffected (verified): `weekly-volume-strip.tsx` (no name lookup, pure volume sum), `history/week/[isoWeek].tsx`, `session-summary-row.tsx`, `history/index.tsx`. Picker/library correctly stays on filtered call (3 ExercisePicker callers + Exercises library list). `sets.exercise_id` FK is `RESTRICT` so soft-deleted exercises are guaranteed re-readable. Adjacent finding: `routine-exercises.ts:19` joins `exercise:exercises(*)` without filtering — flagged, out of scope. Recommend pattern (a) `useAllExercises()`/`listAllExercises()` — matches codebase convention of one-function-per-filter-shape (closest precedent: `use-sets.ts` two-hook split). Critical contract: new `["exercises", "all"]` key must be invalidated by all 3 mutations in `use-exercises.ts:32-62`.
- **Conductor decision**: Route to Designer (D↔V r1).
