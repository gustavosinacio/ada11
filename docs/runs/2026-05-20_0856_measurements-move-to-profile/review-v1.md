# Review v1 — 2026-05-20_0856_measurements-move-to-profile

## Summary
Tight surgical diff. 4 files, +26/-16. Quality gates green. All 10 design checks pass.

## Verification

1. `_layout.tsx:42-45` mirrors Routines `href: null` at lines 24-27. ✓
2. `Ruler` import dropped from `_layout.tsx:2-7`. ✓
3. Profile Pressable at `profile.tsx:124-135` — `accessibilityRole="button"`, `accessibilityLabel="Measurements"`, `onPress={() => router.push("/(app)/measurements")}`, dark-mode tokens, ChevronRight right, Ruler left. ✓
4. `useRouter` + `Ruler` imports at `profile.tsx:1-2`. ✓
5. Card placement between Preferences (line 122) and About (line 137). ✓
6. `goToMeasurements` at `measurements.spec.ts:74-79`: Profile click → `waitForURL(/\/profile/)` → `getByLabel("Measurements").click()` → `waitForURL(/\/measurements/)`. ✓
7. Tab-count test at `measurements.spec.ts:322-345`: renamed; negative `Measurements not.toBeVisible()` at line 329 BEFORE Profile click; positive `getByLabel("Measurements")` at line 341 AFTER. ✓
8. `probe-strong-unify.spec.ts:66-78` → 4-tab IA with `toHaveCount(0)` for Measurements at line 76. ✓
9. Measurements arm dropped from banner-across-tabs test. ✓
10. No new `any` / `@ts-ignore` / `console.log`. ✓

## Issues

### Blockers
None.

### Majors
None.

### Minors

- **MIN-R1** `profile.tsx:131,134` — Icon `size={20}` vs `<Row>` helper's `size={18}` at line 167. Documented deviation (larger tap target on web); cosmetic asymmetry.
- **MIN-R2** `profile.tsx:128` — Card `mb-6` vs neighboring Preferences/About `mb-8`. Documented deviation; cosmetic asymmetry.
- **MIN-R3** `measurements.spec.ts:329` — Negative assertion not scoped to tab-bar region. Currently safe because Workout screen doesn't render "Measurements" text. Future regression-proofing only.

## Security checklist
- [x] RLS — N/A (no data-layer touch).
- [x] No service-role tokens.
- [x] No `.rpc()` calls.
- [x] No new `EXPO_PUBLIC_*` env vars.

## Quality gates
- `npm run typecheck` — clean.
- `npm run lint` — 0 errors, 1 pre-existing `router.d.ts` warning.
- `npm run test:unit` — 51/51.
- (Implementer ran e2e during implementation: 16/16 across measurements.spec.ts + probe-strong-unify.spec.ts.)

## Decision

**pass** — 0 blockers, 0 majors, 3 cosmetic minors. All 5 implementer deviations documented and reasonable.
