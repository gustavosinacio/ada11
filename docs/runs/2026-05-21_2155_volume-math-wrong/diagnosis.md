# Diagnosis — 2026-05-21_2155_volume-math-wrong

## Hypothesis (state BEFORE searching)

Given the user report, the most likely cause is either (a) Strong-imported rows double-counted, (b) warmups leaking through the filter, or (c) bodyweight rows with weight=1 inflating totals.

## Evidence

### Source-of-truth files (verified by reading)

- `src/utils/volume-target.ts:48-59` — `sumVolume` kernel: skips warmups, parses string weights with `parseFloat`, guards `w > 0 && r > 0`. Correct.
- `src/utils/volume-target.ts:75-129` — `computeVolumeTarget`: iterates `pastSessions[]` (returned by `listSetsForExercise`) and sets `previousMaxKg = max(sumVolume(session.sets))`. **Definition = per-SESSION max.**
- `src/api/progress.ts:10-39` — `listSetsForExercise`: filters `deleted_at IS NULL`, `sessions.ended_at IS NOT NULL`. Sets the current (in-progress) session is excluded. Correct.
- `src/api/stats.ts:18-33` — `listWeeklyVolumeRows`: filters `deleted_at IS NULL`, `sessions.ended_at IS NOT NULL`, `set_type != "warmup"`, `completed_at >= sinceUtc`. Correct.
- `src/components/weekly-volume-strip.tsx:43-51` — bucketing: iterates the rows, parses weight, guards `w > 0 && r > 0`. Same kernel as `sumVolume`. Correct.
- `scripts/debug-weekly-volume.ts` output reproduces both displayed values exactly. No double-counting, no warmup leak, no weight=1 inflation observed in the user's data.

### Candidate locations affected by the same root cause

| File:Line | Token / pattern | Context | Severity |
|---|---|---|---|
| `src/utils/volume-target.ts:80-86` | `for (const session of pastSessions) { ... previousMaxKg = max(...) }` | per-SESSION definition; user expected per-SET or a lower floor | major (spec) |
| `src/components/volume-target-slot.tsx:74` | label `"Volume to PR: "` | label does not disambiguate "best session" vs "best set" | minor (copy) |
| `scripts/import-strong.ts:517-518` | `parseInt(r[H.setOrder] ?? "1", 10)` → fallback 1 | data-integrity, NOT the symptom — but a real bug worth a separate run | major (data) |

### Cross-environment confirmation

Both symptoms reproduce numerically against the production DB using the exact same kernels the screens use. No environment specificity (web vs native, Safari vs Chrome) is relevant — this is server-side data being summed deterministically on the client.

## Root cause

**Symptom A (weekly total = 26.2k):** No code-side root cause. The display is the exact `Σ(weight*reps)` over finished, non-warmup, non-deleted sets in the current ISO week. **The math is correct.**

**Symptom B (Volume to PR Bench = 4.9k):** No code-side root cause. The display is the max single-session volume for Bench Press across the user's full finished history. **The math is correct given the per-session definition.** The user's mental model is per-set (a single 120 × 8 = 960 set should "count"); the code's spec is per-session.

**Side-finding (Strong set_number duplicates):** Root cause = `scripts/import-strong.ts:517` falls back to `set_number = 1` when `r["Ordem da série"]` is missing/empty. Strong's CSV emits blanks in this column in certain situations (likely dropsets / failed sets / partial workouts). 46 rows in the user's data currently violate the implied unique-key `(session_id, exercise_id, set_number)`. Does NOT affect volume math; affects set numbering display, "Anterior" column, progress-page ordering.

## Severity classification

- **Blocker** — none. No data-affecting / user-affecting code bug found for the reported symptoms.
- **Major**
  - `src/utils/volume-target.ts:80-86` — spec mismatch on "Volume to PR". User-facing UX issue. Requires product decision before code change.
  - `scripts/import-strong.ts:517-518` — data-integrity bug already in 46 user rows. Affects set-numbering UI elsewhere. Queue a separate bug-fix run.
- **Minor (out of scope here)**
  - `src/components/volume-target-slot.tsx:74` — copy ambiguity; revisit if the spec changes.

## Symptom-only fix risk

If we shipped a "fix" without resolving the spec choice (e.g. arbitrarily switched the definition to per-set max), we'd ship a different number that may or may not match the user's intuition — and may break the design intent of run `2026-05-21_1505_exercise-volume-target`. **Spec decision must come from the user.**

## Spec options for "Volume to PR"

1. **Single-set max** — `previousMaxKg = max(w*r)` over all individual past sets (skip warmups). With a 120 × 8 set logged, floors at 960. Matches user's stated intuition.
2. **Single-session max** *(current ship)* — best whole-session volume. Hardest target.
3. **Rolling N-session average max** — average best of last 3-5 sessions. Smoother target.
4. **"Last session" volume** — what you did last time; "beat your last workout". Common in apps like Strong.
5. **Multi-metric strip** — show Max-session-volume + Current-session-volume + Reps-to-PR alongside each other (the user's open feature-list item #6 already hints at this). Removes ambiguity.

## Recommendation

Stop the implementation phase. Two follow-ups:

- **Run 1 (this concern, reclassified as feature)**: redefine the "Volume to PR" surface using whichever spec the user picks. May fold into the user's already-open backlog item #6 ("show Max volume + Current session volume alongside Volume to PR").
- **Run 2 (separate bug-fix)**: `import-strong.ts:517` set_number fallback. Backfill existing 46 duplicate-key rows by re-numbering within `(session_id, exercise_id)` ordered by `completed_at, created_at`.

The weekly total likely needs no change once the user sees the per-session breakdown above.
