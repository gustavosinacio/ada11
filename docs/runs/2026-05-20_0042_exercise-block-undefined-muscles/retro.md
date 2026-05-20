# Retro — 2026-05-20_0042_exercise-block-undefined-muscles

> Second debug run. Pipeline-fix playbook v0 (drafted in the previous run's retro) was used; this run's observations refine it toward v1.

## Outcome
- **Bug**: `Cannot read property 'length' of undefined` on `exercise.muscles` in `ExerciseBlock` (iOS-only, caused by stale persisted TanStack cache from before `b51dd01`).
- **Pipeline result**: shipped (code-ready; awaiting deploy + user iOS verification).
- **Final commit**: <pending — will fill in after commit>

## Metrics

| Metric | Value |
|---|---|
| Bug reproduces post-fix? | not yet verified — needs user manual on iOS |
| Bugs found post-merge (7 days) | (backfill) |
| Human interventions during run | 1 (approval after fix-plan) + 0 mid-execution = 1 |
| Implement ↔ Regression rounds | 1 (no rework needed; static gates passed first time after the self-reference recovery) |
| Diagnose redirects | 0 |
| Wall-clock duration | ~11 minutes (00:44 → 00:55) |
| Token cost (if known) | n/a |

## What worked

- **Hypothesis-before-search in Diagnostician.** Stating "I suspect stale persisted cache" before grepping made the investigation directed; `git log` confirmation and the persister config inspection both fell into place fast.
- **Cross-environment confirmation** ("why only iOS?") drove the dual-fix realization. Without that step the fix would likely have been symptom-only.
- **Out-of-scope discipline** held — found 4 minor improvements (Zod at API edge, type optionality refactor, formal cache-version policy, abstraction helper) and noted them as follow-ups instead of bundling.
- **Pre-existing typecheck error** detected and left untouched per scope. Documented in `regression-report.md` so the user knows it's unrelated to this fix and lives in their untracked measurements work.

## What was friction

- **`replace_all` self-reference bug.** I used `replace_all: exercise.muscles → muscles` *after* introducing `const muscles = exercise.muscles ?? []`. The replace_all caught the const's own initializer, producing `const muscles = muscles ?? []`. Typecheck caught it (`TS7022` + `TS2448`) and recovery was a 3-edit restore. **Lesson**: when introducing a local that shadows a property access, either:
  1. Do replacements *before* introducing the const (a counter-intuitive ordering), OR
  2. Skip `replace_all` and do each replacement with surrounding context to keep the initializer line untouched.
- **`buster` location surprise.** Plan said "add buster to `createAsyncStoragePersister`". After reading library types, the buster lives on `PersistQueryClientProvider`'s `persistOptions`. The plan was wrong on a detail. **Lesson for Fix Designer**: before claiming an API surface, do a quick type lookup. Either include "verify API exists" in the Fix Designer's `Rules`, or expect the Implementer to discover and deviate (which they did).
- **Custom subagent dispatch is unavailable in this env.** `subagent_type: "reproducer"` was rejected. The Conductor inlined each role (reading `.claude/agents/<role>.md` as guidance, executing in the same session). Same artifacts produced; the playbook should make explicit that subagents are spec files in this env and the Conductor is responsible for inlining the role boundaries.

## Prompt / schema adjustments to fold back

- **`fix-designer.md` agent prompt** — add a Rule: "Before specifying an API call (function name, option name), confirm the surface exists in the linked library types. If unsure, write your assumption as a TODO that the Implementer must verify."
- **`implementer.md` agent prompt** — add a Rule under "Hard quality bar": "Run typecheck immediately after each batch of edits, especially after any `replace_all`. Catch shadow-rename failures before claiming done."
- **`playbook-fix.md`** — short "Subagent dispatch in this environment" note: custom subagents are spec files; the Conductor inlines roles. Saves the next run from rediscovering the dispatch failure.
- **`_template-fix/implementation.md`** — add a "Process notes (for retro)" section that's pre-stubbed. This run already used one ad-hoc and it was the right place for the replace_all lesson.

## Was the pipeline overhead worth it for this fix?

**Yes.** The dual-cause story (consumer + persister) emerged from the Diagnostician's "cross-environment" question, not from the user's report. A no-pipeline direct fix would likely have shipped the symptom-only patch (defensive reads only), leaving the structural gap open for the next migration. The retroactive cost of finding that next surfacing on another stale-cache bug would dwarf today's ~11-minute pipeline run.

## Action items for the playbook

- [ ] Update `fix-designer.md` with the "verify API surface" rule.
- [ ] Update `implementer.md` with the "typecheck after replace_all" rule.
- [ ] Add a "Subagent dispatch in this environment" paragraph to `playbook-fix.md`.
- [ ] Add `Process notes (for retro)` heading to `_template-fix/implementation.md`.
- [ ] Formal "cache-version bump checklist" in `docs/decisions.md` — when do we bump `queryCacheBuster`? (proposal: bump on any migration that adds/renames/removes a column read by a persisted query).

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-20_0042_exercise-block-undefined-muscles/` on 2026-05-20 00:56.
