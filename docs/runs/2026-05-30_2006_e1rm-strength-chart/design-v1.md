# Design v1 — e1RM strength-progress chart (Phase 2a)

Run: `2026-05-30_2006_e1rm-strength-chart`
Author: Designer
Round: Design↔Validate 1
Baseline: `main @ 3c00d8e` (Phase 0 bodyweight kernel + Phase 1 weekly per-muscle chart). Verified HEAD = baseline; tree clean (Discovery §intro).

---

## 1. Approach + why

Mirror the just-shipped Phase-1 muscle chart **1:1**, swapping muscle-bucketing for per-exercise best-e1RM and the fixed muscle palette for a dynamic top-N palette. The triad is the established Progress-chart pattern (Discovery §"Relevant conventions"):

```
pure presenter            section component                  test pair
src/utils/e1rm-strength.ts ⟷ src/components/                ⟷ tests/unit/e1rm-strength.test.ts
                              e1rm-strength-section.tsx          tests/e2e/e1rm-strength.spec.ts
```

- **Reuse `<MultiSeriesChart>` AS-IS** (Decision #5). It is agnostic to whether the lines are muscles or exercises; it consumes `{label,color,values,visible}[]` + `xLabels[]`. The muscle section is a working proof.
- **Reuse `epley1RM`** as the single 1RM seam — never re-inline `* (1 + reps/30)`. Discovery's close-the-set grep (§1) proves there are **exactly 2 e1RM sites in production**: the helper `epley1RM` (`formulas.ts:1-5`, `K0`) and its one caller `progress.tsx:157` (`K1`). The new presenter becomes the **3rd** site and the **2nd caller** — it calls `epley1RM`, adding no formula duplication. (Inventory + close-the-set discipline: §9.)
- **e1RM is a PEAK metric → MAX, not SUM.** The single material algorithmic divergence from the muscle presenter (which does `+=`). Per (exercise, week) we take `max(epley1RM(w, r))` across the week's working sets. Called out as **Invariant E1** below.
- **Logged weight only (Invariant D).** Guard `w > 0 && r > 0` on `w = row.weight ? parseFloat(row.weight) : 0`. NOT `effectiveWeightKg`. A bodyweight-only exercise (every set `weight=0`) yields an all-zero series → dropped → no line. A Pull-up logged with *added* weight (`weight>0`) DOES plot — correct.
- **Per-WEEK x-axis** (Decision #1), reusing the muscle chart's shared contiguous week axis verbatim. The only shape that aligns multiple exercises on `<MultiSeriesChart>`'s shared index without extending the component.
- **Untrained-week rendering = carry-forward (LOCF), not zero-fill** (Decision #7). This is the subtlest call and the one place the muscle chart's zero-fill assumption would *misrepresent* e1RM. Detailed below; flagged for the Validator as the hardest point.

The page change is a one-line JSX insert + import (the section owns its own hook + memo, like `<WeeklyMuscleVolumeSection>`).

---

## 2. Decision log — all 9 Discovery unknowns

### Decision #1 — x-axis granularity: **per-WEEK** (best-e1RM per (exercise, week))
- **Choice**: per-week, reusing the muscle chart's shared contiguous ISO-week axis (`isoWeeksBetween(firstTrainedMonday, currentMonday)`).
- **Rationale**: `<MultiSeriesChart>` requires a SHARED `xLabels` index across all series and draws straight lines between *adjacent indices* (`:84-87`, `:134-148` — no date interpolation). Per-SESSION axes for different exercises don't align (A trained Mon, B trained Wed) — a per-session union-of-dates axis would need per-series gap/zero handling the component does not provide and would force a component extension. Per-week is the only shape that fits reuse-as-is. It also matches the volume chart's x-axis, so the two adjacent trend charts read consistently ("strength complement to the volume chart").
- **Rejected**: per-session axis (the prompt offers it). Rejected because it breaks the shared-index contract and forces either a `<MultiSeriesChart>` extension (prompt says "strongly prefer reuse") or a misaligned multi-exercise plot. The single-exercise screen (`progress.tsx`) keeps per-session because it plots ONE exercise (no alignment problem) — that divergence is intentional and stays.

### Decision #2 — "most-performed" ranking: **distinct sessions, top N=5, tie-break recent→name**
- **Metric**: distinct sessions the exercise appears in — `Map<exercise_id, Set<session_id>>`, rank by `.size` DESC. Matches "sessions/sets appeared in" and the intuitive "most-performed" (an exercise done across 12 sessions beats one done 30 sets in 1 session).
- **N = 5**. Reuses the `TOP_N = 5` precedent on the Progress page (`progress-hero.tsx:24`). Keeps the chart legible — 5 lines is the readable ceiling for a small mobile multi-line SVG; the palette (Decision #4) has ≥8 distinct hues, so 5 is comfortably inside it.
- **Eligibility (CRITICAL)**: rank ONLY over exercises that would actually plot an e1RM line — i.e. exercises with **≥1 working set having `weight>0 && reps>0`**. A bodyweight-only exercise (all sets `weight=0`) can NEVER plot under Invariant D, so it must NOT consume a top-N slot (otherwise a user whose most-frequent movement is Push-ups would silently lose a chart line to an invisible series). Compute an `eligible` set first: an `exercise_id` is eligible iff at least one of its rows passes `w>0 && r>0`. Rank only eligible exercises. This subsumes the "drop all-zero series" rule (Decision #5/§Invariant D) into the ranking so N counts only plottable lines.
- **Tie-break (deterministic)**: (1) distinct-session count DESC; (2) most-recent activity DESC (max `completed_at` for that exercise); (3) exercise **name** ASC (`localeCompare`); (4) `exercise_id` ASC as a final total-order guarantee. No `Map`-iteration-order reliance — the comparator is a total order, so the result is stable regardless of input order (deterministic-tests rule, `~/.claude/CLAUDE.md`).
- **Dangling / soft-deleted exercise_ids**: skip rows whose `exercise_id` is not in the library (mirror `weekly-muscle-volume.ts:95-96`, `use-progress-page.ts:316-321`). Soft-deleted-but-historically-performed exercises ARE in `useAllExercises` (`allIncludingDeleted` key) → they resolve a name and remain eligible (their e1RM history is real). A truly dangling id (not in lib at all) is skipped before ranking, so it can't win a slot.
- **Rejected**: rank by raw set count (a high-volume single session would outrank a consistently-trained movement — less aligned with "most-performed over time"); N=7 (matches the muscle palette length but crowds a phone-width chart). N=5 chosen.

### Decision #3 — bodyweight-only handling: **drop via the logged-weight `w>0` guard + eligibility filter**
- Folded into Decision #2's eligibility filter and Invariant D. `epley1RM(0, r) === 0` (`formulas.ts:2`); a series with every week 0 is dropped (mirror `weekly-muscle-volume.ts:120`); and an ineligible exercise never reaches the top-N. Net: bodyweight-only movements produce no e1RM line and don't steal a slot.
- **Rejected**: equipment-based exclusion (`equipment === "bodyweight"`). Rejected — the gate is the *logged-weight* value, not the equipment label: a `bodyweight`-equipment Pull-up logged with `weight=20` (added load) IS a real weighted movement and SHOULD plot. Equipment-based exclusion would wrongly drop it. (Same reasoning the kernel uses: the canonical gate is `w>0`, not the equipment string — `stats.ts:26-28`.)

### Decision #4 — dynamic color assignment: **palette-by-rank-index**
- An ordered hex array indexed by top-N rank position (rank 0 → palette[0], …). Deterministic given the deterministic ranking (Decision #2). `<MultiSeriesChart>` is unaffected (caller-side only).
- **Palette** (8 hues; lifts the muscle palette's hexes, reordered for max adjacent-line contrast, drops the gray "Other" which has no meaning here):
  ```ts
  const E1RM_PALETTE = [
    "#ef4444", // red-500
    "#3b82f6", // blue-500
    "#10b981", // emerald-500
    "#f59e0b", // amber-500
    "#8b5cf6", // violet-500
    "#ec4899", // pink-500
    "#06b6d4", // cyan-500
    "#84cc16", // lime-500
  ] as const;
  const colorForRank = (i: number): string =>
    E1RM_PALETTE[i % E1RM_PALETTE.length]!;
  ```
- **N vs palette length**: N=5 ≤ 8, so wrap never triggers in this run; `% length` is a defensive guard so a future N bump can't crash. Documented behavior: wrap (re-use a hue) rather than cap, so the contract degrades gracefully.
- **Determinism**: color is bound to **rank index**, and rank is a total order (Decision #2), so the same data always yields the same exercise→color mapping. The section keys the chart series by exercise `id` (not name) to keep the mapping stable across renames (see §3 section contract).
- **Rejected**: hashing exercise id → hue (non-deterministic-looking, risk of near-identical adjacent hues, harder to test); keeping the muscle `Record<key,color>` (keys on a fixed muscle enum — cannot key arbitrary exercise ids, Discovery §2 FLAG).

### Decision #5 — `<MultiSeriesChart>` reuse: **AS-IS, no extension**
- Confirmed reusable as-is (Discovery §2, HIGH). e1RM-per-exercise series are kg-valued numeric lines over a shared axis — structurally identical to the muscle-volume series. Props `{label,color,values,visible}` + `xLabels` fit exactly. **No extension.**
- The two known cosmetic limits are *accepted, not fixed* this run: (a) y-min pinned to 0 → e1RM delta visually compressed (Decision #7-below / Unknown #7); (b) no gap support → handled by the LOCF presenter choice (Decision #7-untrained), NOT by a component change. See "Why NOT extend the chart for gaps" below.
- **Rejected**: extending `<MultiSeriesChart>` to (a) accept a non-zero y-min, or (b) accept `null`/`NaN` "gap" values that skip a point. Both rejected this run — the prompt mandates "strongly prefer reuse," the muscle chart accepted the same y-min limit, and the LOCF presenter solves the untrained-week problem entirely caller-side without touching the shared component (which the muscle section also depends on — a gap change there is a UX-regression surface for an unrelated chart). Logged as a future enhancement (Out of scope).

### Decision #6 — section + mount
- **New** `<E1rmStrengthSection>` mirroring `<WeeklyMuscleVolumeSection>`: same data hooks (`useLifetimeWeeklyVolume`, `useAllExercises`, `useWeightUnit`), same local selection-state idiom (`useState<Set<string>>` keyed by **exercise id**, signature re-seed via `seriesKeysSig`), same chips (colored dot + `opacity-40` OFF), same `formatValue`. **No `useMeasurements`** — e1RM uses logged weight only, so bodyweight is irrelevant (a deliberate omission from the muscle section's hook set; Invariant D).
- **Mount**: `app/(app)/progress/index.tsx` — insert `<E1rmStrengthSection />` immediately AFTER `<WeeklyMuscleVolumeSection />` (`:70`), BEFORE `<ExercisesThisWeekList />` (`:71`). Keeps the two trend charts adjacent (volume-per-muscle → strength-per-exercise).
- **Rejected**: mount at the top above the strip (buries the existing PR hero); a single combined "Progress charts" wrapper component (over-abstraction for 2 siblings — the muscle section is standalone, mirror it).

### Decision #7 — untrained-week rendering: **carry-forward (LOCF), NOT zero-fill** + accept 0-baseline y-min
This is the subtlest point. Two sub-decisions:

**(7a) Untrained weeks → carry forward the last observed e1RM (LOCF).**
- **Problem**: the muscle chart zero-fills untrained weeks because for VOLUME a 0 is honest — you did zero volume that week, the line *should* drop to 0. For e1RM a 0 in an untrained week is **WRONG** — you did not get weaker to zero; you simply didn't test that lift. `<MultiSeriesChart>` renders EVERY value in `s.values` as a polyline vertex + dot (`:134-160`) with no gap support, so a naive zero-fill would crash each line to the x-axis and back up on every rest week — visually catastrophic and semantically false.
- **Choice**: the presenter emits, per series, a value for every week using **last-observation-carried-forward**: weeks before the exercise's first logged e1RM are dropped from that series' leading edge by carrying the *first* observed value backward is NOT done — instead, leading untrained weeks (before the first real e1RM) carry the **first** observed value forward only from the first real week onward; weeks at/after the first real e1RM hold the most recent real value until the next real one. Concretely:
  - Walk weeks oldest→newest. Maintain `last = null`.
  - For each week: if the (exercise, week) cell has a real max-e1RM (≥1 set passed `w>0 && r>0`), set `value[w] = cellMax` and `last = cellMax`. Else `value[w] = last` (carry forward; may still be `null` for leading weeks).
  - **Leading `null`s** (weeks before this exercise's first real e1RM) are encoded as the exercise's **first real value** is NOT back-filled; instead they take the same value as the first real week (flat lead-in) — see "leading-edge" note. Implementation detail pinned in §4 contract: leading nulls are replaced by the first non-null value (so the series has no `null` once it has any data), giving a flat segment from axis-left up to the first real week, then the real trajectory. This keeps the array fully numeric (the chart needs numbers) without a misleading drop to 0.
- **Why this is correct, not a hack**: e1RM is a "best so far / most recent capability" reading. Holding the last tested value across a rest week communicates "your estimated 1RM hasn't changed because you haven't tested it" — which is the honest default, far better than a phantom drop to 0 or a phantom spike. It is the standard LOCF treatment for sparse strength logs and matches how lifters read these charts.
- **Trade-off (named)**: a long untrained gap renders as a long flat segment, which slightly overstates "current" strength (decay isn't modeled). Accepted — modeling strength decay is out of scope and speculative; flat-hold is the conservative, widely-used default.
- **Rejected — zero-fill** (the muscle chart's choice): semantically false for a peak metric (a rest week is not strength=0). Visually destroys the chart. This is exactly the place the muscle presenter's contract must NOT be copied verbatim.
- **Rejected — true gaps (skip the point)**: would require extending `<MultiSeriesChart>` to accept `null`/`NaN` and skip rendering that vertex/dot, plus splitting the polyline at gaps. Real component change, touches the shared muscle chart's render path (UX-regression surface), and the prompt mandates reuse. Punted to Out of scope as the "nicest" future option.
- **Rejected — drop untrained weeks from the axis entirely**: the axis is shared across all series (Decision #1); you can't drop a week for one exercise without misaligning the others.

**(7b) Y-min pinned to 0 — accept as-is.**
- `<MultiSeriesChart>:81` pins min to 0; e1RM clusters far from 0, so the delta is compressed. Accepted (the muscle chart accepted the same; non-zero y-min is a component extension). Future enhancement, Out of scope.

### Decision #8 — empty / first-week / all-bodyweight states
- **Section renders nothing** (`return null`) when `isLoading`, or `model.series.length === 0` (mirror `weekly-muscle-volume-section.tsx:84-85`). So a user with no weighted history (all-bodyweight, or <1 weighted session) sees the section silently absent rather than an empty chart.
- **<2 trained weeks**: the week axis can be length 1 (a first-week user with one weighted session). `<MultiSeriesChart>` renders a single centered dot per visible series (`:83-87`) — already handled, no special case.
- **A week where an exercise wasn't trained**: handled by LOCF (Decision #7a) — flat-hold, not a drop.
- **Rejected**: an explicit "Not enough data" placeholder card (adds UI the prompt didn't ask for; silent-absence matches the sibling).

### Decision #9 — copy + a11y labels (pinned so the e2e can assert exact strings)
- **Section header (uppercase eyebrow, mirrors the muscle section `:94-96`)**: `"Estimated 1RM per exercise"`.
- **Chart `title` prop**: `""` (the eyebrow above is the heading; matches the muscle section passing `title=""`).
- **Check-all/uncheck-all button** — visible text `"Uncheck all"` (when all on) / `"Check all"` (when any off); a11y label `"Hide all exercises"` (all on) / `"Show all exercises"` (any off). Mirrors the muscle section's text/label split (`:101-108`).
- **Per-line chip** — a11y label `"Toggle <exercise name>"`; `accessibilityRole="checkbox"`; `accessibilityState={{ checked: on }}`; OFF state adds **`opacity-40`** (the e2e source-of-truth — rn-web 0.21 omits `aria-checked`, Discovery §5).
- **Value format**: `formatValue={(v) => formatWeight(v, unit)}` → renders `"112.5 kg"` / `"248.0 lb"`. Pre-conversion happens in the section (values pass to the chart in the display unit) OR via `formatValue`; see §4 for the exact split. (Per-exercise screen uses `(v) => v.toFixed(1)` with a `(${unit})` title; here we fold the unit into the formatter so the eyebrow stays clean. Both are valid; `formatWeight` is chosen for an explicit unit on each y-tick.)
- **Rejected**: header `"Strength progress"` (vaguer; "Estimated 1RM per exercise" names the metric and the per-exercise granularity, aiding the e2e and the user).

---

## 3. File-by-file change list

| # | Path | Type | What changes | Why (one responsibility) |
|---|------|------|--------------|--------------------------|
| F1 | `src/utils/e1rm-strength.ts` | **new** | Pure presenter `presentTopExerciseE1rm(args)` — ranks top-N eligible exercises by distinct sessions, computes best-e1RM per (exercise, week) via `epley1RM` on LOGGED weight, LOCF-fills untrained weeks, returns `{ weeks, series }`. No React, no I/O. | The e1RM data model. |
| F2 | `src/components/e1rm-strength-section.tsx` | **new** | `<E1rmStrengthSection>` — data hooks + local selection state + check-all/uncheck-all + per-exercise chips + `<MultiSeriesChart>` wiring with `E1RM_PALETTE` by rank. Mirrors `<WeeklyMuscleVolumeSection>`. | The section UX. |
| F3 | `app/(app)/progress/index.tsx` | **edited** | (a) import `E1rmStrengthSection`; (b) insert `<E1rmStrengthSection />` after `<WeeklyMuscleVolumeSection />` (`:70`); (c) refresh the stale `:19-33` docstring (now "four blocks" → the actual 6 children, or reword to "independent trend + summary blocks"). | Mount the section + correct the stale docstring (single responsibility: "register the new section on the page" — the docstring fix is part of registering it honestly). |
| F4 | `tests/unit/e1rm-strength.test.ts` | **new** | Vitest unit suite for `presentTopExerciseE1rm` (pure, injectable `now`). Cases enumerated in §5. | Presenter coverage. |
| F5 | `tests/e2e/e1rm-strength.spec.ts` | **new** | Playwright e2e: seed a WEIGHTED exercise (Bench Press) → assert section header + exercise legend chip; toggle chip (`opacity-40`); check-all/uncheck-all; negative case (bodyweight-only seed → no e1RM line). Cases in §5. | End-to-end render + interaction. |

**Close-the-set on `epley1RM` (the kernel I depend on)** — per the carry-in lesson, every caller of the seam I build on is inventoried (Discovery §1 grep A/B/C, re-confirmed by reading):

| Site | File:line | Action this run |
|------|-----------|-----------------|
| `epley1RM` definition (K0) | `src/utils/formulas.ts:1-5` | **Unchanged.** Reused as-is. Signature stays `epley1RM(weight: number, reps: number): number`. |
| Per-exercise progress caller (K1) | `app/(app)/exercises/[id]/progress.tsx:157` | **Unchanged.** NOT refactored (Decision: §below). |
| **NEW** presenter caller (K2) | `src/utils/e1rm-strength.ts` (F1) | New 2nd production caller; calls `epley1RM(w, r)`. |
| Unit test of the helper | `tests/unit/formulas.test.ts` | **Unchanged** (tests K0 directly). |

I am **NOT changing `epley1RM`'s signature or behavior**, so no call-site wiring is forced. (The "wire all call sites" lesson applies when you *change* a kernel; here I add a caller, I don't mutate the kernel.)

**Decision — do NOT refactor `progress.tsx`'s reduce into a shared helper** (Unknown #6, MEDIUM confidence):
- `progress.tsx:138-199` computes e1RM **and** volume **and** max-volume-session in one tight per-session loop with a two-variable `w`/`effW` split (Invariant D). Extracting only the e1RM half would split that loop for no dedup benefit — both already call the same `epley1RM`, so there is **zero formula duplication** to eliminate (the close-the-set risk that bit the *volume* kernel does NOT exist for e1RM; greps A/B/C confirm e1RM was centralized from day one — Discovery §1 verdict).
- An extracted `bestE1rmFromSets()` helper would have exactly **one** other plausible caller (the per-exercise screen), and wiring it there means rewriting a working, tested, Invariant-D-correct loop with no behavior change — pure churn with regression risk on a screen this run isn't scoped to touch.
- **Conclusion**: build the new multi-exercise presenter standalone; leave `progress.tsx` intact. This is the scope-creep guard, stated explicitly so the Implementer does not "helpfully" extract a shared helper and leave it half-wired.
- **Rejected**: extract `bestE1rmFromSets(sets): number` and wire both `progress.tsx` + the new presenter. Rejected — the per-exercise screen's loop also produces volume + max-volume-session from the same pass; the presenter operates on flat `WeeklyVolumeRow[]` (not nested session→sets) and buckets by week; the two shapes are different enough that a shared helper would be an awkward lowest-common-denominator. No dedup payoff, real regression risk.

---

## 4. Pure-function contract(s)

### F1 — `presentTopExerciseE1rm`

```ts
// src/utils/e1rm-strength.ts
import type { WeeklyVolumeRow } from "~/api/stats";
import type { ExerciseRow } from "~/db/types";
import { isoWeekStart, isoWeeksBetween, parseISO, weekKeyOf } from "~/utils/dates";
import { epley1RM } from "~/utils/formulas";

/** One exercise's e1RM trend, index-aligned to the shared `weeks` axis. */
export type E1rmSeries = {
  /** Stable identity = exercise_id. Drives color-by-rank + selection state. */
  id: string;
  /** Display name resolved from the library (ExerciseRow.name). */
  name: string;
  /** 0-based rank among the top-N (drives palette index). */
  rank: number;
  /**
   * kg per week, index-aligned to `weeks`. Untrained weeks are
   * LAST-OBSERVATION-CARRIED-FORWARD (Decision #7a), NOT zero-filled:
   *   - week with ≥1 set passing (w>0 && r>0): the MAX epley1RM of that week.
   *   - week with no such set: the previous week's value.
   *   - leading weeks before the first real value: the first real value
   *     (flat lead-in) — so the array is fully numeric (no nulls, no 0-drop).
   * Guaranteed: every entry > 0 (a series with no real value is never emitted).
   */
  values: number[];
};

export type E1rmStrengthModel = {
  /** Shared contiguous ISO-week axis (oldest→newest), first-trained → now. */
  weeks: { key: string; label: string }[];
  /** Top-N eligible exercises by distinct-session rank; rank-ordered. */
  series: E1rmSeries[];
};

/** Default cap on plotted lines (matches progress-hero.tsx TOP_N). */
export const E1RM_TOP_N = 5;

export function presentTopExerciseE1rm(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  topN?: number;       // default E1RM_TOP_N
  now?: Date;          // injectable for deterministic tests; default new Date()
}): E1rmStrengthModel;
```

**Semantics (pinned — single canonical algorithm, no dead branches):**
1. `if (rows.length === 0) return { weeks: [], series: [] }`.
2. **Week axis** (identical to `presentWeeklyVolumeByMuscle:59-70`): earliest finite `parseISO(row.completed_at)` → `firstMonday = isoWeekStart(earliest)`; `currentMonday = isoWeekStart(now)`; `weeks = isoWeeksBetween(firstMonday, currentMonday)`. If `weeks.length === 0` → return empty. Build `weekIndex: Map<weekKey, idx>` via `weekKeyOf(parseISO(row.completed_at))`.
3. **Library map** `libById = new Map(exercises.map(e => [e.id, e]))`. Rows with `exercise_id` not in `libById` are **skipped** everywhere below (dangling skip).
4. **Per (exercise, week) MAX-e1RM cells + eligibility + frequency**, in ONE pass over rows (skipping dangling):
   - `w = row.weight ? parseFloat(row.weight) : 0`; `r = row.reps ?? 0`. **Guard `w > 0 && r > 0`** (Invariant D — LOGGED weight, not `effectiveWeightKg`).
   - On guard pass: `est = epley1RM(w, r)`; write `max` into `cell[exercise_id][weekIdx]` (**Invariant E1: MAX, not `+=`**); mark `exercise_id` as **eligible**; add `row.session_id` to `sessions[exercise_id]` (a `Set`); track `lastActiveMs[exercise_id] = max(..., parseISO(row.completed_at).getTime())`.
   - On guard fail (e.g. bodyweight `weight=0`, or `reps=0`): contributes nothing — no cell, no eligibility, no session count. (A bodyweight-only exercise therefore never becomes eligible.)
5. **Rank** the eligible exercises by the comparator (total order, Decision #2):
   `b.sessions.size - a.sessions.size` → `b.lastActiveMs - a.lastActiveMs` → `a.name.localeCompare(b.name)` → `a.id.localeCompare(b.id)`. Take the first `topN`.
6. **Build series** for each ranked exercise (rank index `i`):
   - Start from its `cell[id]` (sparse — only real weeks set). Produce `values: number[]` of length `weeks.length` by LOCF (Decision #7a):
     - `last = null`; walk `w = 0..weeks.length-1`: if `cell[id][w]` is a real number, `values[w] = cell[id][w]; last = values[w]`; else `values[w] = last` (may be null).
     - Then replace every leading `null` with the first non-null value (flat lead-in). (Since the exercise is eligible, at least one real value exists, so no null survives.)
   - Emit `{ id, name: libById.get(id)!.name, rank: i, values }`.
7. Return `{ weeks: weeks.map(w => ({ key: w.key, label: w.label })), series }`.

**What is NOT in this algorithm** (guard against the prior-run pseudo-code-contradiction failure):
- No `effectiveWeightKg`, no bodyweight resolution, no `measurements` arg (Invariant D — logged weight only).
- No `+=` accumulation anywhere (Invariant E1 — peak metric uses MAX).
- No zero-fill of untrained weeks (Decision #7a — LOCF).
- No `Map`-iteration-order dependence for ranking (the comparator is a total order).
- No second map name / no "refinement below" — this is the only algorithm.

### F2 — `<E1rmStrengthSection>` (component contract)

```tsx
// src/components/e1rm-strength-section.tsx
export function E1rmStrengthSection(): React.JSX.Element | null;
```
- Hooks: `const { data: rows, isLoading } = useLifetimeWeeklyVolume();`
  `const { data: exercises } = useAllExercises();`
  `const unit = useWeightUnit();` (NO `useMeasurements` — Invariant D).
- `model = useMemo(() => (rows && exercises) ? presentTopExerciseE1rm({ rows, exercises }) : null, [rows, exercises])`.
- Selection state keyed by **exercise id** (stable across renames):
  `const seriesKeys = useMemo(() => model?.series.map(s => s.id) ?? [], [model]);`
  `const seriesKeysSig = seriesKeys.join("|");` + the `lastSig` re-seed idiom (`weekly-muscle-volume-section.tsx:60,67-71`) → newly-appearing exercise starts visible.
  `const [visible, setVisible] = useState<Set<string>>(() => new Set(seriesKeys));`
- `chartSeries: ChartSeries[] = model.series.map(s => ({ label: s.name, color: colorForRank(s.rank), values: s.values, visible: visible.has(s.id) }))`.
  - **NOTE**: `ChartSeries.label` is used as the React key in the chart (`:139,153`). Two exercises with the **same name** (a renamed dup) would collide. Pinned mitigation: the chart `label` is `s.name` for the legend text, but selection/color key off `s.id` in the section; the chart's internal `key={`line-${s.label}`}` collision is a pre-existing `<MultiSeriesChart>` property (muscle keys are unique by construction). For exercises, duplicate display names are possible. **Mitigation (caller-side, no component change): if two of the top-N share a name, disambiguate the chart `label` by appending a thin marker** — see Risk R-7; the simplest deterministic fix is `label: s.name` and accept the rare collision, OR append `" "` repeated by rank. Decided: pass `label: s.name` (collisions are vanishingly rare for a sole-user's top-5 and the legend reads cleanly); R-7 documents the residual.
- Bail: `if (isLoading) return null; if (!model || model.series.length === 0) return null;`
- Layout: `width = Dimensions.get("window").width - 32` (match sibling). Eyebrow `"Estimated 1RM per exercise"`. Toggle-all button + per-exercise chips exactly mirroring `weekly-muscle-volume-section.tsx:91-156`, swapping `MUSCLE_COLORS[s.key]` → `colorForRank(s.rank)`, `s.key` → `s.id` (state) / `s.name` (label), and `formatVolume` → `formatWeight`.
- Chart call:
  ```tsx
  <MultiSeriesChart
    xLabels={model.weeks.map(w => w.label)}
    series={chartSeries}
    width={width}
    height={200}
    title=""
    formatValue={(v) => formatWeight(v, unit)}
  />
  ```
  Values pass to the chart **in kg**; `formatWeight(v, unit)` converts at the y-tick boundary (same boundary-conversion pattern as the muscle section, which passes kg + `formatVolume`). The chart's `maxV` is then computed in kg and the y-ticks display via `formatWeight` — consistent.

### F3 — `app/(app)/progress/index.tsx` (mount)
- Add import: `import { E1rmStrengthSection } from "~/components/e1rm-strength-section";`
- JSX: insert `<E1rmStrengthSection />` between `<WeeklyMuscleVolumeSection />` (`:70`) and `<ExercisesThisWeekList />` (`:71`).
- Docstring (`:19-33`): the "Composes four independent blocks" list is already stale (the muscle section made it 5). Update the prose to describe the now-6 children, or generalize to "independent trend + summary blocks" so it doesn't rot again.

---

## 5. Test plan

### F4 — Unit (`tests/unit/e1rm-strength.test.ts`), mirroring `weekly-muscle-volume.test.ts`
- Reuse the `mkRow` / `mkExercise` fixtures verbatim (drop `mkMeasurement` — no bodyweight). Pin `NOW = new Date(2026, 4, 18, 12, 0, 0)` (Monday 2026-W21), pass `now: NOW` (injectable, no fake timers — pattern (a), `~/.claude/CLAUDE.md` deterministic-tests).

Required cases:
1. **empty** → `{ weeks: [], series: [] }`.
2. **single weighted exercise, single week** → one series, `values: [epley1RM(100,5)]` = `[100*(1+5/30)]` = `[116.666…]`; assert `toBeCloseTo` to avoid float brittleness.
3. **MAX semantics (Invariant E1)** — two sessions in the SAME week for one exercise: `(100kg×5 → e1RM≈116.67)` and `(120kg×3 → e1RM=132)`. Expect the week cell = **132** (higher e1RM wins), **NOT a sum** (would be ~248.67). This is the key divergence from the volume `+=` presenter.
4. **MAX within a session across sets** — one session, sets `(100×5)`, `(110×3)` → cell = `max(116.67, 121)` = **121**.
5. **LOCF untrained week (Decision #7a)** — exercise trained in W19 (e1RM 116.67) and W21 (e1RM 132), nothing in W20. Axis = [W19,W20,W21]. Expect `values = [116.67, 116.67, 132]` (W20 carries W19's value forward, NOT 0). Explicitly assert `values[1] !== 0` and `toBeCloseTo(116.67)`.
6. **Leading-edge flat lead-in** — exercise first trained in W20 only, axis spans W19..W21 (because ANOTHER exercise trained in W19). Expect this exercise's `values = [v20, v20, v20]` (leading W19 takes the first real value, flat) — assert `values[0] === values[1]` and `> 0` (no leading 0).
7. **bodyweight-only → NO series (Invariant D)** — exercise with all rows `weight: "0"` (equipment "bodyweight") → not eligible → not in `series`. Assert `series` excludes it. Pair with a weighted exercise in the same input to prove the weighted one still plots.
8. **bodyweight WITH added load plots** — Pull-up rows `weight: "20", reps: 8`, equipment "bodyweight" → eligible → series present with `epley1RM(20,8)`.
9. **top-N cap + ranking by distinct sessions** — 6 eligible exercises with distinct session counts `[5,4,3,2,1,1]`; pass `topN: 5` (or default) → exactly 5 series; the 2-way tie at count 1 resolves by `lastActiveMs` DESC then name ASC; assert the included set and the rank order deterministically.
10. **eligibility excludes bodyweight-only from the slot** — top-N where a bodyweight-only exercise has the HIGHEST session count: assert it does NOT appear and a lower-frequency *weighted* exercise takes its slot (proves Decision #2 eligibility).
11. **dangling exercise_id skip** — a row whose `exercise_id` is absent from `exercises[]` → skipped; assert it neither plots nor counts toward ranking.
12. **single-week one-dot** — first-week user, one weighted exercise → `weeks.length === 1`, `series[0].values.length === 1`.
13. **rank is deterministic regardless of row order** — feed rows shuffled; assert identical `series` id-order (guards the total-order comparator).

### F5 — E2E (`tests/e2e/e1rm-strength.spec.ts`), mirroring `weekly-muscle-volume.spec.ts`
- Copy the harness verbatim (admin service-role client, `createConfirmedUser`, `seedFinishedSession`, `mondayNWeeksAgoUtc`, `signInViaUi`, `gotoProgress`, `afterAll` cleanup). Screenshot dir scoped to THIS run's folder.
- **MUST seed a WEIGHTED exercise** so an e1RM line renders: `pickCanonicalExercise(admin, "Bench Press")` (verified seeded, weighted — Discovery §5 catalog correction). Seed across ≥2 weeks so the chart shows a multi-week line (e.g. `weight: 90` week-1-ago, `weight: 100` this week) → e1RM increases → a visible upward line proves the feature.
- Cases:
  1. **Section renders** — header `getByText("Estimated 1RM per exercise").first()` visible; the exercise legend chip `getByText("Bench Press").first()` (or `getByLabel("Toggle Bench Press")`) visible.
  2. **Check-all/uncheck-all** — `getByRole("button", { name: "Hide all exercises" })` → click → `"Show all exercises"` appears → click back → `"Hide all exercises"`.
  3. **Per-line chip toggle** — `getByLabel("Toggle Bench Press")` → assert `not.toHaveClass(/opacity-40/)` → click → `toHaveClass(/opacity-40/)` → click → back on. (rn-web 0.21 `opacity-40` source-of-truth, Discovery §5.)
  4. **NEGATIVE — bodyweight-only seeds NO e1RM line** — a separate user seeded ONLY a bodyweight exercise with `weight: 0` (e.g. `pickCanonicalExercise(admin, "Push-up")`, `weight: 0`): assert the section header `"Estimated 1RM per exercise"` has count 0 (section absent — `return null` when `series.length === 0`), and `getByLabel("Toggle Push-up")` has count 0. Proves Invariant D end-to-end. (Contrast: the muscle chart's bodyweight test asserts the line DOES appear via the kernel — the OPPOSITE assertion, because volume and e1RM diverge on bodyweight, Invariant D.)
- `pickCanonicalExercise` throws on an unknown name — only use names verified seeded (`Bench Press`, `Push-up` — both in `0001_rls_and_seed.sql`, Discovery §5).

---

## 6. Risks

| # | Risk | Confidence / Risk | Mitigation |
|---|------|-------------------|------------|
| R-1 (data integrity / Invariant D) | Presenter accidentally uses `effectiveWeightKg` (the volume path) → bodyweight movements resurrect as e1RM lines, violating Invariant D. | HIGH / HIGH | Contract §4 step 4 pins `w = parseFloat(row.weight)` + guard `w>0 && r>0`; "What is NOT in this algorithm" forbids `effectiveWeightKg`; unit case #7/#10 + e2e case #4 assert no bodyweight line. NO `measurements` arg or `useMeasurements` hook — the bodyweight path is structurally absent. |
| R-2 (correctness / metric semantics) | Implementer copies the muscle presenter's `+=` (sum) instead of MAX → e1RM lines balloon with set count. | HIGH / HIGH | Invariant E1 named explicitly; unit cases #3 + #4 assert MAX over same-week sessions/sets, NOT sum. |
| R-3 (UX correctness / untrained weeks) | Untrained weeks zero-filled → lines crash to 0 and back, falsely implying strength dropped to zero on rest weeks. | HIGH / HIGH | Decision #7a (LOCF); unit cases #5 + #6 assert carry-forward / flat lead-in, explicitly `!== 0`. This is the hardest point — flag for Validator. |
| R-4 (UX / slot starvation) | A bodyweight-only exercise (highest frequency) consumes a top-N slot but plots no line → user silently loses a chart line. | HIGH / MEDIUM | Decision #2 eligibility filter ranks ONLY plottable (weighted) exercises; unit case #10 asserts the bodyweight-only high-frequency exercise is excluded and a weighted one takes the slot. |
| R-5 (platform divergence — RN/RN-Web) | `<MultiSeriesChart>` SVG parity across iOS/Android/web; rn-web 0.21 drops `aria-checked` from `accessibilityState`. | MEDIUM / LOW | Component is reused as-is (the muscle chart is a working web+native proof); chips assert on `opacity-40` (not `aria-checked`) — Discovery §5. No new SVG. |
| R-6 (performance) | Extra full pass over the lifetime `WeeklyVolumeRow[]` per render. | HIGH / LOW | `useMemo` over the SAME in-cache array (no new network — `useLifetimeWeeklyVolume` already fetched). One O(rows) pass + O(eligible·log) sort + O(N·weeks) LOCF. Same cost class as the muscle presenter, already accepted on this page. |
| R-7 (UX / duplicate names) | Two top-N exercises with identical display names → identical legend label + colliding `<MultiSeriesChart>` internal React key (`key={`line-${label}`}`). | LOW / LOW | Selection + color key off `exercise_id` (stable), so toggling/coloring is correct even on a name clash. The chart's internal key collision is a pre-existing component property; for a sole user's top-5, duplicate exercise names are vanishingly unlikely. Residual accepted; documented for the Validator. Not fixed by a component change (out of scope). |
| R-8 (correctness / week bucketing) | Local-time ISO-week bucketing on `completed_at` vs the e2e seeding UTC dates near a week boundary. | MEDIUM / LOW | Reuse the muscle presenter's EXACT bucketing (`weekKeyOf(parseISO(completed_at))`, device-local — `dates.ts:12-19`). E2e seeds Tuesday 18:00 UTC (mid-week, `mondayNWeeksAgoUtc(n)+1 day`) — far from a boundary, mirroring the muscle spec. |
| R-9 (UX / live update) | After finishing a session, the new section must live-update. | HIGH / LOW | The section reads `["stats"]` + `["exercises"]` caches; the existing Progress-page invalidation cascade (`progress/index.tsx` refresh + `useFinishSession`) already covers both keys — no new wiring (Discovery §Constraints). |

---

## 7. Out of scope (parked → `docs/features.md "## Open"`)
- **Favorites (Phase 2b)** — favorite toggle + `user_exercise_favorites(user_id, exercise_id)` join table + RLS. This run is auto-selection ONLY (prompt + `features.md:6`).
- **Bodyweight leverage factors, secondary-muscle attribution, "hard sets/week" dose metric** — explicitly out (prompt).
- **Extending `<MultiSeriesChart>`**: (a) true gap rendering (`null`/`NaN` skip) — the "nicest" untrained-week treatment but a shared-component change with regression surface on the muscle chart; (b) non-zero y-min for compressed e1RM deltas. Both deferred (Decision #5/#7b).
- **Refactoring `progress.tsx`'s combined e1RM/volume reduce** into a shared helper — no dedup benefit (e1RM never duplicated), real regression risk on an out-of-scope screen (Decision §3).
- **Per-session x-axis** for the multi-exercise chart — breaks the shared-index contract (Decision #1).
- **Persisting line selection** — component-local like the muscle chart.
- **Honoring `max_volume_window_weeks`** — trend charts are deliberately full-history (mirrors the volume chart's Decision #3).
- **Modeling strength decay across long untrained gaps** — LOCF flat-hold is the conservative default; decay modeling is speculative (Decision #7a trade-off).

---

## 8. Hand-off

- Triad to build: F1 presenter (the data model) → F2 section (the UX) → F3 mount (1 import + 1 JSX line + docstring) → F4/F5 tests.
- **Implementer must NOT** extract a shared e1RM helper into `progress.tsx` (Decision §3) or copy the muscle presenter's `+=`/zero-fill (Invariants E1 + Decision #7a).
- Recommendation to Conductor: **invoke Validator**. Scrutinize hardest: (1) the LOCF untrained-week treatment (R-3 / Decision #7a) — is flat-hold the right semantic, and is the leading-edge flat lead-in correctly specified?; (2) the eligibility-before-ranking rule (R-4 / Decision #2) — does it correctly prevent bodyweight-only slot starvation?; (3) Invariant D vs E1 fidelity in the contract.
