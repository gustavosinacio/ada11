# Design v1 — 2026-05-24_2233_sessions-list-on-progress-chart

## Goal (1 sentence)
Append a reverse-chronological "Sessions" list to `app/(app)/exercises/[id]/progress.tsx` so each finished session that included this exercise renders as a tap-through row (date + aggregate "N × volume" summary) routing to `/(app)/history/{sessionId}`, reading the data the screen already has via `useExerciseProgress(id)` — no new query, no schema change.

## Approach
The screen already mounts `useExerciseProgress(id)`, which returns `SessionSets[]` sorted ASC. We reverse it in a `useMemo`, gate the entire section behind the same `e1rmData.length > 0` check the existing empty-state copy uses (preserving the three pinned e2e assertions on `/No working sets recorded yet/i`), and render an exercise-scoped row component. Reuse of `<SessionSummaryRow>` is intentionally rejected: `listSetsForExercise` does not project `sessions.name` or `sessions.ended_at`, and the prompt forbids new queries — synthesizing a fake `SessionRow` would be brittle (duration would always be 0, name would always be "Workout"). Format is the aggregate "4 × 12,400 kg" form (`workingSetCount × formatVolume(sumPastVolume(sets), unit)`), which is the canonical kernel the chart already plots; per-set "100×8, 100×8, …" is deferred as an optional follow-up. The pure summary kernel lives in a new helper module so it can be unit-tested without RNTL. We render with `.map()` inside the existing `<ScrollView>` (no `<FlatList>` inside a `<ScrollView>` — that's an RN anti-pattern); typical N is O(10²) for a serious lifter and the chart already iterates the same array, so no virtualization is needed.

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `app/(app)/exercises/[id]/progress.tsx` | edited | Add a `useMemo` over `progressQ.data` that produces a DESC-sorted shallow copy of `SessionSets[]`. Add a new "Sessions" section below the existing `<View className="gap-8">` chart container, gated by the same `e1rmData.length > 0` check that already gates the charts. Section header `<Text>` styled as `mt-10 mb-2 text-lg font-semibold text-black dark:text-white` (matches existing screen typography). Body is a `.map()` over the reversed list, rendering `<ExerciseSessionRow session={s} unit={unit} onPress={() => router.push('/(app)/history/${s.session_id}')} />` per session. No change to the loading guard, the existing memo, or the chart container. |
| `src/components/exercise-session-row.tsx` | new | Pure presenter row component. Single responsibility: render one `SessionSets` as a tappable summary row. Visual idiom mirrors `<SessionSummaryRow>` (border-bottom, active state, ChevronRight). Two-line text: line 1 = `formatDisplayDate(started_at, { includeWeekday: true })`; line 2 = the aggregate label from `presentExerciseSessionRow`. Wired to call `onPress`. No business logic — delegates all math to the helper. |
| `src/utils/exercise-session-row-format.ts` | new | Pure presenter helper `presentExerciseSessionRow({ sets, unit })`. Returns `{ count, volumeKg, volumeLabel }`. `count = sets.filter(s => s.set_type !== "warmup").length`. `volumeKg = sumPastVolume(sets)` (imported from `volume-target`). `volumeLabel = ${count} × ${formatVolume(volumeKg, unit)}` when `count > 0 && volumeKg > 0`, else empty string. Returning the parts (not only the label) lets the consumer style or split if needed and makes the unit test assertions precise. |
| `src/utils/volume-target.ts` | edited | Export `sumPastVolume`. Currently `function sumPastVolume(...)` (lines 68-79); change to `export function sumPastVolume(...)`. Single-line diff. No behavior change — already canonical, already used internally by `computeVolumeTarget`. Justification for breaking the "one responsibility per file change" rule does not apply: this is the export of an already-defined private helper, not two changes in one file. |
| `tests/unit/exercise-session-row-format.test.ts` | new | Vitest. Cases: (1) all-working 4 sets at 100kg×8 → `{ count: 4, volumeKg: 3200, volumeLabel: "4 × 3,200 kg" }`; (2) warmup + 3 working → warmups excluded from both `count` and `volumeKg`; (3) sets with `weight = null` or `reps = 0` → excluded; (4) all-warmup → `{ count: 0, volumeKg: 0, volumeLabel: "" }`; (5) `unit: "lbs"` → conversion applied to `volumeLabel` via `formatVolume`. |

## Contratos de I/O

### `presentExerciseSessionRow` (new pure helper)
```ts
// src/utils/exercise-session-row-format.ts
import type { SetRow, WeightUnit } from "~/db/types";
import { sumPastVolume } from "~/utils/volume-target";
import { formatVolume } from "~/utils/units";

export type ExerciseSessionRowPresentation = {
  /** Working-set count: sets where set_type !== "warmup". Does NOT require
   *  weight/reps to be present — counts the row even if it has null weight,
   *  so the count matches the user's perception of "I did 4 sets" even when
   *  one was logged sloppily. */
  count: number;
  /** Volume in kg, via canonical `sumPastVolume` (warmup-skip, w>0 && r>0). */
  volumeKg: number;
  /** "{count} × {formatVolume(volumeKg, unit)}" when count > 0 && volumeKg > 0,
   *  else "". Empty string is the "render nothing visible" sentinel so the
   *  row's line-2 can be conditionally suppressed by the consumer. */
  volumeLabel: string;
};

export function presentExerciseSessionRow(input: {
  sets: SetRow[];
  unit: WeightUnit;
}): ExerciseSessionRowPresentation;
```

### `<ExerciseSessionRow>` (new component)
```ts
// src/components/exercise-session-row.tsx
import type { SessionSets } from "~/api/progress";
import type { WeightUnit } from "~/db/types";

type Props = {
  session: SessionSets;          // { session_id, started_at, sets }
  unit: WeightUnit;
  onPress: () => void;
};

export function ExerciseSessionRow(props: Props): JSX.Element;
```

Visual / a11y spec:
- Root: `<Pressable accessibilityRole="button" accessibilityLabel={`Open session from ${formatDisplayDate(started_at, { includeWeekday: true })}`} className="border-b border-gray-100 px-4 py-4 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950">`.
- Inner row: `<View className="flex-row items-center justify-between">`.
- Left column (`flex-1 pr-3`):
  - Line 1: `<Text className="text-base font-semibold text-black dark:text-white">{formatDisplayDate(started_at, { includeWeekday: true })}</Text>`.
  - Line 2 (only if `volumeLabel !== ""`): `<Text className="mt-0.5 text-sm text-gray-500">{volumeLabel}</Text>`.
- Right column: `<ChevronRight color="#9ca3af" size={18} />` (matches `<SessionSummaryRow>`).

### Host screen changes (`progress.tsx`)

Added memo (one new):
```ts
const sessionsDesc = useMemo(
  () => [...(progressQ.data ?? [])].reverse(),
  [progressQ.data],
);
```

Added section (inserted after the closing `</View>` of the `gap-8` chart container, still inside the `e1rmData.length > 0 ? ... : ...` truthy branch):
```tsx
<View className="mt-10">
  <Text className="mb-2 text-lg font-semibold text-black dark:text-white">
    Sessions
  </Text>
  <View>
    {sessionsDesc.map((s) => (
      <ExerciseSessionRow
        key={s.session_id}
        session={s}
        unit={unit}
        onPress={() => router.push(`/(app)/history/${s.session_id}`)}
      />
    ))}
  </View>
</View>
```

Restructure note: the existing `<View className="gap-8">` wraps only the two charts; to keep the `gap-8` from also pulling the "Sessions" section into chart spacing, the new section is a *sibling* `<View>` of the chart container, not a child. Both live inside the truthy branch of the `e1rmData.length > 0` ternary — easiest way to do that without rewriting the ternary into an `if`/early-return is to wrap the truthy branch in a `<>` fragment:

```tsx
{e1rmData.length === 0 ? (
  <View className="items-center py-10">{/* unchanged empty state */}</View>
) : (
  <>
    <View className="gap-8">{/* unchanged chart container */}</View>
    <View className="mt-10">{/* new Sessions section */}</View>
  </>
)}
```

### Pinned test surfaces (for the Tester)
- `screen.getByLabelText(/Open session from /)` matches each row's `accessibilityLabel`. Cardinality assertion: count equals `sessions.length`.
- `screen.getByText(/^\d+ × [\d,]+ kg$/)` for the aggregate format on at least one row in a fixture with a working set.
- `screen.getByText("Sessions")` for the section header.
- Negative case: when fixture sessions have only warmups (so `e1rmData.length === 0`), assert the section header is NOT in the DOM and the empty-state copy `/No working sets recorded yet/i` IS.
- Ordering: in a fixture with sessions at `2026-05-10`, `2026-05-12`, `2026-05-14`, the first row's a11y label includes `May 14` (DESC).
- Tap-through: pressing a row calls `router.push` with `/(app)/history/{id}` for the corresponding `session_id`.

### DB / RLS / migration
None. `listSetsForExercise` is unchanged. Existing `sessions`/`sets` RLS policies apply transitively.

## Riscos

### Data integrity
- **Volume kernel drift.** The chart's `Total volume` line and the new row's "X kg" must agree to the unit. Both go through the same predicate (`set_type !== "warmup"` + `w > 0 && r > 0`), but the chart inlines the math at `progress.tsx:79-86` while the new row calls `sumPastVolume`. Verified the predicates match exactly. If they ever diverge, the row and the chart for the same session would disagree by ≤1 set's volume — confusing but not destructive. **Mitigation**: the unit tests on `presentExerciseSessionRow` lock the kernel; if a future PR changes one site without the other, a test fails or the kernel becomes the single point of truth.
- **No RLS impact.** Reusing an existing query with existing policies.

### UX regressions
- **Empty-state copy pinned by 3 e2e assertions** (`tests/e2e/exercise-progress-ia.spec.ts:101,175,195`). Design gates the entire new section behind `e1rmData.length > 0`, the same gate that already controls whether the empty-state vs the charts render. Therefore the copy `/No working sets recorded yet/i` is unchanged in both presence and exact string — the assertions remain green.
- **Scroll position / layout shift on first paint.** The new section materially extends the scroll content. Users who relied on the page ending at the volume chart will need to scroll further. No prior contract; acceptable per the prompt.
- **No reuse of `<SessionSummaryRow>`** — the existing component is unchanged, so its other two consumers (`history/index.tsx`, `history/week/[isoWeek].tsx`) are unaffected. Zero regression surface on shared code.
- **Soft-deleted exercises** (Discovery unknown). `useAllExercise(id)` resolves a soft-deleted exercise for header rendering; `listSetsForExercise(exerciseId)` does not filter on `exercises.deleted_at`, so the list will continue to render historical sessions for deleted exercises. Recommended explicitly: **keep this behavior**. Rationale: the screen exists at all for soft-deleted exercises (the title bar renders the name); hiding the sessions would make the screen suddenly empty for users who navigated from history detail. No code needed.

### Platform-specific
- iOS / Android / web all share the `<ScrollView>` + `<Pressable>` + NativeWind path. `accessibilityRole="button"` + `accessibilityLabel` is the cross-platform a11y pattern used everywhere else. No divergence expected.
- Tap feedback (`active:bg-gray-50`) is a NativeWind state — works on iOS/Android, falls back gracefully on web.

### Performance
- Render cost: O(N_sessions) `<Pressable>` instances. Typical N ≈ 50; even an outlier with N = 500 is fine without virtualization (the chart already iterates the same array twice; one more `.map` is negligible). React Profiler check is unnecessary at this scale.
- Memo cost: the existing chart `useMemo` already takes O(N_sessions × N_sets_per_session). The new helper inside the row is O(N_sets_per_session) per render of that row. The new `sessionsDesc` memo is O(N_sessions). Cumulative: still well under one frame on a low-end device.
- **Should we virtualize?** No. RN's lint will warn if we nest a `<FlatList>` inside a `<ScrollView>`. The escape hatches (use `<FlashList>` with `nestedScrollEnabled` or hoist the whole screen into a single `<FlatList>` with `ListHeaderComponent={charts}`) trade meaningful complexity for an optimization the data volume does not warrant. If a user ever has >1000 sessions for one exercise (≈19 years of weekly training), we'll revisit; until then, `.map` is correct.

## Alternativas descartadas
1. **Reuse `<SessionSummaryRow>` by synthesizing a `SessionRow`** — descartada porque `listSetsForExercise` does not select `sessions.name`, `sessions.ended_at`, `sessions.notes`, `sessions.routine_id`, or `sessions.user_id`. Faking those (e.g. `name: null`, `ended_at: started_at`) would make the row display `"Workout · in 0m"` or `"Workout · 0m"`, semantically wrong and visibly broken. Extending `listSetsForExercise` to project the missing columns violates the prompt's "no new query" constraint and would silently widen the query payload for every chart render. The new presenter is ~30 lines and avoids both costs.
2. **Per-set "100×8 · 100×8 · 110×6" line as the primary format** — descartada porque (a) it wraps or overflows on phones for 6+ sets, (b) the aggregate is the canonical kernel the chart already plots so it stays consistent cross-screen, and (c) the prompt presented both as alternatives, not a hybrid requirement. Deferred to "Out of scope" as a follow-up enhancement (e.g. an `expandable` accordion or a second line under the aggregate).
3. **Hoist the whole screen into a `<FlatList ListHeaderComponent={charts}>`** — descartada porque the existing screen has a stable structure (header → subline → empty-state-or-charts), the charts inside `ListHeaderComponent` would re-render on every list re-render unless memoized carefully, and the perf win (virtualization) is unnecessary at expected scale. The cost (refactor a working screen) outweighs the benefit. Re-evaluate only if a user reports lag with hundreds of sessions.
4. **Render the list inside the `<View className="gap-8">` chart container as a third "card"** — descartada porque `gap-8` would put 32px between the volume chart and the list, which under a "Sessions" header reads as awkward whitespace; the section semantically is *not* a chart and should be visually separated, not co-spaced with the two charts. Sibling `<View className="mt-10">` is cleaner.

## Out of scope
- **Per-set "100×8 · 100×8" detail** under the aggregate. Designable as a v2: secondary `text-xs text-gray-500` line below `volumeLabel`, joined by `" · "`, warmups excluded. Pure addition to `presentExerciseSessionRow`'s return shape.
- **`max_volume_window_weeks` filter** — the source comment at `progress.tsx:22-34` explicitly defers this for the per-exercise screen. The new list inherits "all sessions, no window". If a separate "per-exercise window" preference is ever introduced, the new memo can take a `windowStartMs` param and filter at the session level (same idiom as `computeVolumeTarget`).
- **Session name / duration / notes** in the row — would require extending `listSetsForExercise` to project `sessions.name, sessions.ended_at, sessions.notes`. Not done here per the "no new query" constraint.
- **Routine context** ("Push A", "Legs · Routine X") — not in the current data flow and not requested.
- **Mutation affordances** (delete a session from this list, edit a set) — read-only navigation surface only. Delete lives in `/(app)/history/{id}`.
- **Pagination / windowing** — typical N is small enough that pagination is unnecessary; revisit only at >1000 rows.
- **Virtualization** — see Performance above.
- **Sticky section header** — the page is short enough that the "Sessions" label stays in view via natural scroll position; no `<SectionList>`.

## Confidence / Risk
- **Confidence**: HIGH. Discovery enumerated the canonical kernels, the data shape, the routing target, and the pinned test assertions; this design wires them with no novel constructs.
- **Risk**: LOW. New files (`exercise-session-row.tsx`, `exercise-session-row-format.ts`, `exercise-session-row-format.test.ts`) are additive. The one-line edit to `progress.tsx` is gated by an existing condition. The `volume-target.ts` edit is a visibility change (`function` → `export function`) on an already-defined helper, no behavior shift. No DB/RLS/migration touch.
