# Reproduction — 2026-05-21_2155_volume-math-wrong

## Initial report

> "The volume count seems really wrong. We should debug it and fix it." (History screen, "THIS WEEK 26.2k kg")
>
> "Also, the calculation of the previous pr seems wrong. If I lifted 120kg for 8 reps in one set, it should already be 960, right?" (live workout, Bench Press "Volume to PR: 4.9k kg", Squat 5.8k kg, no sets logged)

## Refinement

Verbal report frames both symptoms as "math bugs". After querying the DB with the same kernel the strips use (`scripts/debug-weekly-volume.ts`), **both displayed values reproduce exactly**. The "wrong" feeling is downstream of a **definition mismatch**, not a calculation error. See diagnosis.md for the spec choices.

A side-finding emerged that IS a real bug but does NOT affect either reported symptom: 46 duplicate `(session_id, exercise_id, set_number)` tuples from the 2026-05-20 Strong import (root cause in `scripts/import-strong.ts:517-518`).

## Environment that triggers the bug

- Device / browser / build: Safari on iPhone (PWA / web build via Expo)
- OS / version: iOS (recent)
- System theme: dark (per screenshots)
- Auth state: signed-in as gsinacio94@gmail.com (`user_id = 0b2dfe22-2d30-41eb-bede-d7a42bc3651c`)
- Network: online
- DB load: 545 strong-tagged + 43 native sets in the trailing 8 weeks (~12k+ rows total in history)

## Affected screens (confirmed)

- `src/components/weekly-volume-strip.tsx:14-100` — weekly volume bars + "THIS WEEK" headline.
- `src/components/volume-target-slot.tsx:29-113` — per-exercise "Volume to PR" strip during a live workout.
- `src/utils/volume-target.ts:75-129` — `computeVolumeTarget` kernel (picks per-session max).
- `src/api/progress.ts:10-39` — `listSetsForExercise` (returns all finished sessions for the exercise).
- `src/api/stats.ts:18-33` — `listWeeklyVolumeRows` (range-bound weekly query).

## Steps to reproduce

### Symptom A — "THIS WEEK 26.2k kg"

1. Open History tab.
2. Observe "THIS WEEK" headline.
3. **Observed**: "26.2k kg" for week of 2026-05-18.
4. **Expected (user)**: a lower number that "feels right" for the week's work.

### Symptom B — "Volume to PR: 4.9k kg" (Bench Press)

1. Start a new live workout.
2. Add Bench Press (and Squat) — log zero working sets.
3. Observe the volume-target strip under each exercise.
4. **Observed**: Bench Press "Volume to PR: 4.9k kg"; Squat "Volume to PR: 5.8k kg".
5. **Expected (user)**: a number ≥ a single heavy set the user has done historically — e.g. ≥ 960 kg for Bench (one 120 × 8 set).

## Diagnostic output (independent recomputation)

`scripts/debug-weekly-volume.ts` (read-only, service role) was run on 2026-05-21 21:46 BRT. Excerpt:

| Week (Mon)      | Total kg | Note |
| --------------- | -------- | ---- |
| 2026-W14 Mar 30 | 7.01k    |      |
| 2026-W15 Apr 06 | 15.76k   |      |
| 2026-W16 Apr 13 | 28.42k   |      |
| 2026-W17 Apr 20 | 27.92k   |      |
| 2026-W18 Apr 27 | 48.45k   |      |
| 2026-W19 May 04 | 29.32k   |      |
| 2026-W20 May 11 | 49.70k   |      |
| 2026-W21 May 18 | **26.21k** | matches displayed "26.2k kg" |

W21 breakdown by session (4 sessions, 48 contributing sets):

| Session             | Source | Sets | Total kg |
| ------------------- | ------ | ---- | -------- |
| Deadlift (5/18)     | strong | 11   | 4 477    |
| (unnamed) (5/19)    | native | 5    | 2 664    |
| Peitchola (5/20)    | native | 16   | 8 172    |
| Leggiday (5/21)     | native | 16   | 10 897   |
| **Total**           |        | 48   | **26 210** |

No sets with weight > 500 kg, no sets with reps > 100. No NULL completed_at within the visible window.

## Visual evidence

- `docs/runs/2026-05-21_2123_volume-bugs-evidence/README.md` — captured values from both user screenshots.
- (PNGs themselves drop-pending in that folder; numerical values are captured in the README.)

## Status

- Repro determinístico: **yes** (diagnostic numerically reproduces the on-screen values).
- Visual evidence obtained: **yes** (numerical capture; PNGs to be dropped by user when convenient).

## Open questions

1. **For the user**: what definition of "Volume to PR" would feel right? Options live in `diagnosis.md`.
2. **For the user**: 26.21k for W21 is the true DB sum. Does this still feel wrong, and if so, what would you expect instead (e.g. last-7-days rolling? exclude Strong-imported?)?
3. **For the user**: queue a separate run to fix the `import-strong.ts` set_number collisions?
