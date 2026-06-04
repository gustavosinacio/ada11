# Run: 2026-06-03_1402_bodyweight-leverage-factors

## Feature prompt
Bodyweight leverage factors — per-exercise fraction of bodyweight (push-up ≈ 0.64 BW, pull-up/dip ≈ 1.0 BW) instead of the full-BW approximation. (refines Phase 0)

## Baseline
- Branch: main
- baseline_branch: main
- Commit: 3c85c23e0c486fe601e5b21a2840db2950786806
- baseline_commit: 3c85c23e0c486fe601e5b21a2840db2950786806

> Working tree is clean at baseline except pre-existing unrelated screenshot
> PNG noise in OTHER runs' folders (and `docs/runs/2026-06-01_1301.../state.md`).
> Not part of this run.

## Current state
- Owner: conductor
- Step: 7. Finalize — COMPLETE (Evaluator scored 6 agents; archived to vault; README indexed; migration 0021 applied live; committed 417e256 + fac339a; deploy in progress)
- Round (current loop): n/a (D↔V 2 rounds; I↔R 1; I↔T 1)
- Status: done
- Started (BRT): 2026-06-03 14:02
- Updated (BRT): 2026-06-03 15:30

## Budgets remaining
- Design ↔ Validate rounds: 2 / 3 (round 1 consumed: v1 NO-GO — 2 majors)
- Implement ↔ Review rounds: 2 / 2
- Implement ↔ Test rounds: 2 / 2
- Implementer soft-callbacks: 2 / 2

## Artifacts produced
- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md (NO-GO — 0 blockers / 2 majors / 4 minors)
- [x] design-v2.md
- [x] validation-v2.md (GO — 0 blockers / 0 majors / 2 minors)
- [x] implementation.md (29 files; typecheck/lint clean; vitest 505/505; migration written not applied)
- [x] review-v1.md (PASS — 0 blockers / 0 majors / 2 minors)
- [x] test-report-v1.md (PASS — unit 505/505; live 512kg push-up; regression 52/52)
- [x] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Follow-up clarifications
- 2026-06-03 14:12 — Human resolved the 4 design/product decisions:
  - **U1 (storage)** → **NEW nullable `exercises.bodyweight_factor numeric` column** (migration 0021, mirrors 0014), backfilled on canonical bodyweight rows; NULL/non-finite ⇒ coalesce to **1.0** (NEVER 0). Id-keyed; rides `select("*")` on single-row sites; only `stats.ts` SELECT widens. NOT a code map.
  - **U2 (UI)** → **Backend-only**. No editable factor field on create/edit forms; no zod/API write-path change. Canonical defaults via backfill only.
  - **U3 (which exercises)** → **ALSO reclassify** the mis-tagged `equipment=null` bodyweight movements to `equipment='bodyweight'` in the SAME migration: **Pull Up, Chest Dip, Hanging Knee Raise** (currently count ZERO bodyweight volume). NOTE: this is a RETROACTIVE volume shift for those movements (like Phase 0) — design must call it out.
  - **U4 (values)** → Push-up **0.64**; Dip **1.0**; Chin-up **1.0**; Pull Up **1.0**; Chest Dip **1.0**; Hanging Leg Raise **0.50**; Hanging Knee Raise **0.50**. Factor scales ONLY the bodyweight component; addedLoad (belt/vest) NEVER scaled.
- Adopt Discovery's HIGH-confidence defaults for the rest: U4-seam `bw*factor + addedLoad`; U5 NULL/non-finite⇒1.0; U6 `effectiveWeightKg` gains optional 4th param `factor?: number | null` (absent⇒1.0); U7 widen `stats.ts` SELECT + `WeeklyVolumeRow` type; U8 parallel `factorByExerciseId` map for the `volume-target.ts` MAP-fed sites; U9 e1RM regression guard (factor must NOT touch `epley1RM` paths).
- IMPORTANT for Implementer/migration: match the 7 canonical rows by EXACT name verified against the live catalog (naming is inconsistent — "Chin-up" hyphen vs "Pull Up" space); prefer id or exact-string match, idempotent `WHERE user_id IS NULL AND deleted_at IS NULL`.

## Decisions / events log
- 2026-06-03 14:02 — Conductor: run scaffolded; baseline 3c85c23 (clean); Discovery invoked. Sibling open feature #3 (dose-metric revisit) parked as future research memo per human; #2 (secondary-muscle) deferred until this ships.
