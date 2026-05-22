# Discovery — 2026-05-21_2225_multi-metric-strip

## Feature prompt

Per-exercise info during a live workout currently shows only "Volume to PR" (in `src/components/volume-target-slot.tsx`). Extend the strip so the user can see the full story of where they are in the exercise: add (a) **Max volume** — the previous-best single-session volume for this exercise — and (b) **Current session volume** — the running sum of CHECKED working sets in this live session. Render alongside the existing "Volume to PR" target.

Per F10's spec, current session volume must count only sets marked done (checked). Volume to PR keeps its current per-session-max definition (no kernel change). Use `formatVolume` (already updated to show full integers with thousands separator — e.g. `"4,900 kg"`).

User goal: resolve the perception that "Volume to PR" looks wrong by surfacing the reference points (Max + Current) next to the gap.

## Scope summary

UI-only extension of the per-exercise volume-target strip mounted in the live-workout screen. Adds two reference metrics (Max single-session volume, Current session volume from CHECKED sets) next to the existing "Volume to PR" gap. The Max number already exists inside `computeVolumeTarget` as `previousMaxKg`; Current must be re-derived from CHECKED-only sets per F10 semantics. No DB / API / cache key changes are required. Live-workout-only — history detail does not mount the slot.

## Affected files (verified)

