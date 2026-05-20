# Final summary — 2026-05-20_0334_volume-strip-drill-down

## Outcome
- **Feature**: Item #4 from `docs/features.md` — weekly volume strip bars become tappable; each opens a per-week detail screen (`/(app)/history/week/[isoWeek]`) with stat sheet (volume, sessions count, avg per session) and filtered SessionSummaryRow list.
- **Pipeline result**: **shipped** (typecheck/lint/51 unit/5 new e2e + 3 adjacent specs all green).
- **Baseline commit**: `699dfee`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (web; Playwright 5/5 new tests) |
| Human interventions | 0 |
| Total round-trips | 1 (single-pass D↔V, I↔R, I↔T) |
| Design ↔ Validate rounds | 1 (`go` with 1 MAJOR folded into Implementer) |
| Implement ↔ Review rounds | 1 (`pass`, 3 cosmetic minors not gating) |
| Implement ↔ Test rounds | 1 (`pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~33 min (03:34 → 04:07 BRT) |

## What shipped

- **EDIT** `src/components/weekly-volume-strip.tsx` — merged bar+label rows into per-column `<Pressable>`s. Outer wrapper `mt-4 flex-row gap-1.5` (no `items-end`, no `h-24`). `marginTop: PLOT_HEIGHT - h` baseline trick preserves pixel-identical visual. Added `start: Date` to local `Bucket` type so the tap handler can build the URL via `format(b.start, "yyyy-MM-dd")`. `active:opacity-70` Pressable feedback, `accessibilityLabel="View week of {label}"`, `accessibilityRole="button"`.
- **NEW** `app/(app)/history/week/[isoWeek].tsx` — 5-branch view screen (invalid / outside-window / loading / error / data). MAJOR-1 guard against `lastNIsoWeeks(8).map(w=>w.key)`. Stat sheet (Total volume, Sessions, Avg per session) via local `Section` + `MetricRow` mirroring `measurements/[id]/index.tsx`. Sessions list reuses `<SessionSummaryRow>` verbatim. `<Stack.Screen>` mounted in every branch via `screenHeader` const.
- **NEW** `tests/e2e/week-drill-down.spec.ts` — 5 tests (golden / empty-week / outside-window / invalid / in-progress). All pass.

## Decisions locked in
1. **Route shape**: `app/(app)/history/week/[isoWeek].tsx` with URL segment = `YYYY-MM-DD` Monday.
2. **View shape**: B+A hybrid (stat sheet + filtered session list).
3. **Touch target**: whole column (bar + label) wrapped in `<Pressable>`.
4. **Empty-week tappability**: always-tap.
5. **In-progress sessions**: included in the list (with orange chip via `<SessionSummaryRow>`); EXCLUDED from headline volume (kernel filter `ended_at IS NOT NULL`).
6. **Headline kernel**: byte-identical to strip kernel → strip bar number ALWAYS matches week screen's Total volume.
7. **No new server query** — `useSessions()` + `useWeeklyVolume()` already cover both data needs.
8. **`weekKeyFromMonday` helper dropped** — `weekKeyOf(monday)` is idempotent.

## Bugs caught and fixed
- **MAJOR-1 (Validator → Implementer fold-in)**: deep-link to a week outside the rolling 8-week window would have rendered `0 kg` headline while still showing sessions in the list (cache-vs-data divergence). Fixed pre-emptively with an in-window guard + "outside visible range" empty state.

## Known-debt (non-gating)
- 3 Reviewer minors:
  - Tampered/non-Monday URLs render a header date one day off; fix is 2-line `isoWeekStart(d)` snap.
  - Body header uses ms-arithmetic for Sunday; should use `endOfWeek` for DST safety in non-BRT locales.
  - One comment has a line-number reference that will rot.

## Why we stopped
- Feature complete. All gates green. Cleanest run yet — single-pass through all three I/R/T loops.

## Artifacts
- discovery.md, design-v1.md, validation-v1.md
- implementation.md, review-v1.md, test-report-v1.md
- state.md, transcript.md, final-summary.md
- screenshots/{drill-down-golden,drill-down-empty,drill-down-outside-window,drill-down-invalid,drill-down-in-progress}.png
- retro.md (post-run, owner)

## Notes for the owner
- **Working tree uncommitted.** Suggested split: `feat(history): tap a weekly volume bar to drill into the week + new screen` + `test(e2e): add week-drill-down regression suite` + `docs(pipeline): archive run`.
- **No migration needed.** Code only.
- **Backlog after this:** 1 feature remaining — #1 Strong-style workout/routines unification (largest).

## Archive
- To archive: `cp -r docs/runs/2026-05-20_0334_volume-strip-drill-down "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-20_0334_volume-strip-drill-down"` + vault README entry.
