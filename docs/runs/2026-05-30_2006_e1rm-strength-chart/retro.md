# Retro — 2026-05-30_2006_e1rm-strength-chart (Phase 2a e1RM strength chart)

Pipeline: feature. Outcome: **shipped** (Tester PASS on the final round; all static gates green).
Process: 0 human interventions, 0 soft-callbacks, D↔V 1 round (GO), I↔R 1 round (PASS), I↔T 2 rounds (round 1 FAIL test-only, round 2 PASS).

## Headline scores

| Agent | Score | One-line |
|---|---|---|
| Discovery | 6/6 | Applied the carry-in close-the-set lesson by construction; proved e1RM is exactly 2 sites (already centralized) so the "missed inline copy" class did NOT recur; corrected the prompt's catalog claim. |
| Designer | 6/6 | First-round GO. LOCF-not-zero-fill (a 0 is false for a peak metric), eligibility-before-ranking (no slot starvation), explicit "What is NOT in this algorithm" guard. v1-needs-revision pattern BROKEN. |
| Validator | 5/5 | GO round 1 (0 BLK, 1 MAJ, 4 MIN); verified all 3 hardest items against source; caught a real e2e false-green risk (MAJ-1) and classified it correctly as GO-with-must-fix. Applied its own carry-in lesson (probe-or-upgrade, never soften). |
| Implementer | 6/6 | Gates green first pass (444/444); handled MAJ-1 with the StreakCard anchor; PROACTIVELY dodged last run's exact seed-source trap (canonical catalog vs per-user seed) by applying its own feedback. 2 justified deviations. |
| Reviewer | 5/5 | PASS round 1 (0/0/2); re-ran gates; independently re-traced the LOCF index-0 edge; verified MAJ-1 anchor has teeth; applied the prior entry's recommended "seed-row-realness" hand-off (T-1) + flagged "asserts legend not line" (T-2). |
| Tester | 5/5 | Round 1 FAIL was a narrow, REAL feature-interaction regression — proven via stash-to-baseline (reproduced 2×), root-caused, one-line fix pre-verified. Round 2 PASS, ran the corrected spec itself. Closed the Reviewer's T-2 with a runtime SVG-polyline probe. |

No agent scored below 5/5 this run — the highest aggregate of any run to date. This is NOT score inflation: every score is backed by file:line evidence, the rubric still has genuine fail-able criteria, and the run genuinely executed cleanly with a single, narrow, correctly-handled test-only fallout.

## What went right (the system working)

1. **Both carry-in lessons from the prior run (bodyweight-volume) demonstrably paid off.**
   - *Lesson 1 — exhaustive close-the-set inventory.* Discovery ran three orthogonal greps (the `epley1RM` symbol, inline Epley arithmetic, alternate formula names), produced a hit→row table, and wrote an explicit "no N+1th site exists" verdict — AT Discovery, not three agents later. The result was correct: e1RM was centralized into `epley1RM` from day one (exactly 2 sites), so the "missed inline copy" failure class that drove last run's no-go round simply did not materialize. The Conductor independently re-grepped and agreed. The lesson didn't just inform the work — it changed the failure surface.
   - *Lesson 2 — canonical-source-of-truth for e2e seed names.* The Implementer's round-1 fail last run was seeding `pickCanonicalExercise(admin, "Pull-up")` against the wrong source (the per-user trigger seed). This run, BEFORE authoring, the Implementer diagnosed that the helper queries the `user_id IS NULL` canonical catalog (`0011`/`0014`), recognized the design's cited `0001` was the wrong source, and — sandbox-blocked from a live probe — verified names against the currently-green suite. The Tester's live-catalog probe later confirmed Bench/Squat/Chin-up resolve and Pull-up is MISSING. The exact failure was PRE-EMPTED, not recovered from.

