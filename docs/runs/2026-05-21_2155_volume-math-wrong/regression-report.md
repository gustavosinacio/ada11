# Regression report — 2026-05-21_2155_volume-math-wrong

## Environment

- Build: local dev (no deploy)
- Test data: production data accessed read-only via service role for diagnostic; no writes anywhere.

## Automated checks

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **pass** (clean, no diagnostics) |
| Lint | `npm run lint` | **pass** (0 errors; 1 pre-existing warning in `router.d.ts`, unrelated) |
| Unit tests | `npm run test:unit` | **87 / 87 pass** (8 in `units.test.ts`, including new 26,210-kg case) |
| Web export build | `npx expo export --platform web` | not run (display-only change; previous shipping commit already exports cleanly) |

## Replay of original reproduction

**Steps from `repro.md`**:

1. Open History tab.
2. Observe "THIS WEEK" headline.

**Before this run**: `"26.2k kg"` (matched DB sum 26,210 but used the k abbreviation that triggered the bug report).

**After this run** (code-level): `formatVolume(26210, "kg")` returns `"26,210 kg"`. Confirmed by `units.test.ts` case `expect(formatVolume(26210, "kg")).toBe("26,210 kg")` passing.

For Symptom B (Volume to PR strip): the strip uses `formatVolume(state.gapKg, unit)` at `src/components/volume-target-slot.tsx:51` — same kernel — so the displayed format flips identically. Numeric value will be unchanged; only the rendering does.

**Result**: bug no longer reproduces at the code level. Final user-facing confirmation requires a manual reload.

**Evidence**:

```
$ npm run test:unit | tail -10
 ✓ tests/unit/units.test.ts (8 tests) 36ms
 Test Files  8 passed (8)
      Tests  87 passed (87)
```

## Adjacent regression checks

- **`formatWeight` (per-set readouts)**: pass — explicit unit test `"does NOT affect existing formatWeight (regression check)"` still green.
- **`computeVolumeTarget` kernel**: pass — `volume-target.test.ts` (13 tests) still green; no kernel change.
- **Weekly bucketing**: pass — `weekly-volume-bucketing.test.ts` (7 tests) still green; no change to bucketing logic.
- **Measurements / Length formatters**: pass — `measurements-units.test.ts` (11 tests) still green; not touched.

## Manual verification checklist (for the user before next deploy)

1. Reload `ada11.expo.app` on iPhone Safari, sign in.
2. Open History tab → confirm headline reads `"26,210 kg"` (or current week's actual value formatted similarly), NOT `"26.2k kg"`.
3. Start a live workout, add Bench Press → confirm strip reads `"Volume to PR: 4,900 kg"` (format with comma), not `"4.9k kg"`.
4. Tap a weekly bar → drill-down screen Total volume and Avg per session rows should also show comma format.
5. Visit Exercises → tap an exercise with history → confirm the progress page still renders (uses `formatWeight`, unchanged).

## Code-level confirmation

| File | Before | After |
|---|---|---|
| `src/utils/units.ts:42-46` | `if (rounded >= 1000) return \`${(value/1000).toFixed(1)}k ${unit}\`; return \`${rounded} ${unit}\`;` | `return \`${Math.round(value).toLocaleString("en-US")} ${unit}\`;` |
| `tests/unit/units.test.ts:23-32` | Asserted `"1.0k kg"`, `"12.4k kg"`, `"2.5k kg"`, `"1.0k kg"` for boundary | Asserts `"1,000 kg"`, `"12,400 kg"`, `"2,500 kg"`, `"26,210 kg"`, `"1,000 kg"` for boundary |
| `tests/e2e/{week-drill-down,weekly-volume-strip,volume-target}.spec.ts` | `"2.5k kg"`, `"1.0k kg"`, `"1.3k kg"`, `"1.8k kg"` literal assertions + comments + one regex | `"2,500 kg"`, `"1,000 kg"`, `"1,300 kg"`, `"1,800 kg"` |

## Out-of-scope confirmation

- Feature #6 (multi-metric strip — Max + Current Session + Volume to PR) — not touched in this run; lives in `docs/features.md` as the user's open backlog item, untouched.
- `scripts/import-strong.ts:517-518` `set_number` fallback — not touched in this run; added to `docs/features.md` as a new backlog item per user's "queue it" decision.

## Decision

**pass**

Reasoning: All automated gates green; the kernel change is one line and verified by both the existing tests and a new 26,210-kg case that mirrors the user's real bug report. The e2e suite was updated mechanically and was not executed locally — recommend a quick `npm run test:e2e` before deploying to catch any selector that depended on the old format beyond the four files updated. Manual visual verification by the user is the final gate.
