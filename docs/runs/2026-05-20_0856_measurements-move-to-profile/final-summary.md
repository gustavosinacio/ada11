# Final summary — 2026-05-20_0856_measurements-move-to-profile

## Outcome
- **Feature**: Move Measurements from the bottom tab bar into a Profile entry-point button. Tab bar goes from 5 → 4 tabs. `/measurements` URL stays resolvable. Mirrors the F1 Strong-unify hide-tab pattern (`href: null`).
- **Pipeline result**: **shipped** (single-pass D↔V, I↔R, I↔T; all gates green incl. 16/16 e2e on touched specs).
- **Baseline commit**: `7d494dd`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (web; Playwright 16/16 on touched specs) |
| Human interventions | 0 |
| Total round-trips | 0 (single-pass through every loop) |
| Design ↔ Validate rounds | 1 (`go` first pass) |
| Implement ↔ Review rounds | 1 (`pass` first pass) |
| Implement ↔ Test rounds | 1 (`pass` first pass) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~41 min (08:56 → 09:37 BRT) |

## What shipped (4 files)

- **EDIT** `app/(app)/_layout.tsx` — Measurements `<Tabs.Screen>` now has `options={{ href: null }}` (mirror of Routines pattern). `Ruler` import dropped.
- **EDIT** `app/(app)/profile.tsx` — added `useRouter` + `Ruler` imports; inserted a single-row bordered Pressable between Preferences and About sections (Ruler icon + "Measurements" label + ChevronRight; `accessibilityLabel="Measurements"`).
- **EDIT** `tests/e2e/measurements.spec.ts` — `goToMeasurements` helper rewritten to drive Profile → Measurements row; tab-count regression test renamed to "4 tabs render" with negative assertions for both Routines and Measurements; positive `getByLabel("Measurements")` assertion added after the Profile click for the new row.
- **EDIT** `tests/e2e/probe-strong-unify.spec.ts` — 5-tab IA test rewritten as 4-tab IA; Measurements arm of banner-across-tabs test dropped (no longer a tab transition).

## Decisions
1. **Hide-tab pattern** = `<Tabs.Screen name="measurements" options={{ href: null }} />`. Same as Routines.
2. **Entry-point shape** = bordered single-row Pressable (no new component). Visual treatment mirrors existing Profile cards.
3. **Placement** = between Preferences and About.
4. **`measurements/index.tsx` stays as the list/history screen** — explicit divergence from the Routines pattern (which became a `<Redirect>`).
5. **No section header** above the new card (design intent; single row doesn't justify a "Tracking" group).
6. **Web bookmarks** of `/measurements` keep working (no redirect).

## Validator-caught issues (all addressed in implementation)
- MIN-1: tab-count test's negative `Measurements not.toBeVisible()` placed BEFORE the Profile click.
- MIN-2: helper uses `getByLabel("Measurements")` (not `getByRole`) — matches project convention.
- MIN-3: `waitForURL(/\/profile/)` between Profile click and Measurements row click.
- MIN-4: Measurements arm dropped from banner-across-tabs probe.
- MIN-5: no section header above the new card (design intent).

## Known-debt (non-gating)
- 3 Reviewer cosmetic minors: icon `size={20}` vs `<Row>` helper's `size={18}`; card `mb-6` vs `mb-8` of neighbors; negative-assertion not scoped to tab-bar region.
- Pre-existing `tests/e2e/crud.spec.ts:131,150` failure (stale `getByPlaceholder("e.g. Chest")` since `MuscleGroupPicker` refactor at `b51dd01`) — unrelated to this run.
- `tests/e2e/weekly-volume-strip.spec.ts:230` cold-bundle flake — passes in isolation; not introduced by this run.

## Why we stopped
- Feature complete. Cleanest run pattern: single-pass through every loop.

## Artifacts
- discovery.md, design-v1.md, validation-v1.md
- implementation.md, review-v1.md, test-report-v1.md
- state.md, transcript.md, final-summary.md
- retro.md (post-run, owner)

## Notes for the owner
- **Working tree uncommitted.** Suggested split: `feat(profile): move Measurements off the tab bar into a Profile entry-point` + `docs(pipeline): archive measurements-move-to-profile run`.
- **No migration / no API change.** IA + UI only.
- **All `docs/features.md` items are now addressed** (the new item is the 6th feature shipped tonight).

## Archive
- To archive: `cp -r docs/runs/2026-05-20_0856_measurements-move-to-profile "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-20_0856_measurements-move-to-profile"` + vault README entry.
