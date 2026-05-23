# Implementation — 2026-05-23_1805_session-total-volume-header

Based on: `design-v1.md` (approved) and `validation-v1.md` (matching `go` with 1 major + 4 minors).

## Files changed

- `src/components/session-header.tsx` (edited) — Added `volumeKg: number` + `unit: WeightUnit` props. Wrapped the existing "Elapsed" block and the new "Volume" block in a single `flex-row items-center gap-6` container to the left of the unchanged "Finish" `Pressable`. Both metric numerals render at `text-xl` (down from `text-2xl`) to absorb MAJ-1. The volume numeral carries `accessibilityRole="text"` + `accessibilityLabel="Session total volume: <formatted>"` on the inner `<Text>` (MIN-3 option a, matching `volume-target-slot.tsx:89-93`).
- `app/(app)/workout/[sessionId].tsx` (edited) — Added a single new import line (`import { sumLiveVolume } from "~/utils/volume-target";`) and one `useMemo` immediately after `const unit = useWeightUnit();` to derive `totalVolumeKg`. Wired `volumeKg={totalVolumeKg}` and `unit={unit}` to `<SessionHeader>` at the only call site. Did NOT re-import `useWeightUnit` (already at line 21) or `useMemo` (already at line 3), did NOT re-declare `unit` (already at line 79) — per MIN-1.
- `tests/unit/session-header-total-volume.test.ts` (new) — 16-test smoke suite for the four contracts called out by the design + MIN-2: (a) empty-state `0 kg`/`0 lbs`, (b) kg numeric render incl. dropset / draft / warmup kernel rules, (c) lbs conversion + en-US thousands separator, (d) the a11y label shape (`"Session total volume: <formatted>"`). Also pins a cross-screen parity contract: live header total == verdict screen total for the same set list (both consume `sumLiveVolume`, so divergence is impossible by construction). Follows the same kernel-level pattern as `tests/unit/profile-max-volume-window.test.ts` — vitest config restricts to `tests/unit/**/*.test.ts` (no `.tsx`) and there is no RNTL in the repo.
- `tests/e2e/session-total-volume-header.spec.ts` (new) — 5-case Playwright spec for live-screen header updates: (1) empty session reads `0 kg`, (2) seeded checked set reads the set's volume, (3) checking an unchecked draft via the UI advances the header, (4) editing the weight on a checked set re-renders the new total, (5) unchecking decrements back to `0 kg`. All assertions use `getByLabel(/^Session total volume: …$/)` (MIN-2) to dodge collisions with per-exercise `<VolumeTargetSlot>` strings. The locked-in `getByText("Elapsed", { exact: true })` selector is also re-asserted as a regression guard.

## Key decisions

- **Font size (MAJ-1)**: Adopted the validator's **option (a)** default — both metric numerals (`Elapsed` + `Volume`) render at `text-xl` instead of `text-2xl`. This guarantees fit on iPhone SE 320pt even for the worst-case 7-character lbs numeral with `1:23:45` elapsed + the Finish pressable, with zero Implementer-judgment branching. The pinned test selectors don't assert font size, so the visual demotion is non-breaking. **No 320pt simulator screenshot was taken in this Implementer pass** — pinning a real device baseline is left to the Tester since this agent cannot drive an iOS simulator. The validator's recommended Tester acceptance — "at 320pt width, `1:00:00` elapsed + `22,046 lbs` volume + Finish must not wrap or h-scroll" — should be the Tester's screenshot gate. Path stub for the Tester: `docs/runs/2026-05-23_1805_session-total-volume-header/screenshots/320pt-worst-case.png`.
- **A11y placement (MIN-3)**: Adopted **option (a)** — `accessibilityRole="text"` + `accessibilityLabel` go on the inner `<Text>` that renders the visible numeral. This matches the established `volume-target-slot.tsx:89-93` pattern and avoids the `accessible={true}` consolidation footgun on the outer `<View>`. The outer `<View>` carries no a11y props.
- **Imports (MIN-1, MIN-4)**: Only one new import line on the route file (`sumLiveVolume`). `useWeightUnit`, `useMemo`, and `unit` are reused from existing lines — no re-imports, no hedging.
- **Test surface (MIN-2)**: E2E spec asserts via `getByLabel(/^Session total volume: …$/)`. The same a11y label shape is also pinned in the unit suite as a string-level contract.
- **Kernel reuse**: No fork of `sumLiveVolume`. The live header and the verdict screen consume the same kernel over the same `["sets", sessionId]` cache → they agree on every digit by construction (test in `cross-screen parity`).

