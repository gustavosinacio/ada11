# Implementation — 2026-05-20_0133_measurements-view-and-chart

Based on: `design-v2.md` (final approved) and `validation-v2.md` (matching `go`).

## Files changed

- `app/(app)/measurements/[id].tsx` (**deleted**) — file-form replaced by folder-form `[id]/` per Expo Router segment-collision rule. Content relocated to `[id]/edit.tsx`.
- `app/(app)/measurements/[id]/index.tsx` (**new**) — read-only view screen. Sectioned cards (Date headline + Weight & body fat + Upper body + Core + Lower body + Notes), empty rows + empty sections omitted entirely. `screenHeader` const mounted inside loading / error / happy branches. `headerRight` is function-form Pencil icon with `accessibilityLabel="Edit measurement"` mirroring `measurements/index.tsx:30-39` byte-for-byte. Inline bordered "Edit measurement" CTA at the bottom navigates to `./edit`. No delete action, no pull-to-refresh.
- `app/(app)/measurements/[id]/edit.tsx` (**new**, relocated from former `[id].tsx`) — content copied verbatim except the duplicate-banner deep-link: `router.replace(\`/(app)/measurements/${row.id}\`)` → `router.replace(\`/(app)/measurements/${row.id}/edit\`)` (Unknown 7).
- `app/(app)/measurements/index.tsx` (**edited**) — added `MeasurementsProgressStrip` import and mounted it as `ListHeaderComponent` on the existing `FlatList`. Pull-to-refresh + tap-row navigation unchanged.
- `app/(app)/measurements/new.tsx` (**edited**) — one-line: line 103 `router.replace` target now `/(app)/measurements/${row.id}/edit` (Unknown 7).
- `src/components/measurements-progress-strip.tsx` (**new**) — `ListHeaderComponent` chart. Reads `useMeasurements()` + `useWeightUnit()`, memoizes `entriesToWeightSeries(data, unit, 12)`. Loading skeleton; returns `null` on error / `<2` datapoints. Renders latest-weight big number above a `<ProgressChart title={\`Weight (${unit})\`} ... />`. Latest weight via `(data ?? []).find(...)` on the DESC list (no manual re-sort, per MIN-4).
- `src/utils/measurements-chart.ts` (**new**) — pure helper `entriesToWeightSeries(entries, unit, maxPoints?)`. Filters `weight_kg != null` + `Number.isFinite`, takes first N from DESC input, reverses to ASC, converts to lbs at the return boundary when `unit === "lbs"`. Label format `M/D` matching `exercises/[id]/progress.tsx` `shortDate`.
- `tests/e2e/measurements.spec.ts` (**edited**, 3 test bodies; total still 8):
  - Golden: anchored view URL `[0-9a-f-]+$`, asserts `"80.0 kg"` visible on view screen, then exercises **both** Edit affordances (`getByLabel("Edit measurement")` for header icon + `getByText("Edit measurement", { exact: true })` for inline CTA via `page.goBack()` bounce) with `/edit$` waits before save flow. Optional header-button coverage added as inline assertions, **not** a new `test()` block (per validator MIN-4-v2).
  - Duplicate-banner: added `await page.getByText("Open existing entry").click()` + `await page.waitForURL(/\/measurements\/[0-9a-f-]+\/edit$/)` to lock in Unknown 7 (MIN-6-v2).
  - Soft-delete: anchored view URL with `$`, kept `page.on("dialog", ...)` listener above the edit click (MIN-6-v2), inserted `Edit measurement` click + `/edit$` wait between landing on view and clicking Delete.
- `tests/unit/measurements-chart.test.ts` (**new**) — 7 unit tests for `entriesToWeightSeries`: empty input, null/non-finite filtering, DESC→ASC reversal, default + custom `maxPoints`, kg→lbs conversion, M/D label formatting. Not in the Mudanças table but consistent with Unknown 11 ("extract pure logic for unit-testability"). All pass.

## Deviations from design

- **Added unit-test file `tests/unit/measurements-chart.test.ts`.** Design v2 §Decisions §11 explicitly justified the helper extraction as "mirrors validator MIN-2 from prior run (extract pure logic for unit-testability)". Coverage was implicit but not enumerated as a file deliverable in the Mudanças table; adding it makes the unit-testability decision actionable. No production-code impact.
- **Golden e2e test exercises *both* Edit affordances** (header icon + inline CTA), via a `page.goBack()` round-trip between them. Design v2 listed the header-button coverage as **optional**; the prompt handoff escalated it to "Optional inline header-button coverage: also test `getByLabel('Edit measurement')` click leads to `/edit$`. Add as a step inside the same test (NOT a new `test()` block — keep total at 8)." Honored: total test count remains 8.
- **`id` fallback to empty string in `<Link href>` and `MeasurementBody id={id ?? ""}`** — `useLocalSearchParams<{ id: string }>()` returns `string | undefined` at the TS level. The `useMeasurement(id)` hook short-circuits via `enabled: Boolean(id)`, so any `id == null` case lands in the loading branch and the empty-string `id` value is never actually navigated to. This is a minor type-safety tightening over the design pseudo-code (which uses `id` raw); behaviorally identical.

Total deviations: 3 (all justified above; no design-binding constraint violated).

## Soft callbacks made (during this implementation pass)

- None. No ambiguity blocked progress; the design was complete.

## Quality gates

- [x] `npm run typecheck` passed — clean, 0 errors.
- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning (`router.d.ts`, unchanged).
- [x] `npm run test:unit` — 51 tests pass (44 prior + 7 new in `measurements-chart.test.ts`).
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log` (the surviving `console.warn` in `[id]/edit.tsx` is unchanged from its original location in the deleted `[id].tsx` — pre-existing).
- [ ] `npm run test:e2e tests/e2e/measurements.spec.ts` — **not exercised in this pass.** Requires a live dev server + Supabase service-role env vars (`.env.local`). Quality-gate inspection limited to typecheck + lint + unit tests + manual diff review against the spec.

## Notes for Reviewer / Tester

- **Tester**: when running e2e, the `page.goBack()` in the golden test relies on Expo Router's web stack honoring browser history. If that turns out to be flaky on the CI runner, the simpler alternative is to drop the bounce and pick one affordance only — but per the handoff, both are deliberately covered.
- **Reviewer**: `src/components/progress-chart.tsx` was **NOT** modified, per validator note MIN-2-v2. The new caller passes `title` as a non-empty string (`"Weight (kg)"` or `"Weight (lbs)"`), matching the existing required-string signature.
- **Reviewer**: `[id]/edit.tsx` is a byte-for-byte port of the former `[id].tsx` except for the single `router.replace` deep-link target update at the `openExistingEntry` callback (former line 145, now in `[id]/edit.tsx`). The relocation is functionally a `git mv` plus that one-line edit.
- **Tester / Reviewer**: total `test()` block count in `tests/e2e/measurements.spec.ts` is unchanged at 8 (verified via `grep -nE '^\s*test\('`).
- **Reviewer**: the view screen never renders any chart strip itself — the strip lives only on the list screen as `ListHeaderComponent`. This matches the design's "in-place graph on the list" placement decision (Unknown 3).
