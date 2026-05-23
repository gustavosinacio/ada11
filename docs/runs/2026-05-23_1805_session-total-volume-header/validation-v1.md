# Validation v1 — 2026-05-23_1805_session-total-volume-header

Round: Design↔Validate round 1 of ≤3.
Reviewing: `design-v1.md`.

## Verification (10 Conductor checks)

| # | Check | Result |
|---|---|---|
| 1 | `sumLiveVolume` signature + predicate (`completed_at != null` ∧ non-warmup ∧ `weight>0` ∧ `reps>0`, dropsets in) | VERIFIED at `src/utils/volume-target.ts:88-100`. |
| 2 | `<SessionHeader>` presentational; only call site `app/(app)/workout/[sessionId].tsx:401-405`; adding props safe | VERIFIED at `src/components/session-header.tsx:1-50`. |
| 3 | `useSetsForSession` returns `SetRow[]` matching `sumLiveVolume` input | VERIFIED at `src/hooks/use-sets.ts:36-42` + `src/api/sets.ts:43`. |
| 4 | `formatVolume(kg, unit)` pure + `useWeightUnit` "kg" fallback | VERIFIED at `src/utils/units.ts:33-40` + `src/hooks/use-preferences.ts:24-27`. |
| 5 | 5 locked e2e selectors preserved — no second `"Elapsed"` introduced | VERIFIED — design preserves literal + DOM order. |
| 6 | Layout at 320pt | **AT RISK** — see MAJ-1. |
| 7 | `useMemo` deps | OK — `[setsQ.data]` is sufficient for kg; `unit` flows separately to `<SessionHeader>`. |
| 8 | Cross-screen consistency live↔verdict | VERIFIED — both screens read `["sets", sessionId]`; `useFinishSession` does NOT mutate the sets cache. Numbers match by construction. |
| 9 | A11y label uniqueness — `Session total volume: …` | VERIFIED — grep returned no clashing label. |
| 10 | Out-of-scope discipline — verdict/history/per-exercise strip untouched | VERIFIED at design lines 86-96. |

## Findings

### Blockers
None.

### Majors

- **MAJ-1 — iPhone SE 320pt overflow risk is real; fallback is not pinned.**
  Designer's own envelope estimates the post-change row at ~316pt of 320pt for the typical 5-digit kg case. Realistic edges blow past 320pt:
  - Long-session lbs: elapsed `1:23:45` (~7 chars text-2xl) + `Volume` label + numeral `"27,210 lbs"` (10 chars) + Finish pressable.
  - High-volume lbs: `"143,200 lbs"` (11 chars).
  Design defers to "Implementer judgment" but no acceptance criterion is pinned. **Fix during Implementer round** with one of:
  - (a) Default both metric blocks to `text-xl` from the start.
  - (b) Add a Tester acceptance check: at 320pt width, `1:00:00` elapsed + `22,046 lbs` volume + Finish must not wrap or h-scroll. Pin a screenshot path.
  - (c) `numberOfLines={1}` + `adjustsFontSizeToFit` on the volume numeral.

### Minors

- **MIN-1 — `useWeightUnit` and `useMemo` are already imported; `unit` already declared at `app/(app)/workout/[sessionId].tsx:21,79,3`.** Design's "add these imports" instruction would produce duplicate-import warnings or duplicate-identifier errors if literally followed. Implementer must NOT re-import or re-declare.

- **MIN-2 — `getByText("1,000 kg")` is selector-fragile.** Per-exercise `<VolumeTargetSlot>` (`src/components/volume-target-slot.tsx:88-117`) renders the numeral in a nested `<Text>` whose leaf text is exactly `"X kg"` (multi-metric-strip precedent). Single-exercise sessions guarantee header total == per-exercise Now == same string → Playwright strict-mode match fails. **Tester must use `getByLabelText(/^Session total volume: 1,000 kg/)`** instead.

- **MIN-3 — A11y label placement.** Design puts `accessibilityLabel` + `accessibilityRole="text"` on the outer `<View>`. Established pattern in `volume-target-slot.tsx:89-93` puts both on the visible `<Text>`. RN native may not consolidate child reads without `accessible={true}` on the `<View>`. Implementer must either (a) wrap label+numeral in a single `<Text>` and a11y on that, or (b) keep the `<View>` and set `accessible={true}` on it.

- **MIN-4 — Drop the conditional "if not already present" for `useMemo`.** `useMemo` is already imported at `[sessionId].tsx:3`. State the fact, don't hedge.

## Decision

**go** (with MAJ-1 as known debt to resolve at Implement time).

Counts: blockers=0, majors=1, minors=4.

Confidence: HIGH on items 1-5, 7-10. MEDIUM on MAJ-1 (back-of-envelope width estimate; needs Implementer's 320pt screenshot to confirm or refute deterministically).
Risk if shipped as-is: LOW for typical kg user; MEDIUM for lbs power users without the MAJ-1 fix.

## Recommendation
**Invoke Implementer** with the hand-off notes baked into MAJ-1 fix selection, MIN-1 import skip, MIN-2 selector swap, MIN-3 a11y placement, MIN-4 drop hedging.
