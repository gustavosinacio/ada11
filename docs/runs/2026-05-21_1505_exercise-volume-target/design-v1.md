# Design v1 — 2026-05-21_1505_exercise-volume-target

## Goal (1 sentence)
While training, surface a single-line per-exercise strip inside `<ExerciseBlock>` that compares running session-volume to the user's previous best single-session volume and shows the fractional reps left at the most recent logged weight to surpass it.

## Approach
Pure presentation layer on top of two queries that already exist: `useExerciseProgress(exerciseId)` for previous-best volume and the `sets` prop already passed to `<ExerciseBlock>` for running session-volume. A new pure helper `computeVolumeTarget(...)` lives in `src/utils/volume-target.ts` and returns a discriminated state (`no-pr` | `chasing` | `surpassed`). A new presentational component `<ExerciseVolumeTarget>` renders the strip, gated by a new `showVolumeTarget` prop on `<ExerciseBlock>` (default `false`) so the history-detail surface is unaffected. Math stays in kg internally; display converts via the existing `formatVolume`/`formatWeight` formatters. No schema change, no new API, no cache-buster bump.

## Decisions on unknowns
| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Data-fetch strategy | (A) Reuse `useExerciseProgress(exerciseId)` per block; compute max client-side via `useMemo`. | Zero new server code, warm-cache reuse with the per-exercise progress screen, single-user data volume is bounded. Per-block hook fan-out is acceptable at N ≤ ~8 (see Performance). |
| 2 | "Current weight" semantics | (b) Most recently LOGGED set's weight (regardless of checked, regardless of set_type — last row with a non-null, finite, positive `weight`). | Matches the user's literal intent: "the weight I'm currently using." Updates immediately on edit so the strip feels alive. (a) is too restrictive (most users don't check until end of exercise); (c) doesn't match "current"; (d) is feature creep. |
| 3 | Unchecked sets in running volume | YES — count drafts (any non-warmup row with finite positive `weight` and `reps > 0`, regardless of `completed_at`). | The strip's job is mid-workout motivation; drafts represent the work the user just did. Mismatch with post-Finish history (if the user discards unchecked) is acceptable since the strip doesn't exist on history detail. Documented in Riscos. |
| 4 | Display placement | One-line row immediately below the header (after line 114 of `exercise-block.tsx`, before the column-header row at 154). Inside the header `View` border block. | Always visible while scrolling through exercises, doesn't collide with the muscle/equipment subtitle, doesn't push the column-row out of the visual contract. |
| 5 | Display copy (chasing state) | `"To beat PR: {formatVolume(gapKg, unit)} · ≈ {repsToBeat.toFixed(1)} reps @ {formatWeight(currentWeightKg, unit)}"` — single line, middle-dot separator. When `currentWeightKg` is missing, drop the right half: `"To beat PR: {formatVolume(gapKg, unit)}"`. | "PR" is unambiguous in gym context. Middle-dot separator matches `session-summary-row.tsx` precedent. `formatVolume` for the gap, `formatWeight` for the suffix weight (per the unit-handling rule). |
| 6 | First-time training (no previous max) | Hide the strip entirely (`return null`). | Lowest-risk; matches `measurements-progress-strip.tsx:43-44` null-on-empty pattern. Avoids polluting the UI on every never-done exercise. |
| 7 | Already surpassed | Show celebratory variant: `"New PR! +{formatVolume(overflowKg, unit)} over previous best"`. No emoji (cross-platform render risk). Use blue accent (`text-blue-500 dark:text-blue-400`) — green isn't a token in this codebase. | Celebration without the reps-left clause (which would be negative/nonsensical). Reuses the same row position so the layout doesn't jump. |
| 8 | Current weight 0/null | Show only `"To beat PR: {formatVolume(gapKg, unit)}"` — drop the reps clause. | Cannot divide by zero; cannot render `Infinity reps`. Graceful degradation. |
| 9 | kg → unit conversion | Math entirely in kg internally. `formatVolume(kg, unit)` for the gap and overflow numbers (uses k-abbreviation ≥1000). `formatWeight(kg, unit)` for the `@ Wkg` suffix (one decimal). | Mirrors the standard already used everywhere (`weekly-volume-strip.tsx:106`, `set-input.tsx:39-43`). |
| 10 | History/non-live gating | New prop `showVolumeTarget?: boolean` on `<ExerciseBlock>`, default `false`. Live workout passes `true`; history detail and any other current caller omit it. | Decoupled from `showCheckable` so the two concerns can evolve independently. Default-off keeps history detail untouched. |
| 11 | Per-block hook fan-out | Stay with the per-block `useExerciseProgress(ex.id)` (≤8 parallel queries with 30s staleTime, gcTime 24h). Defer the batched `useExerciseMaxVolumes(ids[])` to v2 unless profiling shows cold-start lag. | TanStack dedupes & caches; cache is shared with the per-exercise progress screen for higher-leverage reuse. Premature batching loses that. |
| 12 | Reps-left math | `repsToBeat = (previousMaxKg - runningKg) / currentWeightKg`, computed in kg. Strip clamps to `Math.max(0, value)` only in the `chasing` state. Displayed as `.toFixed(1)`. | Per the prompt ("can be shown with floating points like '7.2 reps'"). Internal kg arithmetic; only the display goes through formatters. |

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `src/utils/volume-target.ts` | new | Pure helper `computeVolumeTarget({ sessionsForExercise, currentSessionId, currentSessionSets })` returning a discriminated union `VolumeTargetState`. Implements the volume kernel (skip warmups, guard `weight > 0 && reps > 0`, `parseFloat` numeric strings) for both the previous-max reduce over `SessionSets[]` and the running-session reduce over `SetRow[]`. Picks "current weight" as the last `SetRow` with finite positive weight in `currentSessionSets` (any set type). Returns `null`-equivalent state when no previous-max session exists. |
| `src/components/exercise-volume-target.tsx` | new | Presentational component receiving `state: VolumeTargetState`, `unit: WeightUnit`. Renders the three visual states (no-pr → returns `null`; chasing → muted caption + bold gap and reps clause; surpassed → celebratory line with overflow). Uses `accessibilityRole="text"` plus an `accessibilityLabel` summarizing the goal for VoiceOver. NativeWind tokens consistent with `weekly-volume-strip.tsx`. |
| `src/components/exercise-block.tsx` | edited | Add `showVolumeTarget?: boolean` (default `false`) and an exercise-id prop dependency (already have `exercise.id` via `exercise`). When `showVolumeTarget` is true, call `useExerciseProgress(exercise.id)`, compute the state with `useMemo` on `[progressQ.data, sets]`, and render `<ExerciseVolumeTarget state={state} unit={unit} />` between the header `View` (closes at line 152) and the column-header row (starts at line 154). When `showVolumeTarget` is false, the new hook is not subscribed and the new render is skipped (use a thin internal sub-component so the conditional hook stays at component-render-tree level, not call-order level — see Contratos). |
| `app/(app)/workout/[sessionId].tsx` | edited | Pass `showVolumeTarget` (single boolean) to each `<ExerciseBlock>` in the live-workout list. No other change — `sets`, `unit`, `exercise.id` are already passed. |
| `src/utils/volume-target.test.ts` | new (if Tester chooses unit tests; otherwise Tester picks an e2e probe per Discovery #10) | Unit tests for the helper across the three states + edge cases (warmup-only session, null weight, surpassed-and-still-logging, lbs preference). |

No changes to: `src/api/progress.ts`, `src/hooks/use-progress.ts`, `src/hooks/use-sets.ts`, `src/api/sets.ts`, `src/lib/query-client.ts`, schema, RLS.

## Contratos de I/O

### `src/utils/volume-target.ts`
```ts
import type { SetRow } from "~/db/types";
import type { SessionSets } from "~/api/progress";

export type VolumeTargetState =
  | { kind: "no-pr" }
  | {
      kind: "chasing";
      previousMaxKg: number;
      runningKg: number;
      gapKg: number;            // = previousMaxKg - runningKg, > 0
      currentWeightKg: number | null; // null when no usable weight in session
      repsToBeat: number | null; // null when currentWeightKg is null
    }
  | {
      kind: "surpassed";
      previousMaxKg: number;
      runningKg: number;
      overflowKg: number;       // = runningKg - previousMaxKg, > 0
    };

export type ComputeVolumeTargetInput = {
  /** All finished-session set groups for this exercise, from
   *  `useExerciseProgress(exerciseId)`. May be undefined while loading. */
  sessionsForExercise: SessionSets[] | undefined;
  /** Session ID of the current live session — defensive guard in case the
   *  cache ever bleeds (it doesn't today: `listSetsForExercise` filters
   *  `ended_at IS NOT NULL`). */
  currentSessionId: string;
  /** Session-scoped sets for this exercise, from the live screen
   *  (`setsByExercise.get(ex.id)`). */
  currentSessionSets: SetRow[];
};

export function computeVolumeTarget(
  input: ComputeVolumeTargetInput,
): VolumeTargetState;
```

Kernel rules (must match the canonical kernel — see Discovery and `app/(app)/exercises/[id]/progress.tsx:62-93`):
- For both reductions: iterate sets, skip `set_type === "warmup"`, parse `weight` with `parseFloat`, accept only `Number.isFinite(w) && w > 0 && Number.isFinite(r) && r > 0`, accumulate `w * r`.
- `previousMaxKg = Math.max(...sessionsForExercise.map(sessionVolume))`. If the array is empty OR every session sums to 0, return `{ kind: "no-pr" }`.
- Defensive: if any `SessionSets.session_id === currentSessionId`, exclude that group from the max. (Belt-and-suspenders against the cache contract.)
- `runningKg` reduces `currentSessionSets` with the same kernel. Includes unchecked drafts (no `completed_at` filter).
- `currentWeightKg`: walk `currentSessionSets` backwards (array is already chronologically ordered by `set_number` in the live screen), return the first `SetRow` where `parseFloat(weight)` is finite and `> 0`. No set-type filter (a warmup ramp tells you what weight you're on; if user has only logged warmups, that's still "the current weight"). Returns `null` when no candidate row.
- `repsToBeat`: only computed in the `chasing` branch and only when `currentWeightKg != null`. Value is `(previousMaxKg - runningKg) / currentWeightKg`. Helper does not call `.toFixed`; that's a display concern.
- Equality edge case (`runningKg === previousMaxKg`): treated as `surpassed` with `overflowKg = 0` would feel wrong ("New PR! +0 kg"). Tie goes to `chasing` with `gapKg = 0` → which the strip should render as "Matching your PR — one more rep beats it." Simpler rule: `gapKg > 0` → chasing; `gapKg <= 0 && previousMaxKg > 0` → surpassed-or-tied; treat `gapKg === 0` as surpassed-tied (special copy below). To avoid branching explosion in v1, **collapse the tie into `chasing` with `gapKg = 0`, `repsToBeat = 0`**, and let the chasing template render naturally as "To beat PR: 0 kg · ≈ 0.0 reps @ Wkg" — visually weak but correct. Stronger UX is out of scope for v1.

### `src/components/exercise-volume-target.tsx`
```ts
import type { WeightUnit } from "~/db/types";
import type { VolumeTargetState } from "~/utils/volume-target";

type Props = {
  state: VolumeTargetState;
  unit: WeightUnit;
};

export function ExerciseVolumeTarget(props: Props): JSX.Element | null;
```

Render rules:
- `state.kind === "no-pr"` → return `null`.
- `state.kind === "chasing"`:
  - Container: `View` with `className="px-4 py-2 border-b border-gray-100 dark:border-gray-900"`.
  - Single `Text` with `className="text-sm text-gray-500"` containing two `Text` children: the leading caption `"To beat PR: "` and a bold value `<Text className="font-semibold text-black dark:text-white tabular-nums">{formatVolume(gapKg, unit)}</Text>`. If `repsToBeat != null && currentWeightKg != null`, append ` · ≈ ` then bold `<Text className="font-semibold tabular-nums">{`${repsToBeat.toFixed(1)} reps`}</Text>` then ` @ ${formatWeight(currentWeightKg, unit)}`.
  - `accessibilityLabel="Need {formatVolume(gapKg, unit)} more to beat your previous best. About {repsToBeat.toFixed(1)} reps at {formatWeight(currentWeightKg, unit)}."` (drop the second sentence when reps-clause is hidden).
- `state.kind === "surpassed"`:
  - Same container.
  - Single `Text className="text-sm font-semibold text-blue-500 dark:text-blue-400 tabular-nums"`: `New PR! +{formatVolume(overflowKg, unit)} over previous best`.
  - `accessibilityLabel="New personal record. {formatVolume(overflowKg, unit)} over your previous best."`

### `src/components/exercise-block.tsx` (edited props)
```ts
type Props = {
  exercise: ExerciseRow;
  sets: SetRow[];
  unit: WeightUnit;
  isFirst?: boolean;
  isLast?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onAddSet: (input: { set_type: SetType; parent_set_id?: string | null }) => void;
  onUpdateSet: (id: string, patch: { reps: number | null; weight: string | null; rpe: string | null; notes: string | null }) => void;
  onDeleteSet: (id: string) => void;
  onRemove?: () => void;
  removeDisabled?: boolean;
  showCheckable?: boolean;
  onToggleSetChecked?: (setId: string, nextChecked: boolean) => void;
  /** Live-session only. When true, the block subscribes to
   *  `useExerciseProgress(exercise.id)` and renders a one-line strip below
   *  the header comparing running session-volume to the previous best.
   *  Default: false. */
  showVolumeTarget?: boolean;
  /** Defensive: required when `showVolumeTarget === true`. Used to exclude
   *  the active session from the previous-max reduction in case the cache
   *  ever contains it (today it does not — see `progress.ts:14`). */
  sessionId?: string;
};
```

Conditional-hook handling: the `useExerciseProgress` call inside `<ExerciseBlock>` would be a conditional hook if guarded by `showVolumeTarget`. Two clean options:
- **Option X (preferred)**: extract a thin `<VolumeTargetSlot>` sub-component that takes `exercise.id`, `sets`, `unit`, `sessionId` and is rendered conditionally by the parent. The hook lives unconditionally inside the sub-component. When `showVolumeTarget === false`, the sub-component is not mounted and the hook is never subscribed.
- Option Y: always call `useExerciseProgress(showVolumeTarget ? exercise.id : undefined)` and let the hook's `enabled` flag short-circuit (`use-progress.ts:9` already has `enabled: !!exerciseId`). Slightly wasteful (creates a query object for every history-detail render), but legal and shorter.

**Pick Option X** — cleaner hook hygiene, no wasted query observers on history detail.

### `app/(app)/workout/[sessionId].tsx` (edited)
- Add `showVolumeTarget` and `sessionId={sessionId}` to the `<ExerciseBlock>` props at line 317-378. Single-line addition.

### DB columns / queries
None added, none changed. Reads use existing `["progress", exerciseId]` and `["sets", sessionId]` query keys.

## UI spec — one-line strip pseudo-code

Three states, all rendered in the same DOM position (between header and column-row):

```
// State A: no-pr (first time logging this exercise)
// → return null. No DOM, no row.

// State B: chasing (gap > 0, with current weight available)
┌──────────────────────────────────────────────────────────────────┐
│ To beat PR: **120 kg** · ≈ **7.2 reps** @ 80.0 kg                 │  text-sm text-gray-500
└──────────────────────────────────────────────────────────────────┘  bold = text-black dark:text-white, tabular-nums

// State B': chasing (gap > 0, no current weight)
┌──────────────────────────────────────────────────────────────────┐
│ To beat PR: **120 kg**                                            │
└──────────────────────────────────────────────────────────────────┘

// State C: surpassed (gap <= 0, previousMaxKg > 0)
┌──────────────────────────────────────────────────────────────────┐
│ **New PR! +180 kg over previous best**                            │  text-sm font-semibold
└──────────────────────────────────────────────────────────────────┘  text-blue-500 dark:text-blue-400
```

Padding/border match the existing column-row (`px-4 py-2 border-b border-gray-100 dark:border-gray-900`) so the strip reads as a contiguous block with the table header.

VoiceOver behavior: chasing state announces "Need 120 kilograms more to beat your previous best. About 7.2 reps at 80 kilograms." Surpassed state announces "New personal record. 180 kilograms over your previous best."

## Riscos

- **Data integrity (RLS / migrations)**: No schema change, no new query. Both `useExerciseProgress` and `useSetsForSession` already enforce `auth.uid() = user_id` and `deleted_at IS NULL`. The defensive `currentSessionId` exclusion in the helper guards against a hypothetical cache-contract change in `listSetsForExercise` (today it filters `ended_at IS NOT NULL`, so the active session is never in `["progress", *]`).
- **UX regressions on shared `<ExerciseBlock>`**: history detail (`app/(app)/history/[id].tsx:240-272`) shares the component. The new prop defaults to `false`, and history detail does not pass it. Verified by reading `history/[id].tsx`. No other current caller passes the new prop. Tester should add an assertion that the strip does NOT render on history detail.
- **Cache mid-session staleness**: `["progress", exerciseId]` is invalidated only on `useFinishSession.onSuccess` and `useUpdateSessionTimes.onSuccess`. This is the desired behavior — the "previous best" denominator is intentionally stable across the entire live session. The running number updates because `useSetsForSession` invalidates on every set mutation, the `sets` prop changes, and the helper's `useMemo` recomputes. Documented; not a bug.
- **Discrepancy between live strip and post-Finish history**: because we count unchecked drafts in `runningKg`, a user who logs 800 kg of drafts and then discards-unchecked at Finish will see "800 kg" mid-workout and "0 kg" in history detail. Acceptable per Discovery #6, but worth flagging to the user — *not* solved in this design; the strip's job is mid-workout motivation.
- **Equality tie (`gapKg === 0`)**: renders as `"To beat PR: 0 kg · ≈ 0.0 reps @ Wkg"`. Visually weak. Acceptable for v1 (rare edge case; the user is one rep away from a clean PR display). Polish deferred.
- **Platform divergence (iOS / Android / web)**: zero. RN `Text` + NativeWind + `tabular-nums` works across all three (`session-header.tsx:33` precedent). No native-only APIs, no flex quirks.
- **Performance — per-block hook fan-out**: N parallel `useExerciseProgress` subscriptions on workout mount (N = `orderedExercises.length`, typically 4-8, capped softly at maybe 12-14 for an unusually long routine). At 30s staleTime / 24h gcTime, this is a one-time fetch per exercise per cache-cold session. The shared cache key `["progress", exerciseId]` also powers the per-exercise progress screen, so navigating live → progress → live reuses warm cache. Memory footprint is `O(total finished sets touching this exercise across all time)` per exercise — bounded by the user's actual history (single-digit MB worst case). Acceptable. Re-evaluate if profiling shows cold-start lag, then batch into `useExerciseMaxVolumes(ids[])`.
- **Performance — render cost**: `useMemo` keyed on `[progressQ.data, sets]` reduces both arrays in single-digit ms even for heavy users. No new RN trees on every set-typed character (the existing `<SetInput>` debounce already smooths `weight`/`reps` writes).
- **Accessibility**: strip is `accessibilityRole="text"`. VoiceOver will read the `accessibilityLabel` string. Tap target N/A. Manual smoke test in Tester scope.
- **Edge: lbs preference**: `formatVolume` and `formatWeight` both branch on `unit`; math stays in kg internally; the divider line `(previousMaxKg - runningKg) / currentWeightKg` is unitless-on-the-output (reps), so unit display is purely cosmetic. No mixed-unit bug surface.
- **Edge: dropset rows**: counted in volume (no special case in the kernel). Confirmed correct by the canonical precedent (`progress.tsx:62-93`).

## Alternativas descartadas

1. **(Alt to Decision 1) Batched screen-level `useExerciseMaxVolumes(exerciseIds)` hook** — single PostgREST call with `.in("exercise_id", ids)`, computed-max projection on the client. Descartada porque (a) the per-block hook is already cache-shared with the exercise progress screen for higher-leverage reuse, (b) cold-start fan-out at N ≤ 8 is not a measured problem, (c) the batched form duplicates network code without solving a real bottleneck. Deferred to v2 if profiling shows lag.

2. **(Alt to Decision 2) Use the most recently CHECKED set (post-F10 semantics) as "current weight"** — stable, matches "what user confirmed". Descartada porque most users only check at end of exercise, so the strip would render with no reps-clause for the entire first half of the exercise — exactly the moment the motivation is most useful. The chosen "most recently logged" semantics updates immediately as the user types, with a graceful null-fallback for the empty case.

3. **(Alt to Decision 6) On first-time-logging-the-exercise, show "First time logging this — every working set is a PR" caption** — friendlier copy. Descartada porque (a) the strip would render N times for every just-added exercise the user hasn't trained yet, polluting the UI; (b) the `null` precedent in `measurements-progress-strip.tsx:43-44` is the established pattern; (c) Strong does not show "first time" copy here, and Discovery flagged Strong-divergence as candidate friction (`docs/iphone-shakedown.md:3`).

4. **(Alt to Decision 7) Use a celebratory emoji ("🎉 New PR!")** — more delightful. Descartada porque cross-platform emoji rendering on RN web is inconsistent (color font on web, system font on iOS, Noto Color on Android). The blue accent (already a codebase token) carries the celebration without the rendering risk.

5. **(Alt to Decision 10) Reuse `showCheckable` as the live-only gate instead of a new `showVolumeTarget` prop** — fewer props. Descartada porque the two concerns are logically independent: a future surface might want set-checking without volume targets (or vice versa). The marginal prop cost is worth the future-proofing, and matches the codebase's pattern of explicit feature flags over implicit coupling.

6. **(Alt to Decision 11 / Option X) Conditional `useExerciseProgress(showVolumeTarget ? exercise.id : undefined)` and rely on the hook's `enabled` flag** — fewer files. Descartada porque it instantiates a query observer on every `<ExerciseBlock>` render in history detail (where the prop is `false`), and the `<VolumeTargetSlot>` sub-component keeps the hook hygiene clean while costing only ~15 LOC.

## Out of scope
- Editing the target weight manually (Discovery #2 option d).
- Showing the strip on history detail or the per-exercise progress screen.
- Whole-session volume target (per-session-total vs per-exercise).
- Per-muscle aggregate volume target ("chest to beat").
- PR-table denormalization / Postgres trigger (counter to Decision 8).
- Notifications / haptics on PR achievement.
- Estimated-1RM-based targets (`epley1RM`-style).
- Range-bound previous-max ("best in last 90 days").
- Polished "matching your PR" tie copy (`gapKg === 0`).
- Cache-buster bump (N/A, no schema change).
- Batched `useExerciseMaxVolumes(ids[])` hook (deferred to v2).

## Open questions for Validator
1. **`<VolumeTargetSlot>` extraction** — comfortable with the sub-component pattern to keep the hook unconditional? Alternative is the slightly-wasteful Option Y (single conditional hook). Both are correct; preference?
2. **`sessionId` prop necessity** — defensive against a contract change that hasn't happened. Worth carrying, or trim it (and the helper's `currentSessionId` param) until evidence of risk?
3. **Tie copy (`gapKg === 0`)** — acceptable to render as "To beat PR: 0 kg" for v1, or escalate to a polished "Matching your PR" copy here?
4. **Surpassed-state color token** — blue (`text-blue-500 dark:text-blue-400`, already in use as the positive/active accent) vs introducing a green token. v1 picks blue; objection?
5. **Defensive include unchecked drafts in current-weight pick** — we walk backwards through all `currentSessionSets` regardless of `completed_at` and regardless of `set_type` (including warmups) for the "what weight is the user on" pick. Validator should confirm this matches the intent (it does match Discovery #2 (b)). If warmups should be excluded, this is a one-line change.