## Deviations from design

- **`text-2xl` → `text-xl` for both metric blocks**. Design said `text-2xl` with a fallback note for 320pt overflow; validator's MAJ-1 made the fallback non-negotiable and recommended option (a) by default. Adopted directly. The change is purely visual; no test selector or a11y label is affected.
- **Unit-test framework**. Design called for an RNTL render of `<SessionHeader>`. The repo has no RNTL installed and `vitest.config.ts` restricts `include` to `tests/unit/**/*.test.ts` (no `.tsx`). Followed the same kernel-level smoke pattern as `tests/unit/profile-max-volume-window.test.ts` (from the prior pipeline run) — verifies the same four behaviours through `sumLiveVolume` + `formatVolume` + the a11y-label template, deterministically and without a React tree. **No design item is left unverified**: the cases (a) empty-state, (b) kg, (c) lbs, (d) a11y label all have at least one assertion each, plus extra coverage of the F10 rule (drafts/warmups excluded, dropsets included) and a cross-screen parity check.
- **No 320pt baseline screenshot pinned in this pass**. As noted above — out of reach for a coding agent without a simulator. Tester to pin.

## Soft callbacks made (during this implementation pass)

None.

## Quality gates

- [x] `npm run typecheck` passed (clean)
- [x] `npm run lint` passed (0 errors, 1 pre-existing warning in `router.d.ts` — untouched by this change)
- [x] Relevant unit tests pass — `npm run test:unit` → 17 files, **284 tests passed** (16 new tests in `session-header-total-volume.test.ts`, all green; 0 regressions across the existing 268)
- [x] No new `any`
- [x] No new `// @ts-ignore`
- [x] No stray `console.log`
- [ ] E2E spec executed end-to-end — **NOT RUN in this pass**. The Playwright dev server (`localhost:8081`) is not running in this session. The spec passes `npx playwright test --list` (all 5 cases registered, no syntax errors). Tester to execute against the live dev server.

## Test command output (recorded)

```
$ npm run typecheck
> tsc --noEmit
(exit 0)

$ npm run lint
ESLint: 0 errors, 1 warnings in 1 files
═══════════════════════════════════════
Top files:
  router.d.ts (1 issues)
(exit 0)

$ npm run test:unit
 ✓ tests/unit/session-header-total-volume.test.ts (16 tests)
 ✓ tests/unit/profile-max-volume-window.test.ts (11 tests)
 ✓ tests/unit/units.test.ts (8 tests)
 ✓ ... (14 other suites)
 Test Files  17 passed (17)
      Tests  284 passed (284)

$ npx playwright test tests/e2e/session-total-volume-header.spec.ts --list
5 tests registered, no syntax errors
```

## Notes for Reviewer / Tester

- **Reviewer**: the only call site of `<SessionHeader>` is the live workout screen at `app/(app)/workout/[sessionId].tsx:401-405`. The two new props are required (no defaults) so any new call site would fail typecheck — guard against silent `0 kg` regressions per the design's rationale.
- **Reviewer**: the route's `useMemo([setsQ.data])` deliberately omits `unit` from the deps array. `unit` flows separately into `<SessionHeader>` as a prop, and the memoized value is in kg only. This matches verdict screen pattern at `verdict/[sessionId].tsx:53-56` and avoids a needless recompute when the user flips the unit toggle (the formatter at render time handles the conversion).
- **Tester**: pin a 320pt iPhone SE screenshot at `docs/runs/2026-05-23_1805_session-total-volume-header/screenshots/320pt-worst-case.png` with `~1:00:00` elapsed + a 5-digit lbs volume (~`22,046 lbs`) showing — should NOT wrap or horizontally scroll. If it does, MAJ-1 needs revisit (e.g., `text-base` or `numberOfLines={1}` + `adjustsFontSizeToFit`).
- **Tester**: the 5 e2e cases require the dev server up on `:8081` and `.env.local` with the Supabase service-role key (same as `volume-target.spec.ts` and `end-of-session-verdict.spec.ts`).
- **Tester**: the locked-in `getByText("Elapsed", { exact: true })` selector — used by 5 other e2e specs as a "live workout mounted" wait gate — was preserved verbatim. The 5 specs were not edited.
