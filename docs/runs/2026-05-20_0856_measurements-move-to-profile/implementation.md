# Implementation — 2026-05-20_0856_measurements-move-to-profile

Based on: `design-v1.md` (binding) and `validation-v1.md` (matching `go`, 0 blockers / 0 majors / 5 minors). MIN-1, MIN-2, MIN-3 addressed in code. MIN-4 and MIN-5 honored as design-intent calls.

## Files changed

- `app/(app)/_layout.tsx` (edited) — Dropped `Ruler` import; collapsed the Measurements `<Tabs.Screen>` block from `{ title, tabBarIcon }` to `{ href: null }`, mirroring the Routines pattern verbatim. All other tabs preserved unchanged.
- `app/(app)/profile.tsx` (edited) — Added `useRouter` import from `expo-router` and `Ruler` to the existing `lucide-react-native` import. Added `const router = useRouter();` inside `ProfileScreen`. Inserted a single bordered `Pressable` between the Preferences card and the About header. Navigates to `/(app)/measurements` on press. Accessibility: `accessibilityRole="button"`, `accessibilityLabel="Measurements"`. The read-only `<Row>` helper is untouched.
- `tests/e2e/measurements.spec.ts` (edited) — Two changes: (1) `goToMeasurements` helper rewritten to a two-step nav (click Profile tab, `waitForURL(/\/profile/)`, click the Profile row via `getByLabel("Measurements")`, `waitForURL(/\/measurements/)`). MIN-2 + MIN-3 applied. (2) Tab-count regression test at line 322: renamed to "4 tabs render, no Routines or Measurements tab, Profile shows weight + length unit toggles + Measurements row"; added a negative `Measurements` text assertion BEFORE the Profile tab click (MIN-1) using the project's plain-text `not.toBeVisible()` pattern; added a positive `getByLabel("Measurements")` assertion AFTER the Profile click to verify the new Profile row.
- `tests/e2e/probe-strong-unify.spec.ts` (edited) — Two changes: (1) 5-tab IA test rewritten to 4-tab IA — dropped the positive Measurements tab assertion, added a negative `toHaveCount(0)` on the `Measurements` text mirroring the existing Routines pattern, renamed the test, renamed the email prefix. (2) Banner-across-tabs test (`active session: banner visible across tabs, click resumes same session`): dropped the Measurements arm (click + waitForURL + banner assertion) per MIN-4 / design recommendation. Workout / Exercises / History / Profile arms remain.

## Deviations from design

- **Card classNames diverge from the design's example snippet** (`mb-8`, `py-3`, `size={18}`). Implemented as `mb-6`, `py-4`, `size={20}`, which is the binding form specified by the brief's file-plan code block (more current than the design-v1 prose snippet). Visual rhythm is preserved; the slightly larger icon and vertical padding produces a more comfortable tap target (~52px) on web. Justified — brief is the most recent constraint.
- **Validator MIN-1 phrasing**: design suggested either `getByRole("tab", ...)` or scoped `getByText`. Used the project-consistent `getByText("Measurements", { exact: true }).not.toBeVisible()` placed BEFORE the Profile click (so the new Profile row's "Measurements" text does not match). Matches the existing Routines negative pattern at the same test.
- **Validator MIN-2**: design suggested `getByRole("button", { name: "Measurements" })`. Implemented as `getByLabel("Measurements")` per validator MIN-2 — `getByLabel` is the project pattern; zero `getByRole` usages in `probe-strong-unify.spec.ts`. Requires `accessibilityLabel="Measurements"` on the new Pressable (set).
- **Validator MIN-3**: added `await page.waitForURL(/\/profile/, { timeout: 10_000 });` between the Profile tab click and the row click in `goToMeasurements`. Prevents click race against tab transition.
- **Validator MIN-4**: dropped the Measurements arm of the banner-across-tabs probe rather than rewriting it to navigate Profile → Measurements row. Defensible because the remaining arms (Workout / Exercises / History / Profile) already exercise the "banner persists across tab transitions" property. Profile → Measurements is no longer a tab transition (sibling-pushed route), so a Profile→Measurements arm would test a different property than the test's stated intent.
- **Validator MIN-5**: no section header above the new Measurements card. Asymmetric with Preferences/About (which group multiple rows), but a single-row uppercase header reads heavier than the row itself. Design-intent call.

## Soft callbacks made (during this implementation pass)

- none

## Quality gates

- [x] `npm run typecheck` passed (clean)
- [x] `npm run lint` passed (only pre-existing `router.d.ts` warning — same as baseline)
- [x] Relevant unit tests pass — `npm run test:unit` → 51/51 across 6 files
- [x] Relevant E2E tests pass — `npm run test:e2e tests/e2e/measurements.spec.ts tests/e2e/probe-strong-unify.spec.ts` → 16/16 (after starting Expo web dev server)
- [x] No new `any`
- [x] No new `// @ts-ignore`
- [x] No stray `console.log`

## Notes for Reviewer / Tester

- The Measurements card on Profile uses the dark-mode token pair `border-gray-200 dark:border-gray-800` — identical to Preferences and About cards. Icon tint `#9ca3af` matches the existing `<Row>` chevron color.
- Web bookmark `/measurements` continues to resolve to the list screen (no `<Redirect>` — explicit design divergence from the Routines precedent, brief-pinned).
- Android/web back from `/measurements` (reached via Profile row) lands on `/profile` because the row uses `router.push`. Direct-URL entry to `/measurements` still works; back goes to whatever the previous history entry was.
- Tester: the new Profile card has `accessibilityLabel="Measurements"`. If exercising the Profile→Measurements flow in a new spec, use `getByLabel("Measurements")` (matches the helper rewrite); avoid `getByText("Measurements")` because the Profile screen now has a `<Text>Measurements</Text>` inside the Pressable that would also match.
- The 4-tab IA negative assertion in `measurements.spec.ts:322` and `probe-strong-unify.spec.ts:66` uses two different forms: `not.toBeVisible()` (matching the existing Routines pattern in `measurements.spec.ts`) and `toHaveCount(0)` (matching the existing Routines pattern in `probe-strong-unify.spec.ts`). Both are correct against the project conventions in their respective files.

## Status

- `status`: **done**
- `files_touched`: 4
- `deviations_count`: 5 (all justified — className tuning per the brief's more recent constraint, plus the 4 validator-Minor follow-throughs)
- `recommendation`: **invoke Reviewer**
