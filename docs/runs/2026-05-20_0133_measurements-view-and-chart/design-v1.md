# Design v1 — 2026-05-20_0133_measurements-view-and-chart

## Goal (1 sentence)

Split the Measurements detail flow into **view → Edit** (Pattern A folder split) and add a bodyweight-history line chart as the list's `ListHeaderComponent`, with no schema work, no new API methods, and no `["stats"]` cross-invalidation.

## Approach

Two surgical changes to the just-shipped Measurements vertical, both built on precedents that already ship in production:

1. **Routing split — Pattern A (folder).** Replace `app/(app)/measurements/[id].tsx` with a folder `app/(app)/measurements/[id]/` containing `index.tsx` (new read-only view) and `edit.tsx` (the current edit form, relocated wholesale). Mechanically a copy of the `app/(app)/exercises/[id]/{index.tsx,progress.tsx}` precedent. Pattern B is **mechanically invalid** in Expo Router (file `[id].tsx` and folder `[id]/` collide at the same segment). Pattern C (in-file `mode` toggle) loses URL-level addressability of edit mode and breaks the `useForm.isDirty` contract — declined.
2. **Chart — `ListHeaderComponent` strip.** New `src/components/measurements-progress-strip.tsx` modelled byte-for-byte on `src/components/weekly-volume-strip.tsx`, mounted at `app/(app)/measurements/index.tsx` above the existing `FlatList`. Uses the existing `ProgressChart` SVG primitive (already in production at `app/(app)/exercises/[id]/progress.tsx`). Bodyweight-only for v1 because it's the only universally populated metric; chip toggle is deferred to v1.1.

Both changes reuse `useMeasurement` / `useMeasurements`, `formatWeight`, `kgToLbs`, `ProgressChart`, and the existing `SECTION_HEADER` token. Zero new dependencies, zero migration risk, zero RLS work. The two e2e tests that drive the old "tap row → land on edit form" path get rewired to "tap row → land on view → tap Edit → land on edit form".

