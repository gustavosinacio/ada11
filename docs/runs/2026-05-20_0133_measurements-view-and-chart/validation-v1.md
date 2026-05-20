# Validation v1 — 2026-05-20_0133_measurements-view-and-chart

Reviewing: `design-v1.md`

## Verification of Designer's claims

| Claim | Verified? | Evidence |
|---|---|---|
| Expo Router cannot have `[id].tsx` file + `[id]/` folder at same segment (forces Pattern A) | yes | Existing `app/(app)/exercises/[id]/` folder has no sibling `[id].tsx`. Globbed `app/(app)/**/[id]*.tsx` returns only `history/[id].tsx` and `measurements/[id].tsx` — both as files only, no folder twin. Pattern A is mechanically correct. |
| `app/(app)/exercises/[id]/{index.tsx,progress.tsx}` is the precedent | yes | Confirmed via glob: `app/(app)/exercises/[id]/index.tsx` and `.../progress.tsx` both exist. `exercises/_layout.tsx:3` is `<Stack screenOptions={{ headerShown: false }} />` — identical shape to `measurements/_layout.tsx:3`. No per-folder layout file needed at `[id]/` level. |
| `measurements/_layout.tsx:3-4` is `<Stack screenOptions={{ headerShown: false }} />` | yes | Verified at `app/(app)/measurements/_layout.tsx:3-5`. |
| Duplicate-banner deep-link is at `new.tsx:103` and `[id].tsx:145` | yes | `new.tsx:103` = `router.replace(\`/(app)/measurements/${row.id}\`)`; `[id].tsx:145` = same. Both confirmed. |
| Duplicate-banner copy "edit it instead?" lives at `new.tsx:312-314` and `[id].tsx:374-376` | yes | Verified at `new.tsx:313-314` and `[id].tsx:374-376`. |
| `ProgressChart` has `DataPoint = { label, value }`, handles `length === 0/1` | yes | `progress-chart.tsx:5-8` exports `DataPoint = { label: string; value: number }`. `length === 0` branch at lines 59-65 ("No data yet"). `length === 1` branch at lines 67-77 (big-number card). |
| `useMeasurement(id)` already caches by ID; list query populates `["measurements"]` | yes | `use-measurements.ts:12-15` defines `KEYS.all = ["measurements"]` and `KEYS.detail(id) = ["measurements", id]`. Mutation handlers invalidate `["measurements"]` and `setQueryData(["measurements", id], row)`. No `["stats"]` cross-invalidation. |
| `WeightUnit = "kg" \| "lbs"` (design says "Weight (kg\|lb)") | **partial** | `src/db/types.ts:33` defines `WeightUnit = "kg" \| "lbs"` — note **`"lbs"`**, not `"lb"`. Design table row 4 + line 92 use "kg\|lb" shorthand. Output of `\`Weight (${unit})\`` will be "Weight (lbs)". See MIN-1. |
| `WeeklyVolumeStrip` precedent: early `null` on empty/error, `useMemo`, unit read inline | yes | `weekly-volume-strip.tsx:87-89` (early `null`), `:68-71` (`useMemo` keyed on `[data]`), unit read inline at JSX. |
| `history/index.tsx:48` mounts `<WeeklyVolumeStrip />` as `ListHeaderComponent` | yes | Verified. |
| `measurement-list-item.tsx` tap callback is wired by parent, component unchanged | yes | `measurement-list-item.tsx:46+57` — `onPress` is a prop. Parent at `measurements/index.tsx:80` is `router.push(\`/(app)/measurements/${item.id}\`)`. |
| E2e test at `measurements.spec.ts:123-130` is the golden tap-row → edit flow | yes | Confirmed. |
| E2e test at `:265-275` is the soft-delete flow | yes | Confirmed. |
| Duplicate-banner test (191-214) asserts only banner visibility, not URL | yes | Lines 209-210 only assert text visibility; no `waitForURL` after the CTA. |
| `Pencil` icon ships in `lucide-react-native` | yes | Same package as `Plus`, `ChevronRight` etc. already in use. |
| `MeasurementEntryRow` shape with all `*_cm` as `string \| null` | yes | `src/db/types.ts:128-146`. |
| `listMeasurements` returns DESC by `measured_at` | yes | `src/api/measurements.ts:105`. |
| `headerRight` precedent at `measurements/index.tsx:30-39` is **function form** (`headerRight: () => (...)`) | yes | Verified — function form. Design's prose (line 38) shows the direct-element form `headerRight: <EditButton id={id} />`. See MAJ-1. |
| `getByText("Edit", { exact: false }).last()` matches both headerRight icon + inline CTA | **no** | Playwright `getByText` does NOT match `accessibilityLabel` on icon-only buttons. The headerRight is a `Pencil` icon-only Pressable (analogous to `Plus` at `measurements/index.tsx:37`) with `accessibilityLabel` but no visible "Edit" text. `getByText("Edit", { exact: false })` only matches the inline CTA. See MAJ-2. |
| Body-fat formatted as `${n.toFixed(1)}%` matches `measurement-list-item.tsx:31` | yes | Confirmed. |

## Issues found

### Blockers
None.

### Majors

- **[MAJ-1]** `design-v1.md:38,135` — `headerRight` is specified as a JSX element directly (`headerRight: <EditButton id={id} />`), but the codebase precedent at `app/(app)/measurements/index.tsx:30-39` (and every other `Stack.Screen` in the project) uses the **function form** `headerRight: () => (<Pressable ... />)`. Expo Router's `Stack.Screen` types expect `headerRight?: (props) => React.ReactNode`. Passing a raw JSX element risks either a TypeScript error or silent non-render depending on the react-navigation version pinned. **Suggested fix**: rewrite design pseudo-code to `headerRight: () => <Pressable onPress={() => router.push(\`/(app)/measurements/${id}/edit\`)} accessibilityLabel="Edit measurement" accessibilityRole="button" className="px-3 py-1"><Pencil color={colorScheme === "dark" ? "#fff" : "#000"} size={20} /></Pressable>` — verbatim mirror of the `Plus` precedent at `measurements/index.tsx:30-39`. Also remember `useColorScheme()` for icon color.

