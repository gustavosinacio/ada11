# Validation v1 — 2026-05-20_0856_measurements-move-to-profile

## Claims verified

| Claim | Verified? | Evidence |
|---|---|---|
| `_layout.tsx` imports `Ruler` only at line 5; uses only at line 47 | yes | project-wide grep confirms 2 occurrences |
| Routines `<Tabs.Screen name="routines" options={{ href: null }} />` at `_layout.tsx:25-28` | yes | verbatim |
| Measurements `<Tabs.Screen>` block at lines 43-49 with title + tabBarIcon | yes | verbatim |
| `profile.tsx` has sections "Preferences" (lines 32-120) and "About" (lines 122-128) — no other section between | yes | verified |
| `profile.tsx` already imports `ChevronRight` | yes | line 1 |
| `profile.tsx` does NOT import `useRouter` today | yes | needs to be added |
| `<Row>` helper at lines 135-157 renders ChevronRight at `opacity-0` | yes | line 151 `className="ml-2 opacity-0"` |
| `app/(app)/measurements/index.tsx` is the list/history screen (NOT a Redirect) | yes | line 17 exports `MeasurementsList` |
| `goToMeasurements` helper at `measurements.spec.ts:74-77` clicks tab text | yes | verbatim |
| 7 callers of `goToMeasurements`: 93, 171, 198, 214, 242, 263, 281 | yes | grep confirms |
| Tab-count test at `measurements.spec.ts:320-342` named "5 tabs render..." with positive Measurements assertion at line 329 | yes | verified |
| Routines negative assertion at line 326 uses `not.toBeVisible()` with plain text selector | yes | establishes the project pattern |
| `probe-strong-unify.spec.ts:66-78` is the 5-tab IA assertion | yes | verified |
| `probe-strong-unify.spec.ts:128-131` contains the Measurements arm of banner-across-tabs | yes | verified |
| `router.push("/(app)/measurements")` is the project-consistent form | yes | matches `measurements/[id]/edit.tsx:96,115` |
| `#9ca3af` icon tint matches existing Profile `<Row>` chevron color | yes | same constant in 6 other files |
| `expo-router ~6.0.23` `href: null` API correct | yes | verified in F1 run |

## Findings

### Blockers
None.

### Majors
None.

### Minors

- **[MIN-1]** Tab-count test post-rewrite — design offers `getByRole("tab", ...).not.toBeVisible()` as a possibility. Project pattern at line 326 is plain `getByText(..., { exact: true }).not.toBeVisible()`. Mirror that pattern. ALSO: the negative Measurements assertion MUST run BEFORE the Profile tab click (otherwise the Profile screen's Measurements row text matches).

- **[MIN-2]** Helper rewrite selector — design proposes `getByRole("button", { name: "Measurements" })`. Project pattern is `getByLabel("...")` across `probe-strong-unify.spec.ts` (zero usages of `getByRole`). Use `getByLabel("Measurements")` after the implementer sets `accessibilityLabel="Measurements"` on the Pressable.

- **[MIN-3]** Helper `goToMeasurements` post-rewrite must include `await page.waitForURL(/\/profile/, { timeout: 10_000 });` after the Profile tab click, before clicking the Measurements row — prevents click race against tab transition.

- **[MIN-4]** Dropping `probe-strong-unify.spec.ts:128-131` Measurements arm shrinks IA coverage of "banner persists across `router.push` into Measurements". Defensible since Measurements is now sibling-pushed not a tab transition. Acceptable; revisit if QA flags.

- **[MIN-5]** Profile visual rhythm: new bordered card has no section header (defensible — too small to justify a "Tracking" group). Slight asymmetry with Preferences/About sections, but design intent.

## Concerns explicitly probed and cleared
- Tab order after `href: null` — declaration order doesn't affect visible order beyond filtering.
- `Ruler` import safe to remove (only 2 occurrences in `_layout.tsx`).
- `measurements/index.tsx` stays the list (no Redirect) — honored.
- `router.push("/(app)/measurements")` resolves.
- Profile sections today are exactly Preferences + About.
- Accessibility label + role set.
- No new `any` / `@ts-ignore`.
- Dark-mode tokens align.
- Active-session banner persists during Profile→Measurements navigation.
- Android/web back semantics OK.

## Decision

**go** — 0 blockers, 0 majors, 5 minors.

Implementer should address MIN-1, MIN-2, MIN-3 during implementation (test correctness/style). MIN-4 and MIN-5 are design-intent calls.
