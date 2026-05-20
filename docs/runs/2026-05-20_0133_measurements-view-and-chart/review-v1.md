# Review v1 — 2026-05-20_0133_measurements-view-and-chart

Reviewing: the diff for the implementation against `design-v2.md`.

## Diff scope

- Baseline: `5252409d20d4c2afc67885442351e9256247a1b1`
- Files changed:
  - **deleted**: `app/(app)/measurements/[id].tsx` (426 lines)
  - **new**: `app/(app)/measurements/[id]/index.tsx` (191), `app/(app)/measurements/[id]/edit.tsx` (426), `src/components/measurements-progress-strip.tsx` (71), `src/utils/measurements-chart.ts` (50), `tests/unit/measurements-chart.test.ts` (105)
  - **edited**: `app/(app)/measurements/index.tsx` (+2/-0), `app/(app)/measurements/new.tsx` (+1/-1), `tests/e2e/measurements.spec.ts` (~30 lines rewired across 3 tests; total still 8 `test()` blocks)
  - **untouched**: `src/components/progress-chart.tsx`

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| `[id].tsx` deleted; folder `[id]/{index.tsx,edit.tsx}` exists | yes | confirmed via `git status` + `ls`. |
| `headerRight` is function form mirroring `measurements/index.tsx:30-39` | yes | `[id]/index.tsx:148-157` byte-equivalent with `Pencil`. |
| `screenHeader` const mounted in loading / error / happy branches | yes | `[id]/index.tsx:165, 174, 187`. |
| Inline "Edit measurement" CTA navigates to `./edit` via `<Link>` | yes | `[id]/index.tsx:123-132`. |
| `[id]/edit.tsx` deep-link target updated to `/edit` | yes | `[id]/edit.tsx:145`. |
| `new.tsx:103` deep-link target updated to `/edit` | yes | one-line diff. |
| `ListHeaderComponent={<MeasurementsProgressStrip />}` mounted | yes | `measurements/index.tsx:76`. |
| Strip returns `null` on `<2` valid bodyweight datapoints | yes | `measurements-progress-strip.tsx:44`. |
| Strip uses `useWeightUnit()` and passes `title={\`Weight (${unit})\`}` | yes | `measurements-progress-strip.tsx:23, 65`. |
| Latest weight via `.find()` on DESC list (MIN-4) | yes | `measurements-progress-strip.tsx:47-49`. |
| `entriesToWeightSeries` pure, no I/O, DESC→ASC, kg→lbs at boundary | yes | `measurements-chart.ts:30-50`. |
| No `["stats"]` cross-invalidation introduced | yes | grep clean. |
| `progress-chart.tsx` NOT modified | yes | no semantic diff. |
| e2e test count stays at 8 | yes | `grep -cnE '^\s*test\('` returns `8`. |
| `waitForURL` regexes anchored with `$` | yes | `measurements.spec.ts:124, 131, 134, 136, 225, 284, 288`. |
| `page.on("dialog", ...)` listener above edit click in soft-delete | yes | `:286` above `:287`. |
| `getByLabel("Edit measurement")` step is inline (not new `test()`) | yes | `:130` inside golden test. |
| 7 new unit tests in `measurements-chart.test.ts` pass | yes | 51/51 total (44 prior + 7 new). |
| No new `any`, no `// @ts-ignore`, no `console.log` | yes | grep clean. |

## Issues

### Blockers
None.

### Majors
None.

### Minors

- **[MIN-1]** `app/(app)/measurements/[id]/index.tsx:23-32` — The `format` parameter of `buildRow` shadows the `date-fns` `format` import. Harmless today but foot-gun for next change. **Fix**: rename parameter to `formatValue`.
- **[MIN-2]** `app/(app)/measurements/[id]/index.tsx:188` — `id ?? ""` fallback masks `useLocalSearchParams<{ id: string }>` lie. Behaviorally safe via `useMeasurement.enabled`. **No required fix.**
- **[MIN-3]** `app/(app)/measurements/[id]/index.tsx:73-77` — `try/catch` around `format(parseISO(...))` is defensive; `measured_at` is `NOT NULL` ISO. **Fix (optional)**: drop try/catch or use `isValid(d) ? ...`.
- **[MIN-4]** Hook placement: design pseudo-code called unit hooks on parent; implementation split into `MeasurementBody` subcomponent. Behavior identical. **No required fix**; flag for transparency.
- **[MIN-5]** Notes value rendered as bare `<Text>` — consistent with `MetricRow` value styling.
- **[MIN-6]** `tests/e2e/measurements.spec.ts:133` `page.goBack()` round-trip depends on Expo Router web stack honoring browser history. Implementer flagged in `implementation.md` "Notes for Tester" — if flaky, drop the bounce and rely on `getByLabel` coverage only.

## Security checklist
- [x] RLS reuses existing protections (`useMeasurement`/`useMeasurements`); no new tables.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` in client code.
- [x] No raw SQL `.rpc()` calls.
- [x] No new `EXPO_PUBLIC_*` env vars.

## Style / convention checklist
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] No new `console.log`.
- [x] Comments narrate *why*, not *what*.
- [x] Imports follow project style.
- [x] Files placed in conventional folders.
- [x] Dark mode tokens on every new screen + strip.
- [x] Cache namespace isolation preserved.

## Quality gates (re-run by Reviewer)

- `npm run typecheck` — **PASS**.
- `npm run lint` — **PASS** (only pre-existing `router.d.ts` warning).
- `npm run test:unit` — **PASS** 51/51.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 6 minors. All design v2 decisions honored verbatim; all 5 validator inline guidances followed.
- 3 documented deviations from design are justified and harmless.
- Minors are cosmetic polish; Tester should keep an eye on the `goBack()` flake risk in the golden e2e (MIN-6).
