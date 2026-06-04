# Final summary — 2026-06-03_2217_hard-sets-per-muscle

## Outcome
- **Feature**: A kg↔sets toggle on the Progress per-muscle chart adds a "hard sets per muscle per week" view alongside the existing weekly tonnage (the "augment" outcome of feature #3's dose-metric decision). A hard set = one `set_type === 'working'` row per (muscle, week), dropsets excluded, counted regardless of load/reps. Pure presenter + one section component + tests. NO migration, NO `stats.ts`/`WeeklyVolumeRow`/kernel change.
- **Pipeline result**: **shipped** — code pending commit + deploy at close. No DB change.
- **Branch / baseline**: `main`; baseline `80621ba` (clean working tree at start).

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | **yes** (Tester live: toggle swaps header/y-axis/peak; observed sets = working COUNT **3**, not tonnage 1,500 nor naive row count) |
| Human interventions during run | 1 (the 2-decision design batch: dropset counting + toggle-vs-second-chart) |
| Total round-trips | 0 re-loops (every gate passed round 1) |
| Design ↔ Validate rounds | 1 (GO) |
| Implement ↔ Review rounds | 1 (PASS) |
| Implement ↔ Test rounds | 1 (PASS) |
| Implementer soft-callbacks | 0 (budget 2/2 intact) |
| Wall-clock duration | ~01:03 (22:17 → 23:20 BRT) |
| Token cost | n/a |

## Quality gates (final)
- `npm run typecheck`: 0 errors. `npm run lint`: 0 errors / 1 pre-existing `router.d.ts` warning.
- `npx vitest run`: **515 / 515** (+10 over the 505 baseline) — 13 existing tonnage cases unedited & green (Invariant T); +9 hard-sets cases + 1 T-anchor deepEqual.
- **Teeth proof (T-3):** flipping the sets include-predicate to `() => true` turned the dropset-divergence assertions RED at BOTH unit (S-4) and e2e (test 6), then reverted (source MD5-identical) → the divergence test genuinely has teeth.
- e2e regression: **54/54 across 11 specs, 0 flaky**.
- Invariant T (tonnage byte-for-byte) and Invariant S (bodyweight working set counts; dropset excluded) both held dynamically.

## Key decisions (human-locked)
- **Dropset = count working sets only** (`set_type === 'working'`; dropset rows don't add a count) — cheap (set_type already on the row, no SELECT change) and dose-accurate. INTENTIONALLY diverges from tonnage on dropsets.
- **UI = kg↔sets segmented toggle on the ONE chart** (not a second chart); ephemeral, defaults to kg, shares per-muscle line-selection.
- The sets reduce does NOT inherit the tonnage `w>0 && r>0` guard — a bodyweight set (weight=0) IS a hard set.

## Design / engineering shape
- Extracted a shared `bucketByMuscleWeek` scaffold parameterized by a `RowMetric` (per-row INCLUDE-predicate + CONTRIBUTION + `needsLoad`). `presentWeeklyVolumeByMuscle` is now a thin wrapper (byte-for-byte tonnage); new sibling `presentWeeklyHardSetsByMuscle` (working-only, +1, `needsLoad:false`, signature omits `measurements` so the sets path can never touch bodyweight). Same `muscles[0]` attribution path for both → feature #2 (fractional secondary) will change ONE site.
- A `testID="weekly-muscle-peak"` "Peak N sets / Peak X kg" caption was added (Validator MAJ-1 fix-b) as a stable, non-SVG e2e handle that also doubles as informative UI.

## Files changed (4: 2 source, 2 tests)
`src/utils/weekly-muscle-volume.ts` (scaffold + both presenters), `src/components/weekly-muscle-volume-section.tsx` (toggle + peak caption + formatter/label swap), `tests/unit/weekly-muscle-volume.test.ts` (13 tonnage unchanged + 10 new), `tests/e2e/weekly-muscle-volume.spec.ts` (toggle + dropset-divergence cases).

## Validator/Reviewer findings resolved
- MAJ-1 (e2e teeth on SVG tick) → reframed to a stable `<Text>` peak caption + header anchor; teeth proven by the Tester.
- MIN-1 (kg absence target must include the suffix, "1,500 kg") → addressed.
- MIN-3 (dropset seed needs two `seedFinishedSession` calls in one week) → addressed.
- MIN-2/MIN-4 cosmetic (13 not 14 tests; deepEqual overlaps W-0) → acknowledged.
- Reviewer minors: kg-default assumption (Tester confirmed at runtime); uncheck-all "Peak 0" cosmetic (no crash).

## Notes / follow-ups
- Tester learning (retro): a standalone `dropset` seed row with `parent_set_id = NULL` violates the `sets_parent_matches_type` CHECK constraint — dropset seeds must link to a working set. (Test-only fix, no production impact.)
- **Open feature #2 — secondary-muscle fractional attribution** is still open; per the dose-metric memo + U6 here, its attribution must weight BOTH tonnage and the new hard-sets metric (they share the `muscles[0]` path today, so #2 lands in one place).
- Decision memo (the spec source): `SecondBrainground/personal/ada11/2026-06-03_2205_hard-sets-vs-tonnage-per-muscle-dose-metric.md`.
- iOS/Android not exercised (web-only e2e); pure-presenter + UI-toggle change, Risk LOW.

## Artifacts
- [`state.md`](./state.md) · [`discovery.md`](./discovery.md) · [`design-v1.md`](./design-v1.md) · [`validation-v1.md`](./validation-v1.md) · [`implementation.md`](./implementation.md) · [`review-v1.md`](./review-v1.md) · [`test-report-v1.md`](./test-report-v1.md) · [`transcript.md`](./transcript.md) · `retro.md` (owner)

## Bugs found post-merge (backfill within 7 days)
- (none yet)

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-06-03_2217_hard-sets-per-muscle/` on 2026-06-03 23:20 BRT.
