# Fix plan — 2026-05-21_2155_volume-math-wrong

## Scope

Two of the three reported items end up in this run:

1. **Weekly total — remove the "k" abbreviation entirely.** User feedback: "show the number properly, no abbreviation". The "k" shorthand is what made 26 210 kg render as "26.2k kg" and trigger the bug report.
2. **Volume to PR — folds into feature backlog item #6 (multi-metric strip).** Not implemented in this run; logged for the next feature pipeline run.
3. **Strong import set_number bug — separate run.** Add a new backlog item; do not fix here.

## Approach

Single-file change in the formatter (`formatVolume`) plus mechanical updates to the unit/e2e tests that asserted the old "k" output. The kernel is the canonical aggregate-volume formatter used by every screen that shows a volume readout — flipping it ripples cleanly to all surfaces (History headline, week-detail screen, Volume-to-PR strip, week-bar accessibility labels). No data, schema, or query changes; no cache invalidation needed because the data shape is unchanged.

Format spec: integer kg with thousands separator via `Intl.NumberFormat`. Locale fixed to `"en-US"` so devices in pt-BR don't render `"26.210 kg"` (which would re-introduce the same readability problem with a different mask).

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/utils/units.ts` | edited | `formatVolume` drops k-shorthand. Always `Math.round(value).toLocaleString("en-US")`. Doc comment updated to reflect the new contract. |
| `tests/unit/units.test.ts` | edited | Update expectations: `1,000 kg`, `12,400 kg`, `2,500 kg`, `1,000 kg` (rounded), `999 kg`, `1,102 lbs`. Rename two tests (`applies k-shorthand` → `renders thousands with a comma separator`; MIN-3 boundary → integer boundary). |
| `tests/e2e/week-drill-down.spec.ts` | edited | Replace `"2.5k kg"` with `"2,500 kg"` (line 196, comment line 222, regex line 225). |
| `tests/e2e/volume-target.spec.ts` | edited | Replace `"1.3k kg"` → `"1,300 kg"` (line 241), `"1.8k kg"` → `"1,800 kg"` (lines 345, 352, docblock lines 14-15). |
| `tests/e2e/weekly-volume-strip.spec.ts` | edited | Replace `"2.5k kg"` → `"2,500 kg"` (line 190 + comment), `"1.0k kg"` → `"1,000 kg"` (line 338 + comment). |

## Contratos de I/O

- **Function signatures / types added or changed**: none. `formatVolume(kg, unit)` retains the same `(number|null|undefined, WeightUnit) → string` signature.
- **DB columns / queries**: none.
- **UI props / state**: none.

## Riscos

- **Regressões em fluxos adjacentes**: every consumer of `formatVolume` will start showing the new format. Confirmed call sites: `weekly-volume-strip.tsx`, `volume-target-slot.tsx`, `history/week/[isoWeek].tsx`. All want the new format.
- **Data integrity**: zero — display-only.
- **Platform-specific**: `Intl.NumberFormat("en-US")` is available across Expo's RN runtime (iOS, Android) and web. Safe on all targets supported by this repo.
- **Performance**: `Intl.NumberFormat` allocates a Formatter under the hood per call. For the strip's bar count (~8 calls per render) this is well under one frame; not worth memoizing.

## Alternativas descartadas

1. **Add a threshold "k" only above 100k** — descartada: still allows ambiguity for the user's existing 4.9k / 26.2k range and re-introduces the same complaint at higher loads.
2. **Locale-aware separator (`toLocaleString()` with default locale)** — descartada: would render `"26.210 kg"` on pt-BR devices (period as thousands), bringing back exactly the read-mistake risk we are removing.
3. **Custom regex thousands insertion** — descartada: `Intl.NumberFormat` is the standard, RN-supported, and one-line.

## Out of scope (follow-up)

- Feature #6 (multi-metric strip — Max + Current Session + Volume to PR side by side). Folds the user's "Volume to PR seems wrong" concern into a UX redesign rather than a label tweak.
- Strong import `set_number = 1` fallback (`scripts/import-strong.ts:517-518`) + backfill of 46 affected `(session_id, exercise_id, set_number)` collision rows. Separate bug-fix run, queued per the user's decision.

## Regression test plan (preview — Regression Tester will execute)

- **Static gates**: `npm run typecheck`, `npm run lint`, `npm run test:unit`.
- **Replay original reproduction** from `repro.md`:
  - Open History tab — confirm headline reads `"26,210 kg"` (not `"26.2k kg"`).
  - Open a live workout with Bench Press / Squat — confirm strip reads `"Volume to PR: 4,900 kg"` (not `"4.9k kg"`), `"5,800 kg"` for Squat.
- **Adjacent regression checks**:
  - Week drill-down screen (`history/week/[isoWeek].tsx`) — Total volume + Avg per session show with commas.
  - Per-exercise progress page volume bars — still render (these use `formatWeight`, unchanged).
  - Measurements progress strip — `formatWeight`, unchanged; should not regress.
- **e2e**: re-run the three updated spec files.
- **Manual verification needed?** Yes — user reload of the app and quick visual check on the headline + a live workout strip; iOS Safari is the target environment.

## Confidence / Risk

- **Confiança**: ALTA — display-only change in a single formatter; all call sites mapped; tests updated to match.
- **Risco**: BAIXO — no DB writes, no API change, no state migration. Rollback is a one-file revert.

## Awaiting

Human approval before Implement phase. User has already approved the spec ("show the number properly, no abbreviation"); this fix-plan documents the exact contract and verification before code goes in.