## Decisions on unknowns

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Routing pattern | **A — folder split** (`[id]/index.tsx` view + `[id]/edit.tsx` edit) | Mirrors `exercises/[id]/` precedent; only mechanically valid layout that preserves deep-linkable edit URL. Pattern B is invalid; Pattern C breaks `isDirty` lifecycle. |
| 2 | View-screen layout | **Sectioned cards mirroring edit-form sections**, skipping empty sections entirely (no empty card chrome) | Consistency with edit-form section headers (`Weight & body fat` / `Upper body` / `Core` / `Lower body` / `Notes`); reuses the `SECTION_HEADER` token; visually obvious how the view maps to the edit fields. |
| 3 | Chart placement | **List-header strip** (`ListHeaderComponent` on the existing `FlatList`) | Matches prompt wording "measurements screen should show a graph". Direct precedent: `WeeklyVolumeStrip` on `app/(app)/history/index.tsx:48`. |
| 4 | Which metric in chart | **Bodyweight only for v1** | Only universally populated metric; lowest empty-state risk; matches `bodyweight-tracking-app` convention. Per-metric chip toggle is flagged v1.1 (see Out of scope). |
| 5 | Chart x-axis range | **Last 12 entries with `weight_kg != null`**, falls back to "all entries" if fewer than 12 exist | Keeps axis legible. `progress-chart.tsx:53` already thins x-labels at ~5 ticks. 12 ≈ a year of monthly measurements; consistent with the bodyweight-tracking-app convention. |
| 6 | Delete on view | **No** — Delete stays on Edit screen only | Prompt does not mention delete. Tap-through to view is a higher-traffic path; accidental delete from view is a UX foot-gun. Edit-only matches `confirmDelete` precedent (`exercises/[id]/index.tsx:209-214`). |
| 7 | Duplicate-banner deep-link target | **Edit screen** (`/(app)/measurements/${row.id}/edit`) | Banner copy reads "edit it instead?" — the user's intent is corrective editing, not browsing. Honoring the existing copy avoids a friction detour through view in a recovery flow. |
| 8 | Chart empty state | **Return `null` (no chrome)** when fewer than 2 bodyweight datapoints exist | Matches `WeeklyVolumeStrip` early-`null` convention (`weekly-volume-strip.tsx:87-89`). Prevents the list from showing an awkward placeholder chart. `ProgressChart`'s built-in `length===0/1` branches are also covered as defense-in-depth. |
| 9 | Header title on view | **Static `"Measurement"`** | Symmetric with `"Edit measurement"`. Avoids date-format conditional logic in `<Stack.Screen options>` and dodges the empty-while-loading flash. |
| 10 | Native vs web parity for Edit affordance | **Both** — `headerRight` Edit button (iOS-native idiom) **AND** an inline bordered CTA at the bottom of the view (matches `exercises/[id]/index.tsx:185-194` "View progress" precedent) | Header button is unmissable on iOS; inline CTA is unmissable on web where header buttons sometimes get visually deprioritized. Both placements render fine on all three platforms — verified by `Plus` button precedent (`measurements/index.tsx:30-39`) and `View progress` precedent. |
| 11 | Chart sub-extraction | **Yes** — extract `entriesToWeightSeries(entries, unit) → DataPoint[]` to `src/utils/measurements-chart.ts` | Mirrors validator MIN-2 from prior run (extract pure logic for unit-testability). Mirrors `computeStripModel` extraction in `weekly-volume-strip.tsx:34-60`. |
| 12 | Detail-cache hydration from list | **Skip for v1** — accept the brief spinner on first navigation | Polish item; not in prompt. Revisit only if visible flicker is reported. Edit-screen pattern is identical and ships today without hydration. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/measurements/[id].tsx` | **deleted** | File-form `[id].tsx` is replaced by folder-form `[id]/`. Expo Router segment-collision rule forces this. Content is relocated to `[id]/edit.tsx` byte-for-byte (with a single deep-link target update inside, see below). |
| `app/(app)/measurements/[id]/index.tsx` | **new** | Read-only view screen. Renders `useMeasurement(id)` data as sectioned label→value rows mirroring the edit form's section structure, skipping null metrics and entire empty sections. `<Stack.Screen options={{ title: "Measurement", headerShown: true, headerRight: <EditButton id={id} /> }} />`. Bottom of scroll body has inline bordered "Edit measurement" CTA navigating to `./edit`. Loading / error states match the edit-form's existing four-branch render. |
| `app/(app)/measurements/[id]/edit.tsx` | **new** (relocated from current `[id].tsx`) | The current edit-screen file relocated to its new path. **Two edits** inside: (a) the duplicate-banner deep-link `router.replace(\`/(app)/measurements/${row.id}\`)` (line 145 in the old file) → `router.replace(\`/(app)/measurements/${row.id}/edit\`)` to honor Unknown 7. (b) Header title stays `"Edit measurement"`. Everything else is unchanged. |
| `app/(app)/measurements/index.tsx` | **edited** | Mount `<MeasurementsProgressStrip />` as `ListHeaderComponent` on the `FlatList`. Empty-state branch (no entries) renders no strip — matches `WeeklyVolumeStrip`'s null-on-empty convention. List-row `onPress` target stays `router.push(\`/(app)/measurements/${item.id}\`)` — that route now resolves to the new view-screen `index.tsx`. No callback-shape change. |
| `src/components/measurements-progress-strip.tsx` | **new** | New `ListHeaderComponent` chart. Reads `useMeasurements()` and `useWeightUnit()`. Memoizes the data → `DataPoint[]` transform via `entriesToWeightSeries(entries, unit)` (the new util). Returns `null` when fewer than 2 bodyweight datapoints. Renders a `ProgressChart` with title `"Weight (kg|lb)"`, `formatValue={(v) => v.toFixed(1)}`. Loading skeleton mirrors `weekly-volume-strip.tsx:75-83`. |
| `src/utils/measurements-chart.ts` | **new** | Pure helper. Exports `entriesToWeightSeries(entries: MeasurementEntryRow[], unit: WeightUnit) → DataPoint[]`. Filters `weight_kg != null` and `Number.isFinite(parseFloat(weight_kg))`, takes the most recent 12 by `measured_at` DESC, reverses to ASC for the chart's left→right time progression, converts to display unit via `kgToLbs` when `unit === "lb"`, and emits `{ label: shortDate(measured_at), value }`. Mirrors `weekly-volume-strip.tsx`'s extracted-helper convention. |
| `src/components/measurement-list-item.tsx` | **untouched** | Tap target lives in the parent (`measurements/index.tsx:80`). The `onPress` callback shape is unchanged; the new route just resolves to a different file. `ChevronRight` cue now correctly promises "deep view" instead of "deep edit" — semantic improvement at zero code cost. |
| `tests/e2e/measurements.spec.ts:123-130` | **edited** | Golden path: after `page.waitForURL(/\/measurements\/[0-9a-f-]+/)`, the user is on the view screen. Replace `await expect(page.locator("input").nth(IDX.weight)).toHaveValue("80.0")` with the view-screen assertion `await expect(page.getByText("80.0 kg").first()).toBeVisible()`, then click `page.getByText("Edit", { exact: false }).last()` (matches both the headerRight Edit button label and the inline "Edit measurement" CTA), then `await page.waitForURL(/\/measurements\/[0-9a-f-]+\/edit/)`, then continue with the existing `fillInput(page, IDX.weight, "80.5")` + `Save changes` flow. Final assertion (`/80\.5 kg/` visible on list) is unchanged. |
| `tests/e2e/measurements.spec.ts:265-275` | **edited** | Soft-delete path: after `page.waitForURL(/\/measurements\/[0-9a-f-]+/)` lands on the view screen, click the Edit affordance, `await page.waitForURL(/\/measurements\/[0-9a-f-]+\/edit/)`, then the existing `Delete measurement` click proceeds unchanged. The downstream assertions (back to list, "No measurements logged yet", re-entry succeeds) are unchanged. |

**Total**: 1 deleted, 4 new, 3 edited. Each file's change has a single responsibility:
- `[id].tsx` → `[id]/edit.tsx`: relocation + one deep-link target fix (the duplicate-banner change is the same logical concern as the routing split — both come from the file/folder split).
- `[id]/index.tsx`: new view screen, one purpose.
- `index.tsx` (list): mount the strip, one purpose.
- `measurements-progress-strip.tsx`: chart presentation, one purpose.
- `measurements-chart.ts`: pure data shaping, one purpose.
- E2e test edits: rewire the two flows that depended on tap-row-lands-on-edit, one logical purpose per `test()`.

## Contratos de I/O

### Function signatures / types added

```ts
// src/utils/measurements-chart.ts (new)
import type { DataPoint } from "~/components/progress-chart";
import type { MeasurementEntryRow, WeightUnit } from "~/db/types";

/**
 * Build a chart series for bodyweight history.
 *
 * - Filters entries with non-null, finite `weight_kg`.
 * - Sorts by `measured_at` ASC (oldest → newest) so the line reads left→right.
 * - Caps to the most-recent N entries (default 12), then re-sorted ASC.
 * - Converts kg→lb when `unit === "lb"` via `kgToLbs`.
 * - Label format: `M/D` (e.g. `"5/20"`) via local `shortDate` helper —
 *   identical to `app/(app)/exercises/[id]/progress.tsx:12-19`.
 *
 * Pure. No side effects. Safe to call inside `useMemo`.
 */
export function entriesToWeightSeries(
  entries: MeasurementEntryRow[],
  unit: WeightUnit,
  maxPoints?: number, // default 12
): DataPoint[];
```

```ts
// src/components/measurements-progress-strip.tsx (new)
/**
 * `ListHeaderComponent` chart for the Measurements list. Bodyweight over time.
 *
 * Returns `null` (no chrome) when:
 *   - `useMeasurements()` is in error state, OR
 *   - the bodyweight series has fewer than 2 datapoints.
 *
 * Renders a loading skeleton when `useMeasurements()` is loading.
 * Otherwise renders a single `<ProgressChart>` with title "Weight (kg|lb)".
 */
export function MeasurementsProgressStrip(): React.JSX.Element | null;
```

```ts
// app/(app)/measurements/[id]/index.tsx (new)
// Default-exported screen component. No exported props — params come from
// Expo Router via `useLocalSearchParams<{ id: string }>()`.
export default function ViewMeasurementScreen(): React.JSX.Element;
```

### DB columns / queries

**No DB changes.** Reads-only on the existing `measurement_entries` table via `listMeasurements()` and `getMeasurement(id)`.

- `measurement_entries.weight_kg` (`numeric NULL`, stored as `string | null` per `MeasurementEntryRow.weight_kg: string | null`). The chart filters this column; the view screen reads it via `formatWeight(parseFloat(weight_kg), weightUnit)`.
- All 9 circumference columns + `body_fat_pct` + `notes` are read by the view screen, formatted with their unit-aware helpers (`formatLength` for the `*_cm`, raw `${n.toFixed(1)}%` for `body_fat_pct`, raw string for `notes`).
- RLS unchanged. `auth.uid()` policy on `measurement_entries` already covers the new reads.
- Query cache namespace stays `["measurements"]` and `["measurements", id]` — **no `["stats"]` cross-invalidation**. Verified in `use-measurements.ts:36-52`.

### UI props / state

**`MeasurementsProgressStrip`** — no props. Internal state via `useMeasurements()` and `useWeightUnit()`. One `useMemo` derives `DataPoint[]` from `data + unit`. No local React state.

**`ViewMeasurementScreen`** — no props. Reads `useLocalSearchParams<{ id: string }>()`, `useMeasurement(id)`, `useWeightUnit()`, `useLengthUnit()`. No mutations, no local state, no form. Pure render.

**`measurements/index.tsx`** — unchanged props for `MeasurementListItem`. New JSX prop on `FlatList`: `ListHeaderComponent={<MeasurementsProgressStrip />}` (precedent: `history/index.tsx:48`).

### Route shapes

| Path | Resolves to | Header title | Notes |
|---|---|---|---|
| `/(app)/measurements` | `app/(app)/measurements/index.tsx` | `"Measurements"` | Existing list; gains `ListHeaderComponent` strip. |
| `/(app)/measurements/new` | `app/(app)/measurements/new.tsx` | `"New measurement"` | Unchanged. |
| `/(app)/measurements/{id}` | `app/(app)/measurements/[id]/index.tsx` (new) | `"Measurement"` | **New view screen.** Tap-from-list lands here. |
| `/(app)/measurements/{id}/edit` | `app/(app)/measurements/[id]/edit.tsx` (relocated) | `"Edit measurement"` | Reachable from view screen's Edit affordance and from the duplicate-banner CTA. |

### Edit affordance contract

The view screen exposes **two** Edit triggers, both navigating to `./edit` (resolves to `/(app)/measurements/{id}/edit`):

1. **HeaderRight Edit button** — `<Pressable onPress={() => router.push(\`/(app)/measurements/${id}/edit\`)} accessibilityLabel="Edit measurement" accessibilityRole="button">` containing a `Pencil` lucide icon (matches `headerRight` `Plus` precedent at `measurements/index.tsx:30-39`).
2. **Inline body CTA** — `<Link href={\`/(app)/measurements/${id}/edit\`} asChild><Pressable className="rounded-lg border border-blue-500 py-3"><Text className="text-center text-base font-medium text-blue-500">Edit measurement</Text></Pressable></Link>` (matches `exercises/[id]/index.tsx:185-194` precedent).

Both render `"Edit measurement"` accessible text — the e2e test uses `page.getByText("Edit", { exact: false }).last()` which matches either.

## UI spec

### View screen layout (`app/(app)/measurements/[id]/index.tsx`)

```
┌────────────────────────────────────────────┐
│ ← Measurement                    ✎ (Edit) │  ← Stack header w/ headerRight icon
├────────────────────────────────────────────┤
│                                             │
│  Wed, May 20, 2026                          │  ← H1 date headline (parseISO + format)
│                                             │
│  WEIGHT & BODY FAT                          │  ← SECTION_HEADER style
│  Weight        80.5 kg                      │  ← label (gray-500) → value (black/white)
│  Body fat %    15.2 %                       │
│                                             │
│  UPPER BODY                                 │
│  Chest         101.0 cm                     │
│  Biceps        35.0 cm                      │
│  (Neck and Forearm omitted because null)    │
│                                             │
│  CORE                                       │
│  Waist         80.0 cm                      │
│                                             │
│  (Lower body section entirely hidden        │
│   because both thigh and calf are null)     │
│                                             │
│  NOTES                                      │
│  first entry                                │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │       Edit measurement               │  │  ← Inline blue-bordered CTA
│  └──────────────────────────────────────┘  │
│                                             │
└────────────────────────────────────────────┘
```

**Rules**:
- Date headline uses `format(parseISO(data.measured_at), "EEE, MMM d, yyyy")` — same format as `measurement-list-item.tsx:49`.
- Section header uses the existing `SECTION_HEADER` constant string `"mt-4 mb-2 text-sm font-medium uppercase text-gray-500"`, defined inline in both `[id].tsx:38-39` and `new.tsx:25-26`. Defined inline again in the view screen (matches the project convention of duplicating this token rather than centralizing — explicit non-change to convention).
- Row layout: `<View className="flex-row justify-between py-2"><Text className="text-sm text-gray-500">{label}</Text><Text className="text-base text-black dark:text-white">{value}</Text></View>`.
- Empty-row rule: **omit** the row entirely if the underlying field is `null` or fails `Number.isFinite(parseFloat(...))`. Do not render `"—"` placeholders.
- Empty-section rule: if **all** metrics in a section are null, omit the section header and the section block entirely. Decision branch: compute a boolean `hasUpperBody = (neck_cm || chest_cm || biceps_cm || forearm_cm) != null` (and equivalent for each section) and gate the whole `<Text>{SECTION_HEADER}</Text> + rows` block.
- Notes section: rendered only when `data.notes` is a non-empty string after `.trim()`.
- Inline Edit CTA: placed below the last rendered section, with `mt-8` separation. Always rendered (the screen has no "nothing here" branch — even an entirely empty entry would still show the date headline and the Edit CTA, because the row was inserted somehow).
- Dark mode: every text/border token has its `dark:` counterpart per the existing NativeWind convention (`bg-white dark:bg-black`, `text-black dark:text-white`, `border-gray-200 dark:border-gray-800`).

### Loading / error / pseudo-code

```tsx
if (isLoading) {
  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-black">
      <Stack.Screen options={{ title: "Measurement", headerShown: true }} />
      <ActivityIndicator />
    </View>
  );
}

if (isError || !data) {
  return (
    <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
      <Stack.Screen options={{ title: "Measurement", headerShown: true }} />
      <Text className="text-base text-red-500">
        {error instanceof Error ? error.message : "Failed to load"}
      </Text>
    </View>
  );
}

// Happy path: ScrollView + sectioned read-only content + Edit CTA.
```

Four-branch render matches the existing precedent at `[id].tsx:148-170`.

### Chart strip layout (`src/components/measurements-progress-strip.tsx`)

```
┌─────────────────────────────────────────────┐
│ WEIGHT                                       │  ← uppercase tracking-wide label
│ 80.5 kg                                      │  ← H2 current-weight value
│                                              │
│   80 ┤─╮                              ╭──    │
│      │  ╲                            ╱        │  ← ProgressChart Polyline
│   78 ┤   ╲──╮                      ╱          │
│      │      ╲──────╮      ╭──────╯            │
│   76 ┤            ╲──────╯                    │
│      └────────────────────────────────────    │
│      3/12  4/2  4/22  5/12  5/20              │  ← x-axis labels (thinned)
└─────────────────────────────────────────────┘
```

**Pseudo-code**:

```tsx
export function MeasurementsProgressStrip(): React.JSX.Element | null {
  const { data, isLoading, isError } = useMeasurements();
  const unit = useWeightUnit();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = Math.min(screenWidth - 48, 500); // mirrors progress.tsx:27

  const series: DataPoint[] = useMemo(
    () => (data ? entriesToWeightSeries(data, unit, 12) : []),
    [data, unit],
  );

  // Loading skeleton (mirrors weekly-volume-strip.tsx:75-83)
  if (isLoading) {
    return (
      <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
        <View className="h-3 w-20 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-1 h-7 w-32 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-4 h-32 w-full rounded-sm bg-gray-100 dark:bg-gray-900" />
      </View>
    );
  }

  // Error / empty / single-point → bare null, no chrome
  if (isError) return null;
  if (series.length < 2) return null;

  const latestKg = parseFloat(
    [...(data ?? [])]
      .filter((r) => r.weight_kg != null)
      .sort((a, b) => (a.measured_at < b.measured_at ? 1 : -1))[0]
      ?.weight_kg ?? "",
  );
  const latestDisplay = Number.isFinite(latestKg)
    ? formatWeight(latestKg, unit)
    : "";

  return (
    <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
      <Text className="text-xs uppercase tracking-wide text-gray-500">
        Weight
      </Text>
      <Text className="mt-1 text-2xl font-semibold text-black dark:text-white">
        {latestDisplay}
      </Text>
      <View className="mt-3">
        <ProgressChart
          data={series}
          width={chartWidth}
          height={160}
          title=""
          formatValue={(v) => v.toFixed(1)}
        />
      </View>
    </View>
  );
}
```

**Notes**:
- `title=""` because the headline already shows "WEIGHT" + the current value. `ProgressChart`'s title row (line 83) renders an empty `<Text>` when title is `""` — harmless, takes ~zero height.
- `height={160}` is slightly shorter than the default `200` to keep the list-header strip from dominating the viewport.
- `chartWidth` clamped to `Math.min(screenWidth - 48, 500)` matches `exercises/[id]/progress.tsx:27`. Works on iOS, Android, web via `useWindowDimensions`.

### Empty-state, error-state branches at the list level

| Strip state | List state | Combined render |
|---|---|---|
| Loading | Loading (`useMeasurements` is shared) | List shows `<ActivityIndicator />`. Strip is not mounted (the list's `FlatList` itself isn't mounted in the loading branch). |
| Error | Error | List shows red error text. Strip not mounted. |
| `data.length === 0` | Empty-state CTA branch (`!data || data.length === 0`) | List shows "No measurements logged yet" CTA. Strip not mounted (the empty-state branch short-circuits before the `FlatList`). |
| `data.length >= 1` but `< 2` bodyweight datapoints | Renders rows | Strip mounts but returns `null` — no chrome, list rows show normally. |
| `data.length >= 1` and `>= 2` bodyweight datapoints | Renders rows | Strip renders chart above the first row, divided by its own `border-b`. |

This matches the `WeeklyVolumeStrip` precedent's interaction with the `history/index.tsx` empty-state branch exactly.

## Riscos

### Data integrity

- **No schema changes, no migrations, no RLS deltas.** Reads-only on `measurement_entries`. Existing `auth.uid()` policy covers both the new view-screen read and the chart's list read (which already happens today for the list itself).
- **Soft-delete preserved.** Delete remains exclusively on the Edit screen, behind the existing `confirmDelete` dialog. The view screen has no delete affordance.
- **No `["stats"]` cache cross-invalidation.** Verified in `use-measurements.ts:36-52` — the only mutation invalidations are `["measurements"]` and `KEYS.detail(id)`. The new components add no mutations.
- **Duplicate-banner still works post-split.** The deep-link target moves from `/measurements/${row.id}` to `/measurements/${row.id}/edit`. Both `new.tsx:103` and the relocated `edit.tsx`'s `openExistingEntry` callback need to be updated. Validator should confirm both call sites are updated; the e2e test `edge: duplicate same-day shows amber banner with CTA` (`measurements.spec.ts:191-214`) clicks the banner CTA — the test will need adjusting if it asserts the post-click URL (a quick scan says it only asserts the banner is visible, not the URL, so it may pass unmodified, but the Implementer should verify and update if needed).

### UX regressions

- **List-row tap surface unchanged** — the `Pressable` and `ChevronRight` cue still promise "this navigates". The destination changes from edit to view, but the user gesture is identical. `ChevronRight` semantically fits view-screen-with-detail better than edit-form, so this is a net positive.
- **Edit access requires one extra tap.** The prompt explicitly asked for this. Mitigation: two Edit affordances (header icon + inline CTA) keep the path obvious. The headerRight icon is one tap from view to edit; no scroll required.
- **First-navigation spinner.** `useMeasurement(id)` is not pre-hydrated from the list's `useMeasurements()` cache, so the view screen shows `ActivityIndicator` briefly on first visit. Acceptable for <100 rows; revisit if perceptible flicker is reported (Unknown 12).
- **Duplicate banner now skips view.** Per Unknown 7, the banner deep-links straight to edit. This is consistent with the banner's "edit it instead?" copy but is a behavior change from the pre-split routing (where the banner also skipped to edit because edit was the default). Net effect: no observable UX change for the banner flow.

### Platform-specific

- **iOS / Android / web all supported.** `react-native-svg@15.12.1` already renders `ProgressChart` on all three platforms (verified by production use on `exercises/[id]/progress.tsx`). `useWindowDimensions()` works on all three. `headerRight` renders on the native stack header on iOS/Android and the web stack header.
- **No new platform-specific deps.** No new `react-native-*` modules, no native code.
- **Lucide `Pencil` icon** — already in `lucide-react-native` (same package as `Plus`, `ChevronRight`, etc. already in use). No bundle delta beyond the icon's tree-shaken bytes.
- **Web header chrome.** On the web build the stack header is implemented by `expo-router` — the `Plus` button on the list page already proves `headerRight` works on web. The view screen's `Pencil` button uses the identical pattern.

### Performance

- **Chart cost**: ≤12 datapoints, SVG renders in <16ms. `useMemo` keyed on `[data, unit]`. No virtualization needed.
- **Detail-screen render**: read-only, no form state, no controlled inputs. Lower memory footprint than the edit screen (which mounts 13 `Controller` instances).
- **Cache hits**: list → view → edit chain. List query populates `["measurements"]`. View query (`useMeasurement(id)`) is a fresh fetch on first visit (no auto-hydration), then cached. Edit query (`useMeasurement(id)`) hits the cache populated by the view. End-to-end first-visit fetches: 2 (list + detail). Edit-screen second visit: 0 (cache hits). Same as today.
- **List render**: `ListHeaderComponent={<MeasurementsProgressStrip />}` adds one tree node above the FlatList content. `FlatList` re-renders the header when `data` changes — the strip's own `useMemo` prevents recomputing the series. No perf regression.

## Alternativas descartadas

1. **Pattern C (in-file `mode = "view" | "edit"` state)** — Single file with internal toggle, avoiding the file/folder split. Descartada porque: (a) breaks URL-level addressability of edit mode — the duplicate-banner deep-link "go to edit" intent cannot be expressed as a URL, only as a UI state; (b) breaks `useForm.isDirty` lifecycle on view↔edit toggle (would need to `reset(data)` on mode change, adding a fragile sync path); (c) doesn't reduce file count meaningfully because the view-rendering JSX would still live in its own function; (d) the existing `exercises/[id]/{index.tsx,progress.tsx}` precedent makes the folder split the documented pattern in this codebase.

2. **Dedicated `app/(app)/measurements/chart.tsx` screen** instead of a list-header strip — Linked from a "Progress" button on the list. Descartada porque: (a) the prompt literal reads "measurements screen should show a graph" — strongly implies in-place, not a separate screen; (b) adds a navigation hop for a glanceable insight (current weight + trend); (c) inconsistent with the `WeeklyVolumeStrip`-on-`history` precedent that already ships and works.

3. **Multi-chart grid** (weight, waist, body-fat, biceps, etc., one chart each) — Show every metric that has ≥ 2 datapoints. Descartada porque: (a) scroll fatigue on the list screen — the strip would push the first list row below the fold; (b) most users only consistently track bodyweight, so most charts would be empty for most users; (c) v1.1 chip-toggle solves the "want to see waist trend" use case more elegantly without sacrificing list-screen real estate. Flagged for follow-up under Out of scope.

4. **Per-metric chip toggle now** (cycle through weight, body-fat, waist, etc.) — Single chart with a chip selector. Descartada porque: (a) doubles the v1 surface area (need to design the chip control, state ownership, empty-state per metric, unit handling for non-cm metrics like `body_fat_pct`); (b) the prompt does not ask for it; (c) the design intentionally ships v1 narrow and validates that "chart on the list" is the right placement before investing in the chip control. v1.1 candidate.

5. **Move Delete to the view screen** instead of behind Edit — Saves one tap when the user's intent is "remove this entry". Descartada porque: (a) accidental delete from a tap-through view is a recoverable-but-annoying UX foot-gun (the row is soft-deleted but invisible to the user); (b) the prompt does not request delete-from-view; (c) keeps the destructive action behind one extra deliberate gesture (tap Edit → scroll to bottom → confirmDelete dialog).

6. **Pre-hydrate detail cache from list** (`qc.setQueriesData` for each row in `useMeasurements.onSuccess`) — Eliminates the first-visit spinner on the view screen. Descartada porque: (a) Unknown 12 — polish item, not in the prompt; (b) row count <100 makes the spinner ~50ms, well below perceptible flicker for most users; (c) the current Edit-screen pattern works without it; (d) revisit if a user reports the flicker.

## Out of scope

- **Per-metric chip toggle on the chart** (cycle through weight, body-fat, waist, etc.) — v1.1 candidate.
- **Multi-chart grid** (weight + waist + body-fat all visible) — possible v1.1, possible never.
- **Per-side L/R metrics** (e.g. left biceps vs right biceps) — schema doesn't support; out per global feature roadmap.
- **All-time chart with pan/zoom** — v1 caps to last 12 entries; pan/zoom is a separate UX investment.
- **Dedicated `measurements/chart.tsx` screen** — strip-on-list per Unknown 3.
- **Photos / progress pictures** — not in scope; no DB column exists.
- **Goals / target overlay on chart** — no goals system exists yet.
- **Detail-cache pre-hydration** — Unknown 12, skipped for v1.
- **Sharing / exporting the chart as an image** — not asked.
- **Re-design of the list row** — `MeasurementListItem` is untouched; only the parent's `onPress` target route resolves differently.
- **`new.tsx` form changes** — none. The duplicate-banner deep-link inside `new.tsx:103` **is** updated (one-line change `/${row.id}` → `/${row.id}/edit`) because Unknown 7 says route the banner to edit, but the rest of the form is untouched.
- **`confirmDelete` semantics** — unchanged; stays on Edit screen.
- **`["stats"]` cache invalidation** — explicitly out per prompt hard requirement.

## Open questions for the Validator

1. **Duplicate-banner test coverage**: the existing `edge: duplicate same-day shows amber banner with CTA` test (`measurements.spec.ts:191-214`) clicks the banner CTA only enough to assert the banner is visible; it does not click "Open existing entry" and assert the post-click URL. Should the Implementer extend this test to also assert `await page.waitForURL(/\/measurements\/[0-9a-f-]+\/edit/)` after clicking "Open existing entry"? **Designer recommendation**: yes — covers the Unknown 7 decision permanently. But this is an additive test concern, not a blocker for the design.

2. **Inline Edit CTA copy**: `"Edit measurement"` (full string) vs `"Edit"` (short). The headerRight icon has an `accessibilityLabel="Edit measurement"` but no visible text. The inline CTA visible text could be either. Designer chose `"Edit measurement"` for symmetry with the Edit screen's title and the e2e test's `page.getByText("Edit", { exact: false })` selector matches both. Validator: confirm or push back.

3. **`new.tsx` deep-link change** is technically a second logical change inside an "edited" file (the file's other purpose is the New form). It's a one-line touch on a single string, narrowly scoped to Unknown 7. Designer flags this as borderline-acceptable under the "one responsibility per file" rule. Validator: confirm acceptable or split.

4. **`MeasurementsProgressStrip` width on Android header re-layout**: `useWindowDimensions` updates on orientation change, but the `chartWidth` memo doesn't re-render the SVG width prop because `ProgressChart` recomputes `points` only on `[data, width, height]` changes — width is in the dep array, so the chart will resize. Validator: confirm this is correct (I read the memo deps as covering orientation correctly, but worth a second pair of eyes).

5. **Section ordering on view screen**: Designer chose to mirror the edit-form's section order verbatim (Weight & body fat → Upper body → Core → Lower body → Notes). Validator: confirm or propose alternatives (e.g. "most-changed metrics first").

## Resposta a issues do Validator

N/A — this is v1.
