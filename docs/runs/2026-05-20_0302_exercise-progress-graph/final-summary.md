# Final summary — 2026-05-20_0302_exercise-progress-graph

## Outcome
- **Feature**: Item #5 from `docs/features.md` — "when clicking on an exercise, i want to see a progress graph". IA option A4: list-row → progress screen (existing) → headerRight Pencil → edit. iOS Contacts pattern; mirrors the just-shipped measurements view→edit precedent. **Plus** Discovery's stale-cache side-finding: `useFinishSession` now invalidates `["progress"]`.
- **Pipeline result**: **shipped** (typecheck/lint clean, 51/51 unit, 2/2 new e2e + 8/8 measurements + 4/4 weekly volume regression). 1 pre-existing unrelated e2e failure in crud.spec.ts (broke at `b51dd01`, not touched by this run).
- **Baseline commit**: `a93ca68`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (web; Playwright 2/2 + adjacent green) |
| Human interventions | 0 |
| Total round-trips | 1 (D↔V single-pass, I↔R single-pass, I↔T single-pass) |
| Design ↔ Validate rounds | 1 (`go` with MAJ-1 folded into Implementer) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 1 (`pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~28 min (03:02 → 03:30 BRT) |

## What shipped (4 edited files)

- **EDIT** `app/(app)/exercises/index.tsx:64` — row `onPress` now pushes `/(app)/exercises/${id}/progress`.
- **EDIT** `app/(app)/exercises/[id]/progress.tsx` — extracted `screenHeader` const with function-form `headerRight` Pencil (size=20, `useColorScheme()`, `accessibilityLabel="Edit exercise"`, mirrors measurements precedent byte-for-byte). Mounted in both loading and loaded render branches.
- **EDIT** `app/(app)/exercises/[id]/index.tsx` — removed obsolete mid-page "View progress" CTA (L185-194); delete handler now `router.replace("/(app)/exercises")` instead of `router.back()` (MAJ-1 fold-in, prevents the orphaned-progress-screen-after-delete bug).
- **EDIT** `src/hooks/use-sessions.ts:62` — `useFinishSession.onSuccess` invalidates `["progress"]` umbrella (matches `["progress", exerciseId]` via TanStack prefix semantics). Addresses Discovery's stale-cache side-finding.

## Decisions locked in
1. **IA option A4** — list-row → progress → pencil → edit.
2. **No rebuild** of `progress.tsx` chart logic — it already works (1RM Epley + total volume).
3. **`screenHeader` const extraction** — cleaner than the design's "duplicate Stack.Screen" fallback; matches measurements precedent.
4. **Pencil size=20** — match measurements precedent exactly (overrode design's size=22).
5. **Stale-cache side-finding folded in** — `["progress"]` invalidation on workout finish kept in scope.
6. **Post-delete `router.replace`** — matches measurements precedent at `measurements/[id]/edit.tsx:115`.

## Bugs caught and fixed
- **MAJ-1 (Validator → Implementer fold-in)**: post-delete `router.back()` would have left the user on a broken progress screen for the just-deleted exercise. Fixed pre-emptively with `router.replace("/(app)/exercises")`.

## Why we stopped
- Feature complete. All gates green. Cleanest pipeline run yet — single-pass through D↔V, I↔R, I↔T.

## Artifacts
- discovery.md, design-v1.md, validation-v1.md
- implementation.md, review-v1.md, test-report-v1.md
- transcript.md, state.md, final-summary.md
- retro.md (post-run, owner)

## Notes for the owner
- **Working tree uncommitted.** Suggested split-commit pattern: `feat(exercises): tap-row → progress + headerRight pencil to edit` + `docs(pipeline): archive exercise-progress-graph run`.
- **No migration needed.** Code-only change.
- **Backlog after this:** 2 features remaining — #4 weekly volume drill-down (medium), #1 Strong-style workout/routines unification (largest).

## Bugs found post-merge (backfill within 7 days)
- (none yet)

## Archive
- To archive: `cp -r docs/runs/2026-05-20_0302_exercise-progress-graph "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-20_0302_exercise-progress-graph"` + append index line.
