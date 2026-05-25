# Design v2 — 2026-05-24_2233_sessions-list-on-progress-chart

Round 2 of ≤3. Addresses every blocker and major from `validation-v1.md`.

## Diff from v1

1. **BLK-1 (regex unit-agnostic).** Pinned aggregate regex changed from `^\d+ × [\d,]+ kg$` to `^\d+ × [\d,]+ (kg|lbs)$`. Tester plan now requires an explicit lbs-mode e2e case in addition to the unit-test fixture (the unit-test fixture alone is not sufficient — the regex is asserted at the screen level, not just at the helper level).

2. **MAJ-1 (same-day a11y collision).** A11y label now disambiguates by time-of-day. Chosen option (a): `formatDisplayDate(started_at, { includeWeekday: true, includeTime: true })` — verified in `src/utils/format-display-date.ts:103-107` that `includeTime` is supported (it switches the call to `d.toLocaleString` with `hour: "numeric"` + `minute: "2-digit"`). Visible date stays as `formatDisplayDate(started_at, { includeWeekday: true })` (no time) so the row layout is unchanged.

3. **MAJ-2a (section header styling).** Header now uses the cross-screen `SECTION_HEADER` token. The token is currently a local `const` in `app/(app)/history/week/[isoWeek].tsx:20-21` (`"mt-4 mb-2 text-sm font-medium uppercase text-gray-500"`). Two sub-options were considered:
   - Inline the same literal classes on `progress.tsx` (lower-risk, no refactor).
   - Hoist `SECTION_HEADER` into a shared module and import from both call sites (cleaner, but a refactor outside this feature's scope).
   Chosen: **inline the same literal** at `progress.tsx`, with a code comment `// keep in sync with SECTION_HEADER on history/week/[isoWeek].tsx`. The hoist is filed under "Out of scope" as a small follow-up.

4. **MAJ-2b (horizontal alignment).** Chose option (a) per the Validator's recommendation: **drop `px-4` on the new row** so the ambient `px-6` from the screen body wins. Row content's left edge then aligns with the chart container. This matches the chart alignment within the same screen (which is the screen-local consistency the user looks at first). Edge-to-edge `-mx-6` (option b) was rejected because the per-exercise progress screen is a single scroll surface and edge-to-edge rows look detached from the chart container above them; on `/history` the rows live in a `FlatList` that owns the whole screen, so edge-to-edge there is natural.

5. **MIN-1.** Added a one-line entry under "Alternativas descartadas" naming the structural-subset (`Pick<SessionRow, ...>`) variant and explaining why it still doesn't fit (row reads `session.name` + an "In progress" badge driven by `session.ended_at == null`, both of which would render wrong on every row in this data flow).

6. **MIN-2.** Added JSDoc on `ExerciseSessionRowPresentation` explicitly documenting why `count` and `volumeKg` are returned alongside `volumeLabel` (unit-test ergonomics + a future per-set secondary line that needs `count` to decide whether to render the secondary).

7. **MIN-3.** Added an explicit "long-page screenshot from a deep link" capture to the Tester surface section.

8. **MIN-5.** Verified `useFinishSession` invalidates `["progress"]` (`src/hooks/use-sessions.ts:63`) and that the per-exercise key is `["progress", exerciseId]` (`src/hooks/use-progress.ts:7`). TanStack Query's `invalidateQueries({ queryKey })` defaults to prefix-match (`exact: false`), so `["progress"]` invalidates every key starting with `["progress", ...]` — `["progress", exerciseId]` is covered. No design change required. Documented in "Riscos · Data integrity" as a verified assumption.

(MIN-4 was a naming-symmetry observation, MIN-6 was a no-op confirmation — neither requires a v2 change.)

---

## Goal (1 sentence)
Append a reverse-chronological "Sessions" list to `app/(app)/exercises/[id]/progress.tsx` so each finished session that included this exercise renders as a tap-through row (date + aggregate "N × volume" summary) routing to `/(app)/history/{sessionId}`, reading the data the screen already has via `useExerciseProgress(id)` — no new query, no schema change.

## Approach
The screen already mounts `useExerciseProgress(id)`, which returns `SessionSets[]` sorted ASC. We reverse it in a `useMemo`, gate the entire section behind the same `e1rmData.length > 0` check the existing empty-state copy uses (preserving the three pinned e2e assertions on `/No working sets recorded yet/i`), and render an exercise-scoped row component.

Reuse of `<SessionSummaryRow>` is intentionally rejected: `listSetsForExercise` does not project `sessions.name` or `sessions.ended_at`, and the prompt forbids new queries — synthesizing a fake `SessionRow` would be brittle (duration would always be 0, name would always be "Workout", and the row's "In progress" badge would fire on every row because `ended_at` would be missing/equal to `started_at`).

Format is the aggregate "4 × 12,400 kg" form (`workingSetCount × formatVolume(sumPastVolume(sets), unit)`), unit-aware (kg or lbs). Per-set "100×8, 100×8, …" is deferred as an optional follow-up. The pure summary kernel lives in a new helper module so it can be unit-tested without RNTL.

Rendering is `.map()` inside the existing `<ScrollView>` (no `<FlatList>` inside a `<ScrollView>` — that's an RN anti-pattern); typical N is O(10²) for a serious lifter and the chart already iterates the same array, so no virtualization is needed.

Section header uses the same `mt-4 mb-2 text-sm font-medium uppercase text-gray-500` classes that `/history/week/[isoWeek].tsx` uses for its own "Sessions" section, keeping cross-screen visual consistency. Horizontal alignment lets the ambient `px-6` on the screen body govern row indent (rows align with chart container's left edge — same screen, same vertical line).

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `app/(app)/exercises/[id]/progress.tsx` | edited | (a) Add `useMemo` over `progressQ.data` that produces a DESC-sorted shallow copy of `SessionSets[]`. (b) Add a new "Sessions" section below the existing `<View className="gap-8">` chart container, gated by the same `e1rmData.length > 0` check that already gates the charts. Section header uses the `SECTION_HEADER` literal `"mt-4 mb-2 text-sm font-medium uppercase text-gray-500"` (with a code comment pointing at the precedent on `history/week/[isoWeek].tsx:20-21`). (c) Body is a `.map()` over the reversed list rendering `<ExerciseSessionRow session={s} unit={unit} onPress={() => router.push('/(app)/history/${s.session_id}')} />`. No change to the loading guard, the existing memo, or the chart container. |
| `src/components/exercise-session-row.tsx` | new | Pure presenter row component. Single responsibility: render one `SessionSets` as a tappable summary row. Visual idiom mirrors `<SessionSummaryRow>` (border-bottom, active state, ChevronRight) **except** the row does not apply its own horizontal padding (`px-4` dropped in v2) — the ambient `px-6` on the host screen body governs indent. Two-line text: line 1 = visible `formatDisplayDate(started_at, { includeWeekday: true })`; line 2 = the aggregate label from `presentExerciseSessionRow`. A11y label includes time-of-day via `formatDisplayDate(started_at, { includeWeekday: true, includeTime: true })` (visible date is still time-less). Wired to call `onPress`. No business logic — delegates math to the helper. |
| `src/utils/exercise-session-row-format.ts` | new | Pure presenter helper `presentExerciseSessionRow({ sets, unit })`. Returns `{ count, volumeKg, volumeLabel }`. `count = sets.filter(s => s.set_type !== "warmup").length`. `volumeKg = sumPastVolume(sets)` (imported from `volume-target`). `volumeLabel = ${count} × ${formatVolume(volumeKg, unit)}` when `count > 0 && volumeKg > 0`, else `""`. |
| `src/utils/volume-target.ts` | edited | Export `sumPastVolume`. Currently `function sumPastVolume(...)` (lines 68-79); change to `export function sumPastVolume(...)`. Single-line diff. No behavior change — already canonical, already used internally by `computeVolumeTarget`. |
| `tests/unit/exercise-session-row-format.test.ts` | new | Vitest. Cases: (1) all-working 4 sets at 100kg×8 → `{ count: 4, volumeKg: 3200, volumeLabel: "4 × 3,200 kg" }`; (2) warmup + 3 working → warmups excluded from both `count` and `volumeKg`; (3) sets with `weight = null` or `reps = 0` → excluded from `volumeKg`; (4) all-warmup → `{ count: 0, volumeKg: 0, volumeLabel: "" }`; (5) `unit: "lbs"` → conversion applied to `volumeLabel` via `formatVolume`, asserting the suffix matches `lbs`. |

## Contratos de I/O

### `presentExerciseSessionRow` (new pure helper)
```ts
// src/utils/exercise-session-row-format.ts
import type { SetRow, WeightUnit } from "~/db/types";
import { sumPastVolume } from "~/utils/volume-target";
import { formatVolume } from "~/utils/units";

/**
 * Returned shape carries the parts (`count`, `volumeKg`) alongside the
 * presentation string (`volumeLabel`) for two reasons:
 *
 * 1. **Unit-test ergonomics.** The unit tests assert the underlying math
 *    independently of formatter changes — if `formatVolume`'s thousands
 *    separator ever changes locale or precision, the count/volumeKg
 *    assertions stay green and only the volumeLabel test updates.
 * 2. **Future per-set secondary line.** The deferred "100×8 · 100×8 · 110×6"
 *    secondary needs `count > 0` to decide whether to render at all; exposing
 *    `count` here lets the consumer gate without re-counting.
 */
export type ExerciseSessionRowPresentation = {
  /** Working-set count: sets where `set_type !== "warmup"`. Counts the row
   *  even if `weight`/`reps` are null/0 (matches the user's perception of
   *  "I did 4 sets" even when one was logged sloppily). */
  count: number;
  /** Volume in kg via canonical `sumPastVolume` (warmup-skip, w>0 && r>0). */
  volumeKg: number;
  /** `"{count} × {formatVolume(volumeKg, unit)}"` when `count > 0 &&
   *  volumeKg > 0`, else `""`. Empty string is the "render nothing visible"
   *  sentinel so the row's line-2 can be conditionally suppressed. */
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
- Root: `<Pressable accessibilityRole="button" accessibilityLabel={`Open session from ${formatDisplayDate(started_at, { includeWeekday: true, includeTime: true })}`} className="border-b border-gray-100 py-4 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950">`.
  - **No `px-4`** (v2 change). The host screen's ambient `px-6` governs horizontal indent so row content's left edge aligns with the chart container above.
- Inner row: `<View className="flex-row items-center justify-between">`.
- Left column (`flex-1 pr-3`):
  - Line 1 (visible date, no time): `<Text className="text-base font-semibold text-black dark:text-white">{formatDisplayDate(started_at, { includeWeekday: true })}</Text>`.
  - Line 2 (aggregate, only if `volumeLabel !== ""`): `<Text className="mt-0.5 text-sm text-gray-500">{volumeLabel}</Text>`.
- Right column: `<ChevronRight color="#9ca3af" size={18} />` (matches `<SessionSummaryRow>`).

### Host screen changes (`progress.tsx`)

Added memo (one new):
```ts
const sessionsDesc = useMemo(
  () => [...(progressQ.data ?? [])].reverse(),
  [progressQ.data],
);
```

Added section (inserted after the closing `</View>` of the `gap-8` chart container, still inside the `e1rmData.length > 0 ? ... : ...` truthy branch — wrapped in a fragment so the truthy branch can contain two siblings):
```tsx
{e1rmData.length === 0 ? (
  <View className="items-center py-10">{/* unchanged empty state */}</View>
) : (
  <>
    <View className="gap-8">{/* unchanged chart container */}</View>

    <View className="mt-6">
      {/* keep in sync with SECTION_HEADER on history/week/[isoWeek].tsx:20-21 */}
      <Text className="mt-4 mb-2 text-sm font-medium uppercase text-gray-500">
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
  </>
)}
```

Note on the outer `mt-6`: `SECTION_HEADER` already has `mt-4`. The extra `mt-6` on the wrapper compensates for the absence of the chart container's `gap-8` between charts and this new section — total separation ≈ 24px + 16px = 40px, which reads as "new section" without feeling jarring. (Verified by the Validator's MAJ-2 recommendation that sections need a deliberate vertical separator.)

### Pinned test surfaces (for the Tester)
- **`screen.getAllByLabelText(/^Open session from /)`** matches each row's `accessibilityLabel`. Cardinality assertion: count equals `sessions.length`. **Use `getAllByLabelText` (not `getByLabelText`)** because a single-row fixture would still pass `getBy*` but multi-row fixtures must use the plural form. Also: the a11y label now includes the time-of-day, so a fixture with two same-day sessions produces two distinct labels (e.g. `"Open session from Sat, May 24, 8:15 AM"` and `"Open session from Sat, May 24, 6:42 PM"`).
- **`screen.getByText(/^\d+ × [\d,]+ (kg|lbs)$/)`** for the aggregate format on at least one row in a fixture with a working set. **Unit-agnostic** — kg fixture matches `"4 × 3,200 kg"`, lbs fixture matches `"4 × 7,055 lbs"`.
- **Explicit lbs e2e case.** A separate test (Playwright or component-level) that sets `weight_unit = "lbs"` (via the preferences hook or a mocked Supabase row) and asserts the aggregate label ends with `lbs`. The unit-test fixture in `exercise-session-row-format.test.ts` is necessary but not sufficient — the screen-level pinned regex is what gates regressions, so it needs both branches exercised.
- **`screen.getByText("Sessions")`** for the section header.
- **Negative case.** When fixture sessions have only warmups (so `e1rmData.length === 0`), assert the section header is NOT in the DOM and the empty-state copy `/No working sets recorded yet/i` IS.
- **Ordering.** In a fixture with sessions at `2026-05-10`, `2026-05-12`, `2026-05-14`, the first row's a11y label includes `May 14` (DESC).
- **Tap-through.** Pressing a row calls `router.push` with `/(app)/history/{id}` for the corresponding `session_id`.
- **(MIN-3) Long-page screenshot.** Capture a screenshot deep-linked to `/(app)/exercises/{id}/progress` showing the full scroll: header → subline → both charts → "Sessions" header → at least 3 row entries. Useful to detect (a) horizontal alignment regressions between chart container and rows, (b) section spacing regressions, (c) scroll position when entering the page via deep link.

### DB / RLS / migration
None. `listSetsForExercise` is unchanged. Existing `sessions`/`sets` RLS policies apply transitively.

## Riscos

### Data integrity
- **Volume kernel drift.** The chart's `Total volume` line and the new row's "X kg/lbs" must agree to the unit. Both go through the same predicate (`set_type !== "warmup"` + `w > 0 && r > 0`), but the chart inlines the math at `progress.tsx:79-86` while the new row calls `sumPastVolume`. Verified the predicates match exactly. **Mitigation**: the unit tests on `presentExerciseSessionRow` lock the kernel; if a future PR changes one site without the other, a test fails.
- **Cache invalidation.** Verified `useFinishSession` invalidates `["progress"]` at `src/hooks/use-sessions.ts:63`. The per-exercise hook uses `queryKey: ["progress", exerciseId]` (`use-progress.ts:7`). TanStack Query's `invalidateQueries({ queryKey })` defaults to prefix-match (`exact: false`) — `["progress"]` covers every key starting with `progress`. So when a workout finishes that includes this exercise, the list refreshes automatically without an extra mutation hook. `useUpdateSessionTimes` (`use-sessions.ts:109`) also invalidates `["progress"]` for the same reason. No design change required.
- **No RLS impact.** Reusing an existing query with existing policies.

### UX regressions
- **Empty-state copy pinned by 3 e2e assertions** (`tests/e2e/exercise-progress-ia.spec.ts:101,175,195`). Design gates the entire new section behind `e1rmData.length > 0`, the same gate that already controls whether the empty-state vs the charts render. Therefore the copy `/No working sets recorded yet/i` is unchanged in both presence and exact string — the assertions remain green.
- **Same-day session a11y collision (v2 fix).** Same-day sessions now produce distinct a11y labels because `includeTime: true` adds locale-formatted time (e.g. `"Sat, May 24, 8:15 AM"` vs `"Sat, May 24, 6:42 PM"`). Screen-reader users can disambiguate; `getByLabelText` automation no longer throws on multi-match.
- **Section styling cross-screen consistency (v2 fix).** Section header now matches the literal classes used by `/history/week/[isoWeek].tsx`. Users navigating between `/history/week/...` and `/(app)/exercises/{id}/progress` see the same "Sessions" treatment.
- **Horizontal alignment (v2 fix).** Row content now sits at `px-6` (ambient) — the same left edge as the chart container above. Removes the 8px jog that v1 would have introduced.
- **Scroll position / layout shift on first paint.** The new section materially extends the scroll content. Users who relied on the page ending at the volume chart will need to scroll further. No prior contract; acceptable per the prompt.
- **No reuse of `<SessionSummaryRow>`** — the existing component is unchanged, so its other two consumers (`history/index.tsx`, `history/week/[isoWeek].tsx`) are unaffected. Zero regression surface on shared code.
- **Soft-deleted exercises** (Discovery unknown). `useAllExercise(id)` resolves a soft-deleted exercise for header rendering; `listSetsForExercise(exerciseId)` does not filter on `exercises.deleted_at`, so the list will continue to render historical sessions for deleted exercises. Recommended explicitly: **keep this behavior**. Rationale: the screen exists at all for soft-deleted exercises (the title bar renders the name); hiding the sessions would make the screen suddenly empty for users who navigated from history detail. No code needed.

### Platform-specific
- iOS / Android / web all share the `<ScrollView>` + `<Pressable>` + NativeWind path. `accessibilityRole="button"` + `accessibilityLabel` is the cross-platform a11y pattern used everywhere else. No divergence expected.
- Tap feedback (`active:bg-gray-50`) is a NativeWind state — works on iOS/Android, falls back gracefully on web.
- **Time format in a11y label is locale-dependent.** `formatDisplayDate(..., { includeTime: true })` calls `d.toLocaleString(undefined, ...)`. On en-US devices the user hears "8:15 AM"; on pt-BR devices "08:15"; on fr-FR "08:15". Screen-reader pronunciation may differ but uniqueness within a day is preserved (same locale across rows in a single session). Acceptable.

### Performance
- Render cost: O(N_sessions) `<Pressable>` instances. Typical N ≈ 50; even an outlier with N = 500 is fine without virtualization (the chart already iterates the same array twice; one more `.map` is negligible).
- Memo cost: the existing chart `useMemo` already takes O(N_sessions × N_sets_per_session). The new helper inside the row is O(N_sets_per_session) per render of that row. The new `sessionsDesc` memo is O(N_sessions). Cumulative: still well under one frame on a low-end device.
- **Should we virtualize?** No. RN's lint will warn if we nest a `<FlatList>` inside a `<ScrollView>`. The escape hatches (use `<FlashList>` with `nestedScrollEnabled` or hoist the whole screen into a single `<FlatList>` with `ListHeaderComponent={charts}`) trade meaningful complexity for an optimization the data volume does not warrant.

## Alternativas descartadas
1. **Reuse `<SessionSummaryRow>` by synthesizing a `SessionRow`** — descartada porque `listSetsForExercise` does not select `sessions.name`, `sessions.ended_at`, `sessions.notes`, `sessions.routine_id`, or `sessions.user_id`. Faking those (e.g. `name: null`, `ended_at: started_at`) would make the row display `"Workout · 0m"` and could trigger the "In progress" badge logic depending on the existing component's null-vs-equal-to-started_at check — visibly broken. The new presenter is ~30 lines and avoids both costs.
2. **(MIN-1) Reuse `<SessionSummaryRow>` with a thinner `Pick<SessionRow, "id" | "started_at" | "name" | "ended_at">` prop** — descartada porque even with the prop loosened, the component still reads `session.name` (which is null for this data flow and would render `"Workout"` as the title for every row, a regression vs the date-as-title we want) and `session.ended_at` (which is null/equal-to-started_at here and would trigger the "In progress" badge on every row). The structural change to `<SessionSummaryRow>` to make those reads optional is broader than this feature's scope.
3. **Per-set "100×8 · 100×8 · 110×6" line as the primary format** — descartada porque (a) it wraps or overflows on phones for 6+ sets, (b) the aggregate is the canonical kernel the chart already plots so it stays consistent cross-screen, and (c) the prompt presented both as alternatives, not a hybrid requirement. Deferred under "Out of scope".
4. **Hoist the whole screen into a `<FlatList ListHeaderComponent={charts}>`** — descartada porque the existing screen has a stable structure, the charts inside `ListHeaderComponent` would re-render on every list re-render unless memoized carefully, and the perf win (virtualization) is unnecessary at expected scale.
5. **Render the list inside the `<View className="gap-8">` chart container as a third "card"** — descartada porque `gap-8` would put 32px between the volume chart and the list, which under a "Sessions" header reads as awkward whitespace; the section semantically is *not* a chart and should be visually separated, not co-spaced with the two charts.
6. **Edge-to-edge rows via `<View className="-mx-6">`** (MAJ-2 option b) — descartada porque the per-exercise progress screen is a single scroll surface with a chart container at `px-6`; rows breaking out to the edges would visually detach from the chart they sit below. On `/history`, edge-to-edge is natural because the rows own the whole screen. Picked option (a) instead: drop `px-4` on the row so `px-6` ambient governs.
7. **Hoist `SECTION_HEADER` into a shared module** — descartada porque it's a refactor touching two files unrelated to this feature. Filed under "Out of scope". The duplicated literal carries a code comment pointing at the source-of-truth precedent.

## Resposta a issues do Validator

| Issue | Severity | Resolution |
|---|---|---|
| BLK-1 — kg-only regex | Blocker | Regex updated to `^\d+ × [\d,]+ (kg|lbs)$`. Explicit lbs e2e case added to the Tester pinned surfaces. |
| MAJ-1 — same-day a11y collision | Major | A11y label now includes time-of-day via `formatDisplayDate(..., { includeTime: true })`. Visible date is unchanged (no time). Tester pinned to `getAllByLabelText` (not `getBy*`) to cover multi-row fixtures. |
| MAJ-2a — section header styling | Major | Header uses the literal classes from `/history/week/[isoWeek].tsx:20-21` (`mt-4 mb-2 text-sm font-medium uppercase text-gray-500`), with a code comment pointing at the precedent. Cross-screen consistency restored. Hoisting the token into a shared module is out of scope. |
| MAJ-2b — horizontal alignment | Major | Row no longer applies `px-4`; ambient `px-6` from the screen body governs indent. Row content aligns with chart container's left edge in the same screen. |
| MIN-1 — structural-subset alt not surfaced | Minor | Added entry #2 under "Alternativas descartadas" naming it and explaining why it still doesn't fit. |
| MIN-2 — return-shape JSDoc | Minor | Expanded JSDoc on `ExerciseSessionRowPresentation` to document both rationale (test ergonomics + future per-set secondary). |
| MIN-3 — long-page screenshot | Minor | Added to the Tester pinned surface section. |
| MIN-4 — file naming symmetry | Minor | No-op (confirmation only). |
| MIN-5 — cache-key prefix-match | Minor | Verified at `use-sessions.ts:63` + `use-progress.ts:7`. TanStack default `exact: false` covers `["progress"] → ["progress", exerciseId]`. Documented under "Riscos · Data integrity". No design change. |
| MIN-6 — chevron color literal | Minor | No-op (matches existing convention). |

## Out of scope
- **Per-set "100×8 · 100×8" detail** under the aggregate. Designable as a v2: secondary `text-xs text-gray-500` line below `volumeLabel`, joined by `" · "`, warmups excluded. Pure addition to `presentExerciseSessionRow`'s return shape.
- **`max_volume_window_weeks` filter** — the source comment at `progress.tsx:22-34` explicitly defers this for the per-exercise screen.
- **Session name / duration / notes** in the row — would require extending `listSetsForExercise` to project `sessions.name, sessions.ended_at, sessions.notes`. Not done here per the "no new query" constraint.
- **Routine context** ("Push A", "Legs · Routine X") — not in the current data flow and not requested.
- **Mutation affordances** (delete a session from this list, edit a set) — read-only navigation surface only.
- **Pagination / windowing** — typical N is small enough that pagination is unnecessary; revisit only at >1000 rows.
- **Virtualization** — see Performance above.
- **Sticky section header** — the page is short enough that the "Sessions" label stays in view via natural scroll position.
- **Hoist `SECTION_HEADER` into a shared module** (e.g. `src/components/section-header.ts` or `src/styles/tokens.ts`) — would deduplicate the literal across `/history/week/[isoWeek].tsx` and the new section on `/exercises/{id}/progress`. Filed as a follow-up; the duplicated literal carries an in-source comment so the next refactor is discoverable.

## Confidence / Risk
- **Confidence**: HIGH. v2 fixes are mechanical and the underlying assumptions (formatDisplayDate supports `includeTime`, SECTION_HEADER is a literal string at `history/week/[isoWeek].tsx:20-21`, TanStack prefix-match defaults) are all verified against the source.
- **Risk**: LOW. New files remain additive. The `progress.tsx` edit is gated by an existing condition. The `volume-target.ts` edit is a visibility change on an already-defined helper. No DB/RLS/migration touch. The v2 changes (a11y label string, header classes, dropped `px-4`) are surface-level adjustments with no logic implications.