- `src/components/volume-target-slot.tsx:29-113` — current strip implementation. Single-line render with three states: `null` on loading / `no-pr`, "Volume to PR: ..." for `chasing`, "Matched/New PR!" for `surpassed`. Hidden when `progressQ.isLoading` (line 47) and when `state.kind === "no-pr"` (line 48). Calls `useExerciseProgress(exerciseId)` + `useWeightUnit()` unconditionally at the top (line 33-34).
- `src/utils/volume-target.ts:11-32` — `VolumeTargetState` discriminated union. `no-pr` exposes only `{ kind: "no-pr" }` — `previousMaxKg` and `runningKg` are **not** on this branch today (relevant to Unknown #4). `chasing` and `surpassed` both expose `{ previousMaxKg, runningKg }`.
- `src/utils/volume-target.ts:48-59` — `sumVolume` kernel: skips `set_type === "warmup"`, `parseFloat` weight, guards `Number.isFinite(w) && w > 0 && r > 0`. **No `completed_at` filter.**
- `src/utils/volume-target.ts:75-129` — `computeVolumeTarget`. `previousMaxKg = max(sumVolume(session.sets))` over `pastSessions[]`. `runningKg = sumVolume(currentSessionSets)` — currently counts unchecked drafts (F11 design decision #3, explicit "aggressive — motivating"). `currentWeightKg` picked by `max(set_number)` (MAJ-1 fix); not affected by this feature.
- `src/hooks/use-progress.ts:5-11` — `useExerciseProgress(exerciseId)` thin TanStack wrapper. `queryKey = ["progress", exerciseId]`. No staleTime/gcTime set (uses defaults). Cache shared with `/exercises/[id]/progress` route.
- `src/api/progress.ts:10-39` — `listSetsForExercise`: `select("*, sessions!inner(id, started_at, ended_at)")`, filters `sessions.ended_at IS NOT NULL` and `deleted_at IS NULL`. **Excludes the in-progress live session entirely.** Orders by `completed_at ASC, set_number ASC` (post-F10 secondary sort).
- `src/components/exercise-block.tsx:38-42, 60, 181-186` — `showVolumeTarget?: boolean` prop (default `false`). When true, mounts `<VolumeTargetSlot exerciseId={exercise.id} currentSessionSets={sets} />` between the header block and the column-header row.
- `app/(app)/workout/[sessionId].tsx:316-383` — live-workout screen. Renders `<ExerciseBlock ... showVolumeTarget showCheckable />` (lines 369-370) and passes `sets={setsByExercise.get(ex.id) ?? []}` (line 320). `setsByExercise` is built (lines 176-184) from `setsQ.data = useSetsForSession(sessionId)` — **includes unchecked drafts** (`completed_at IS NULL` rows).
- `src/api/sets.ts:22-35` — `listSetsForSession`: `select("*").eq("session_id", sessionId).is("deleted_at", null).order("completed_at", { nullsFirst: false }).order("set_number")`. Returns ALL sets in the session including unchecked drafts (no `completed_at` filter). Cache key `["sets", sessionId]`.
- `src/api/sets.ts:156-181` — `checkSet`/`uncheckSet`: stamp/clear `completed_at`. Invalidate `["sets", sessionId]` only (see `src/hooks/use-sets.ts:95-113`).
- `src/db/schema.ts:151` — `completedAt: timestamp(...)` (no `notNull()`). Drizzle source-of-truth post-migration 0007.
- `src/db/types.ts:124` — `SetRow.completed_at: string | null`.
- `supabase/migrations/0007_set_completed_at_nullable.sql` — drops the `NOT NULL` constraint. Already applied to the linked Supabase per the F10 final-summary.
- `src/components/set-input.tsx:103` — `const isChecked = row.completed_at != null;` — canonical "checked" predicate used by the per-row UI.
- `src/utils/units.ts:33-40` — `formatVolume(kg, unit)`: `Math.round(value).toLocaleString("en-US") + " " + unit`. Updated in the prior run from k-abbreviation to thousands-separated integers (`"4,900 kg"`). `formatWeight` retains `.toFixed(1)` for per-set displays.
- `tests/unit/volume-target.test.ts:1-337` — 13 tests covering all three states + warmup exclusion + MAJ-1 regression. Currently asserts only the shape of the existing union; needs additions for any new fields.
- `tests/e2e/volume-target.spec.ts:1-554` — 6 e2e covering the golden chasing path, no-weight, tie, MAJ-1, no-pr-hidden, history-no-strip. Selectors target literal strings like `"1,300 kg"`, `"Volume to PR"`, `"Matched your previous best"`, `"@ 50.0 kg"` (post-formatter-update commas).

## Relevant conventions (verified by reading code)

- **Set "checked" predicate** = `completed_at != null` (string-or-null). One-line rule: `set-input.tsx:103`. New sets created via `logSet` insert with `completed_at: null` (`src/api/sets.ts:69`). `checkSet` stamps `new Date().toISOString()` (`src/api/sets.ts:161-162`).
- **Volume kernel** = `parseFloat(weight) * reps` with `w > 0 && r > 0` guards and `set_type === "warmup"` skip. Mirrors across `src/utils/volume-target.ts:48-59`, `src/components/weekly-volume-strip.tsx:44-51`, `app/(app)/exercises/[id]/progress.tsx:62-93`. **None of these kernels filter by `completed_at`** — the boundary is set at the API layer (`listWeeklyVolumeRows` and `listSetsForExercise` use `sessions.ended_at IS NOT NULL`, but `listSetsForSession` does not).
- **All volume math in kg internally**, formatted at the display boundary. Aggregates use `formatVolume` (rounded integer + thousands comma + unit). Per-set weights use `formatWeight` (one decimal + unit). Per the `formatVolume` doc-comment, locale is pinned to `en-US` to prevent pt-BR thousands-period collision.
- **Strip container**: `<View className="border-b border-gray-100 px-4 py-2 dark:border-gray-900">` wrapping a single `<Text className="text-sm text-gray-500 dark:text-gray-400">` with inline bolded numeric children (`font-semibold tabular-nums text-black dark:text-white`). Established by `volume-target-slot.tsx:68-89`.
- **Middle-dot separator** for inline inline lists of metadata: `" · "`. Precedents: `exercise-block.tsx:138`, `exercise-list-item.tsx:17`, `exercise-picker.tsx:121`, `routine-exercise-row.tsx:75`, `session-summary-row.tsx:60,63`, `volume-target-slot.tsx:80` (`" · ≈ "`).
- **Hook hygiene**: `<VolumeTargetSlot>` calls `useExerciseProgress` + `useWeightUnit` unconditionally and gates render-only — established by F11 (MAJ-1 lineage). Parent must not conditionally mount inside a render branch that flips the call order.
- **Surpassed copy tokens**: emerald accent (`text-emerald-600 dark:text-emerald-400`) — chosen at F11 implementation time despite the design's blue spec; see F11 final-summary "design deviations".
- **Cache invalidation chain on check toggle**: `useCheckSet` / `useUncheckSet` invalidate ONLY `["sets", sessionId]` (`src/hooks/use-sets.ts:99-100, 108-109`). `["progress", exerciseId]` is NOT invalidated on check — but the slot's `useMemo` depends on `currentSessionSets` (a prop) and re-runs whenever `setsQ.data` changes. So the new "Current session volume" metric will recompute on every check-toggle without any new wiring.
- **Display column layout**: when `showCheckable === true`, exercise-block prepends a `w-11` spacer for the check button (`exercise-block.tsx:193`). The strip sits ABOVE this header row; its layout is independent.

## Constraints

- **Data**: No new tables. Reads only — `useExerciseProgress(exerciseId)` (cache `["progress", id]`) and `useSetsForSession(sessionId)` (cache `["sets", sessionId]`, fed in via prop). Both already mounted by the live screen. No FK / RLS / migration impact.
- **UI**: Strip lives inside `<ExerciseBlock>` between the title row and the column-header row (`exercise-block.tsx:181-186`). The block's vertical padding budget is already established (`px-4 py-2` per row); going from one row of text to three short rows of text will add ~32-40px per exercise (font: `text-sm` ≈ 14px line height ≈ 20px including line spacing). For a 6-8 exercise session this adds roughly 192-320px of scroll length — material but not blocking. Designer must pick whether to stay one-line ("Max ... · Now ... · To PR ...") or go multi-line.
- **Platform**: Web (Expo Web / Safari iOS PWA per the bug-fix run repro) + native RN. No platform divergence in current strip. `tabular-nums` is supported across both.
- **Auth**: Live-workout screen requires authenticated session; RLS scopes both queries via `auth.uid()`. No new boundary.
- **Performance**: `useExerciseProgress(id)` fan-out is one query per visible exercise (N ≤ ~8 in practice). TanStack dedupes; cache shared with `/exercises/[id]/progress`. Adding 2 numbers to the existing memo'd state is free. **Recompute frequency**: the memo dependency is `[progressQ.data, currentSessionSets]`. `currentSessionSets` is a new array reference on every `setsQ.data` change (from `setsByExercise.get(ex.id) ?? []` in `app/(app)/workout/[sessionId].tsx:320`) — so the memo fires once per check / log / update / delete. Acceptable.

## Existing precedents

- **The strip itself** — `src/components/volume-target-slot.tsx` (F11, run `2026-05-21_1505_exercise-volume-target/`). Establishes the container, token palette, hook hygiene, and the three-state render contract this feature extends.
- **F10 (set-check button)** — `docs/runs/2026-05-21_1308_set-check-button/`. Establishes the `completed_at = null` ⇔ "unchecked draft" semantics that this feature consumes. The F10 final-summary explicitly lists "F11 keeps including unchecked drafts in running volume" as a design tension already on record — this feature is the agreed correction.
- **Multi-metric inline strip with middle-dot separator** — `session-summary-row.tsx:56-65` renders `"{date} · {duration} · {N sets} · {volume}"` as a chained inline `Text` with `· ` separators. This is the closest visual precedent for a "Max ... · Now ... · To PR ..." single-line layout.
- **Label-over-value block stack** — `app/(app)/history/week/[isoWeek].tsx:176-191` builds a `statRows: Row[]` array (`{ label, value }`) rendered through a `<Section>`. Heavier visual treatment; precedent if Designer chooses stacked rows for the strip.
- **Big-number-with-tiny-label** — `weekly-volume-strip.tsx:102-107` renders `<Text "uppercase tracking-wide text-gray-500">This week</Text>` + `<Text "text-2xl font-semibold">{formatVolume}</Text>`. Pattern available if Designer wants a hero-style Max/Now treatment, though the per-exercise strip is much more compact than a weekly summary.
- **The just-finished bug-fix run** — `docs/runs/2026-05-21_2155_volume-math-wrong/diagnosis.md` Spec option #5 explicitly anticipates this feature ("Multi-metric strip — show Max-session-volume + Current-session-volume + Reps-to-PR alongside each other ... Removes ambiguity").

## Unknowns (require Designer judgment or human decision)

1. **Layout shape** (one line vs stacked rows vs two-line). The prompt lists three options:
   - (a) Stacked: 3 short rows (`Max …`, `Now …`, `To PR …`). Most legible. Largest vertical cost (~3× current height).
   - (b) Single row with separators: `"Max 4,900 kg · Now 1,200 kg · To PR 3,700 kg"`. Lowest vertical cost. Risk: ~50-60 chars at `text-sm` may wrap on narrow phones (iPhone SE ~320px).
   - (c) Two-line: header row with the three metrics, second row with the reps-to-beat clause (`"≈ 7.2 reps @ 60 kg"`). Compromise.
   No strong code precedent forces one. Designer call.

2. **Current Session = CHECKED-only redefinition**: today the slot passes `sets` straight through and the kernel counts unchecked drafts. The new spec mandates `currentSessionSets.filter(s => s.completed_at != null)` BEFORE summation. Open: does Designer (a) filter at the call site inside `volume-target-slot.tsx` before calling `computeVolumeTarget`, or (b) add a parameter to the kernel (`onlyChecked: boolean`), or (c) compute Current independently from "running for the existing gap math"? Note: per the prompt, "Volume to PR keeps its current per-session-max definition (no kernel change)" — the prompt itself reads as if BOTH running and current should converge on the checked-only definition (otherwise "Volume to PR" computed against unchecked-inclusive running would not equal `Max − Current` displayed beside it, which is the literal arithmetic the user is being asked to mentally check). Designer must explicitly pick whether **gap math** also becomes checked-only (consistent UX) or stays inclusive (motivating but inconsistent with the displayed Now).

3. **`no-pr` state behavior**. Today the slot returns `null` (line 48). With Max + Now exposed, options:
   - (i) Keep `null` for parity with today (the strip exists only when there's a PR to chase).
   - (ii) Render a degraded line: `"Max — · Now {formatVolume(currentKg)}"` so the user always sees their current session work.
   - (iii) Render only `"Now {formatVolume(currentKg)}"` and omit the Max placeholder.
   The `VolumeTargetState` union currently does not carry `runningKg` on the `no-pr` branch (`src/utils/volume-target.ts:12`). Choosing (ii) or (iii) requires extending the union to either add fields to `no-pr` OR returning `chasing` even when `previousMaxKg === 0` (with a `gapKg`/`repsToBeat` semantic that's not meaningful) OR introducing a fourth `kind`. Designer call + a small type-system call.

4. **`surpassed` state behavior**. Today the surpassed branch renders ONLY the celebratory line ("New PR! +X over your previous"). Open: should Max + Now also appear in this state (e.g. `"Max 1,000 · Now 1,500 — New PR! +500"`) for consistency, or does the celebration stand alone? Surpassed already exposes both fields; this is purely a copy decision.

5. **Copy / label tokens**. Prompt suggests "Max", "Now", "To PR". Are these the final labels or just illustrative? Adjacent options seen elsewhere in the app:
   - "Previous best" / "This session" / "Volume to PR"
   - "Best" / "Now" / "Gap"
   - "PR" / "Today" / "To go"
   Not a code precedent — the only previous label in this slot is "Volume to PR". Designer call.

6. **Update propagation timing** when the user toggles check. The cache wiring (F10) invalidates `["sets", sessionId]` only. `setsQ.data` updates → `setsByExercise` rebuilds → `<ExerciseBlock>` re-renders with a new `sets` reference → `<VolumeTargetSlot>` re-runs its `useMemo([progressQ.data, currentSessionSets])` → Current re-derives. **Verified end-to-end with no code change required.** Listed here only because the prompt explicitly flags it as a risk.

7. **Reps-to-beat clause** (the "≈ 7.2 reps @ 60 kg" suffix). Currently rendered inline with the "Volume to PR" number on the chasing branch. If the Designer chooses stacked layout, where does this clause live — fourth row, appended to the To PR row, or dropped entirely? Designer call.

## Out-of-scope flags

- **No change to `previousMaxKg` semantics** (per-session max). The prior bug-fix run explicitly froze this as the "spec is correct, presentation needs improvement" outcome — this feature IS that presentation improvement; do not also relitigate the per-session-vs-per-set choice here.
- **No new server query / no `useExerciseProgress` cache key bump**. All data needed is already on the wire.
- **No history-detail / non-live surface changes**. The slot is gated by `showVolumeTarget` and the live screen is the only caller (verified: `grep showVolumeTarget` returns zero hits in `app/(app)/history/[id].tsx`).
- **No `formatVolume` changes**. The thousands-separator update from the prior run is the formatter this feature consumes; the prompt explicitly tells us to use it as-is.
- **No `set_number`-based "current weight" pick changes** (F11 MAJ-1). Leave the reducer in `volume-target.ts:106-111` alone unless the kernel signature itself changes for unknown #2.
- **No fix to the stale `docs/data-model.md` line 67** ("completed_at timestamptz NOT NULL"). Migration 0007 already dropped that constraint; the doc is stale but updating it is doc-cleanup, not feature work.
- **No fix to the `import-strong.ts:517` set_number collision side-finding** from the prior diagnosis — that's a separate run.