2. **Two named multi-run fail patterns broke this run.** Discovery's "search thorough-looking but not exhaustive-by-construction" (2-run fail) and the Designer's "v1-needs-revision" (4-run fail) both resolved — the latter because the Designer pre-applied the v2-recovery disciplines (named invariants + "What is NOT" guard + mirror-then-diverge structure) in v1. The recurring-pattern-check + lessons-for-next-run loop is now demonstrably driving cross-run learning across multiple agents, not just one.

3. **The gates caught the one real fallout and contained it.** The round-1 Tester FAIL was a genuine feature-interaction regression (the new e1RM legend chip rebound an existing fragile `getByText(name).first()` locator in `progress-page.spec.ts`). It was proven (stash-to-baseline, 2× reproduce), correctly attributed to the adjacent TEST's loose locator (not the feature), and fixed in one line per the file's own sibling precedent. The pipeline did exactly what it should: ship a correct feature while surfacing and fixing a narrow collateral break.

## Systemic lesson worth surfacing to the playbook / Discovery

**A new Progress-page section that surfaces an entity name in a legend can break sibling tests' loose `getByText(name).first()` locators — pre-audit adjacent specs before adding such a section.**

The round-1 regression was deterministic and DOM-order-driven: `<E1rmStrengthSection>` renders the exercise name in a "Toggle <name>" legend chip EARLIER in the DOM than the navigable `<ExercisesThisWeekList>` row, so `progress-page.spec.ts:278`'s bare-text `.first()` rebound to the non-navigable chip. The robust sibling (test #8) was unaffected because it uses a role+accessible-name locator. This is a recurring *class* (the prior run also surfaced fragile-locator fallout, in a different form), and it is cheap to pre-empt:

- **Recommendation (Discovery contract):** when the feature adds a section that renders an entity name (exercise, muscle, routine) that is ALSO used as an e2e locator elsewhere on the same screen, add a "locator collision audit" line — grep the adjacent specs for bare `getByText(<entityName>).first()` and flag them as at-risk so the Designer's e2e plan (or the Implementer) tightens them pre-emptively rather than after a Tester FAIL.
- This would have converted a round-1 FAIL + a round-2 confirming round into a zero-round non-event. Cost: one grep at Discovery time. Benefit: one fewer I↔T round on any chart/section-adding feature.

A second, smaller systemic note (already partially in the Reviewer's feedback): **chart/visualization e2e tests should assert the data-bearing rendered element (polyline/path/bars), not just the legend/controls.** The shipped positive cases asserted the legend chip + toggle but not the SVG line; the Reviewer flagged this (T-2) and the Tester closed it with a runtime polyline probe. Worth codifying: "for a chart feature, the golden-path e2e must assert the rendered series geometry, not only the selection UI."

## Pipeline integrity

- Baseline `3c00d8e02ac15eedf2dcd42e1b06909fef7c669a` present and resolves (`git rev-parse --verify`).
- All required feature-pipeline artifacts present (discovery, design-v1, validation-v1, implementation, review-v1, test-report-v1, test-report-v2, final-summary).
- Audit trail clean: 0 `peer_invocation:` blocks in `transcript.md`; every entry is `Conductor → Agent`; no unlogged peer invocations found in any artifact. Playbook hard rule held.
- Write boundaries: all 6 agents clean. Notably `docs/features.md` did NOT appear in this run's baseline diff (no Conductor-finalize-edit attribution judgment needed this run). The other-run screenshot PNGs in the diff are pre-existing prior-run noise.
- `pipeline_integrity_warnings = 0`.

## Watch-items for the next run
- Keep the close-the-set discipline at Discovery and the canonical-source-of-truth check at the Implementer — both resolved a multi-run fail this run; the risk is regression once the lessons scroll down the feedback files.
- The locator-collision class above is the one un-addressed systemic gap; pre-audit it on the next section-adding feature.
- Dev-server OOM cascade has now been quiet for 2 consecutive runs (bodyweight-volume + this run) after a 3-run streak — keep watching; do not assume it is permanently resolved.
