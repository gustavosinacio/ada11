# Retro — 2026-05-25_0933_soft-deleted-session-volume-leak

## Outcome
- **Bug**: Soft-deleted sessions still contributed to weekly volume + every other surface that reads through `listWeeklyVolumeRows`, `listSetsForExercise`, `getLastWorkingSetForExercise`. Root cause: three `sets`↔`sessions!inner` SELECTs filtered on `sets.deleted_at` but NOT on `sessions.deleted_at`. Plus 1 missing `["progress"]` cache invalidation in `useSoftDeleteSession.onSuccess`.
- **Pipeline result**: **shipped** (clean — single-pass through every phase, 0 redirects, 0 retries).
- **Final commit**: pending (will be set on commit)

## Metrics

| Metric | Value |
|---|---|
| Bug reproduces post-fix? | no |
| Bugs found post-merge (7 days) | (backfill) |
| Human interventions during run | 1 (Fix Designer approval gate; user chose "approve without folding Defect B") |
| Implement ↔ Regression rounds | 1 (pass first try) |
| Diagnose redirects | 0 |
| Wall-clock duration | ~54 min (09:33 → 10:27 BRT) |
| Token cost | n/a |

## What worked
- **Conductor pre-diagnosis paid off**. Reproducer + Diagnostician each independently confirmed the three SELECT call sites in <10 minutes. Pre-diagnosis didn't replace the pipeline — it accelerated each phase by giving each agent a sharp hypothesis to verify, not the answer.
- **Diagnostician's defect-folding judgment**: surfaced Defect A as in-scope (same user-visible bug class — `useSoftDeleteSession` missing `["progress"]` invalidation) and Defect B as deferred (different mutation paths, different user journey). Right call — Defect B would have inflated test surface without sharing the bug's user-visible symptom.
- **Visual evidence discipline**: Reproducer captured 6 screenshots PRE-fix; Regression Tester captured 3 POST-fix; side-by-side comparison made the fix's correctness obvious to the human. The two "smoking gun" frames (`03-progress-after-delete.png` pre, `07-history-survivor-after-delete-POSTFIX.png` post) were load-bearing.
- **Full e2e matrix mandate** (despite Diagnostician's LOW cascade prediction) surfaced 3 NEW pre-existing flakes worth adding to the known-flake inventory.
- **Sibling-pattern proof for Defect A**: `useFinishSession.onSuccess` already invalidates `["progress"]` — established precedent meant the fix shape was self-evident, no design debate.

## What was friction
- **PostgREST embedded `.is(...)` syntax** initially flagged as a risk by Fix Designer (might not compile against the pinned supabase-js version). Implementer verified it works cleanly — but the worry cost ~5 min of fallback planning that turned out unnecessary. Adding a canonical example of embedded-resource filters in `docs/data-model.md` would save this round-trip on future runs.
- **Variant B race in the new spec** — first invocation had a 1-2s timing race between admin soft-delete commit visibility and the post-reload React Query fetch. Recurred 0/3 in subsequent runs but is exactly the kind of cache-priming hazard F9 already hit. Documented in regression-report.md "Caveats".
- **3 new pre-existing flakes surfaced** — the known-pre-existing inventory was 4 flakes (post-Finish URL regex stale since verdict-screen feature); we now know it's 7. Worth a dedicated stabilisation pass.

## Prompt / schema adjustments to fold back
- Add embedded-resource-filter example snippet to `docs/data-model.md` so future Fix Designers don't pre-emptively plan fallbacks for `.is("sessions.deleted_at", null)` style.
- Reproducer template should ALWAYS include a "smoking gun" screenshot for UI bugs — formalize via a checklist item rather than an implicit norm.
- Regression Tester's "verify pre-existing via baseline stash replay" was load-bearing and well-executed; consider promoting from soft-norm to playbook-explicit checklist item.

## Was the pipeline overhead worth it for this fix?
**Yes** — even though the Conductor had the root cause before invoking the pipeline. Three payoffs justified the overhead:
1. **Defect A discovery + scope-folding**: a naive direct fix would have shipped only the 3 SELECT changes and left the warm-cache leak. The Reproducer's "two extra defects flagged" → Diagnostician's "fold A, defer B" call wouldn't have happened without the pipeline.
2. **3 new pre-existing flakes surfaced** via the full-matrix sweep — wouldn't have been captured by a direct surgical fix.
3. **Visible-number-shift discipline**: with 8 surfaces affected, the cross-surface regression check ensures we didn't introduce a hard-to-spot drift. A direct fix would have shipped without this confidence.

## Action items for the playbook
- [ ] **Defect B follow-up**: file a separate run for `useDeleteSet` / `useUpdateSet` / `useRemoveExerciseFromSession` missing `["progress"]` cache invalidation.
- [ ] **E2E flake stabilization run**: 7 known pre-existing flakes across `crud.spec.ts:131`, `remove-exercise.spec.ts:92,189`, `soft-deleted-exercises-in-history.spec.ts:87`, `auto-fill-placeholder-on-check.spec.ts:633`, `exercise-progress-ia.spec.ts:152,253`. Largely post-Finish URL regex stale since the verdict-screen feature.
- [ ] **Documentation**: add PostgREST embedded `.is(...)` filter example to `docs/data-model.md`.

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-25_0933_soft-deleted-session-volume-leak/` on 2026-05-25.