- **[MAJ-2]** `design-v1.md:44,138` — The e2e test edit selector is specified as `page.getByText("Edit", { exact: false }).last()` with the claim it "matches both the headerRight Edit button label and the inline 'Edit measurement' CTA". This is **wrong**: Playwright's `getByText` matches *visible text content*, not `accessibilityLabel`. The headerRight button is icon-only (Pencil), with no visible "Edit" text — exactly like the existing `Plus` headerRight on the list screen. Only the inline bordered CTA carries visible text. The `.last()` is also brittle. **Suggested fix**: rewrite test step as `await page.getByText("Edit measurement", { exact: true }).click()` (matches the inline CTA precisely). If header-button coverage is desired, add a separate assertion using `page.getByRole("button", { name: "Edit measurement" })` or `page.getByLabel("Edit measurement")`.

### Minors

- **[MIN-1]** `design-v1.md:41,92, row-4` — Design writes the chart title as `"Weight (kg|lb)"`, but actual `WeightUnit` type is `"kg" | "lbs"` (`src/db/types.ts:33`). If the Implementer literally writes `\`Weight (${unit})\`` the output will be `"Weight (lbs)"`, not `"Weight (lb)"`. Pure documentation/copy issue. **Suggested fix**: update design copy to `"Weight (kg|lbs)"` everywhere.

- **[MIN-2]** `design-v1.md:33-46` (Mudanças por arquivo table) — The table omits a row for `app/(app)/measurements/new.tsx`. The Risks section (line 316) correctly states that `new.tsx:103` also gets its deep-link target updated to `/${row.id}/edit`. But an Implementer reading only the table would miss this. **Suggested fix**: add a row to the table for `new.tsx`. Also raise "Total" from 3 to 4 edited.

- **[MIN-3]** `design-v1.md:283-285,293` — Design passes `title=""` to `ProgressChart` and claims "renders an empty `<Text>` when title is `""` — harmless, takes ~zero height." Looking at `progress-chart.tsx:83`, the `<Text className="mb-2 text-sm font-medium text-gray-500">` adds 8px margin-bottom + line-height even with empty content. The strip will have a small extra gap above the SVG. **Suggested fix**: either pass `title={\`Weight (${unit})\`}` and drop the manual `<Text>` headline (lines 272-277), OR add a `title` prop on `ProgressChart` that accepts `undefined`/`null` to skip rendering the `<Text>` row.

- **[MIN-4]** `design-v1.md:260-265` — The "latest weight" lookup re-sorts `data` DESC manually but `listMeasurements` already returns DESC. **Suggested fix**: `(data ?? []).find((r) => r.weight_kg != null && Number.isFinite(parseFloat(r.weight_kg)))?.weight_kg ?? null`.

- **[MIN-5]** `design-v1.md:182-184` — Design's "row was inserted somehow" hedge is fine but unnecessary; `buildSubmitPayload` enforces ≥1 metric. **Suggested fix**: drop the "somehow" hedge; clarify "entries with no metrics cannot exist (zod-guarded at create/edit), so date + Notes + Edit CTA are the minimum render."

- **[MIN-6]** `design-v1.md:316` — Risks section flags the e2e test extension as a "nice-to-have". Elevate it to the Implementer's checklist: add `await page.waitForURL(/\/measurements\/[0-9a-f-]+\/edit$/)` after the `Open existing entry` click.

- **[MIN-7]** No mention of pull-to-refresh on the view screen. Cache-invalidation on edit/delete covers most cases; multi-device staleness is a soft edge. Low impact. **Suggested fix**: add a one-line risk note that the view screen relies on cache invalidation.

- **[MIN-8]** `design-v1.md:38` — view-screen pseudo-prose mentions `Stack.Screen` but only inside the happy-path narrative. Per existing precedent at `[id].tsx:151+163+178`, `Stack.Screen` is rendered inside each branch (loading/error/empty/data) so the header is consistent. **Suggested fix**: in the happy-path pseudo, show `<Stack.Screen options={{ title: "Measurement", headerShown: true, headerRight: () => <PencilButton id={id} /> }} />` as the first child.

## Decision

**no-go**

Reasoning:
- 0 blockers, 2 majors (MAJ-1 `headerRight` form smell, MAJ-2 broken Playwright selector), 8 minors. Per decision rule (≥2 majors → no-go), this round is **no-go**.
- Both majors are localized pseudo-code/test-selector smells, not architectural problems — the Designer's overall approach (Pattern A folder split, ListHeaderComponent strip, util extraction, edit-only delete, edit-target duplicate banner) is sound and matches code precedents byte-for-byte.

Specific changes the Designer must make in v2:
1. **MAJ-1**: Rewrite `headerRight` to function form (`headerRight: () => (<Pressable ... />)`), citing the `measurements/index.tsx:30-39` precedent.
2. **MAJ-2**: Replace `getByText("Edit", { exact: false }).last()` with `getByText("Edit measurement", { exact: true })` for the inline CTA. If header-button coverage is wanted, add an explicit role/label-based locator assertion.
3. Address the 8 minors at the same time (especially MIN-2: add `new.tsx` to the changes table; MIN-3: clarify the chart title rendering).

Both majors are mechanical edits to pseudo-code — a v2 design should land in a single round.
