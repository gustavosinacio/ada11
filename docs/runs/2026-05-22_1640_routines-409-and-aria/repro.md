# Reproduction — 2026-05-22_1640_routines-409-and-aria

## Initial report

(From `docs/features.md` BUG entry — verbatim in `state.md` §Bug report.)

## Refinement

Two distinct issues fired simultaneously when the user was on `/routines/{id}` and tapped exercises to add to the routine. Both are web-only (RN-Web).

## Environment that triggers the bug

- Device / browser: web (Safari and any browser that emits aria-hidden focus warnings)
- OS: irrelevant — the symptom is in the DOM markup that RN-Web generates
- System theme: dark (per the user's screenshot CSS class — `dark:`)
- Auth state: signed-in
- Network: online

## Affected screens (confirmed)

- `app/(app)/routines/[id]/index.tsx:262-274` — mounts `<ExercisePicker>` modal and wires `onPick` → `addEx.mutateAsync`.
- `src/components/exercise-picker.tsx:93-105` — `<Pressable>` per exercise row in the picker; no in-flight guard.
- `src/components/routine-list-item.tsx` — the "Edit" button that retained focus when the user navigated from the workout tab.

## Steps to reproduce

### Bug 1 — 409 Conflict (quick-tap race)

1. Open `/routines/{id}` (any routine).
2. Tap "Add exercise" → exercise picker modal opens.
3. **Tap an exercise twice in quick succession** (or tap two different exercises before the first POST returns).
4. **Observed**: 1-4 `POST .../rest/v1/routine_exercises` returning 409 with `code: '23505'` (`routine_exercises_routine_position_uq` violation). All inserts beyond the first compute the same `MAX(position) + 1` and collide.
5. **Expected**: only the first tap inserts; subsequent taps are no-ops or queue serially.

### Bug 2 — aria-hidden focus warning

1. Open workout tab → tap "Edit" on a routine card → navigates to `/routines/{id}` (Edit button retains focus).
2. On `/routines/{id}`, tap "Add exercise" → picker modal opens.
3. **Observed**: React/RN-Web emits `Blocked aria-hidden on an element because its descendant retained focus.`
4. **Expected**: focus moves into the modal (or away from the prior screen's button) before `aria-hidden="true"` is applied to the backdrop.

## Visual evidence

- Console output captured verbatim in `state.md`.

## Status

- Repro determinístico: yes for Bug 1 (quick double-tap is reliable); yes for Bug 2 (Edit → navigate → open picker triggers it consistently).
- Visual evidence obtained: n/a (console logs are the evidence).

## Open questions

None — both root causes were identified during file reading.
