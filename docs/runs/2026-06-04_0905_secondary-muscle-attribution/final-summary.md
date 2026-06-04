# Final summary — 2026-06-04_0905_secondary-muscle-attribution

## Outcome
- **Feature**: Secondary-muscle fractional volume attribution (bench → partial Arms/Shoulders) instead of primary-only `muscles[0]`.
- **Pipeline result**: **deferred** by owner at the Discovery escalation, before Design. No code, no migration, no deploy.
- **Branch / baseline**: `main`; baseline `e098314` (clean).

## Why we stopped
Discovery (HIGH confidence, verified against the live catalog, project `ykrbgpctbfvndxjnpzrg`) found the feature's premise is **data-falsified**: `exercises.muscles` is single-muscle for **81 of 95** canonical rows (`Bench Press → ['Chest']`), so the secondaries the feature wants to credit **do not exist in the data**, and `muscles[0]` is not reliably the primary (`Squat → ['Lower back','Legs']`). Therefore the feature is fundamentally a **data-authoring task** — defining, per exercise, which secondary muscles it hits and the fraction split (summing to 1.0) — an owner/domain judgment with no clean literature consensus, plus a semantically-odd "fractional hard set" question. Presented to the owner; owner chose to **defer** (all three decision questions → defer).

## What the run produced (kept for whenever this is revisited)
- **The mechanism is cheap and located**: a SINGLE attribution seam in `bucketByMuscleWeek` (`src/utils/weekly-muscle-volume.ts:149-170`). One ~3-line change (`for (muscle, fraction) of weights: values[muscle] += contribution * fraction`) makes BOTH the tonnage AND hard-sets per-muscle metrics fractional — the shared scaffold (built by the hard-sets run) was designed for exactly this.
- **The hard part is the data**, not the code. Realistic options when revisited: (b) a new `exercises.muscle_weights jsonb` column + backfill migration, or (c) a hardcoded code table — NOT deriving from `muscles[]` (it lacks secondaries). Fraction VALUES are an owner decision; weights must sum to 1.0; single-muscle = 1.0 = today (identity).
- **Open sub-decisions documented** in `discovery.md` (U1–U9): storage, fraction values, fractional-hard-sets semantics (recommend tonnage-only), `muscles[0]`-not-primary re-ordering, no editable UI needed yet (0 user-owned exercises), exercises-this-week list grouping out of scope, unconditional-vs-flag, epsilon-drop.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | n/a — deferred before Design |
| Human interventions during run | 1 (the defer decision at the Discovery escalation) |
| Total round-trips | 0 |
| Design ↔ Validate rounds | 0 |
| Implement ↔ Review rounds | 0 |
| Implement ↔ Test rounds | 0 |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~00:09 (09:05 → 09:14 BRT) |
| Token cost | n/a |

## Disposition
- `docs/features.md` #2 stays **OPEN**, annotated with this finding + the single-seam location, so a future attempt starts from "author the muscle-fraction model" rather than re-discovering the data gap.

## Artifacts
- [`state.md`](./state.md) · [`discovery.md`](./discovery.md) · [`transcript.md`](./transcript.md) · `retro.md` (owner, optional for a deferred run)
- (no design/validation/implementation/review/test artifacts — deferred before Design)

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-06-04_0905_secondary-muscle-attribution/` on 2026-06-04 09:14 BRT.
