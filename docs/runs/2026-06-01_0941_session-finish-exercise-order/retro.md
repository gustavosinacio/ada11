# Retro — 2026-06-01_0941_session-finish-exercise-order

## Outcome
- **Bug**: After tapping Finish, History rendered a session's exercises in a different (and run-to-run unstable) order than the live workout screen showed.
- **Pipeline result**: shipped (fix applied; migration `0019` applied to the live Supabase project; Regression Tester PASS).
- **Final commit**: pending the end-of-batch commit (owner authorized the Conductor to commit + push + deploy at the end of the batch — `state.md:29`). The fix is in the working tree on `main`, baseline `5985c57`.

## Metrics

| Metric | Value |
|---|---|
| Bug reproduces post-fix? | no (Regression Tester PASS across all 3 session shapes; owner UI/native confirmation pending the manual checklist) |
| Bugs found post-merge (7 days) | (backfill) |
| Human interventions during run | 1 — the approval gate, where the owner (a) approved fix-plan-v2, (b) ADDED the History reorder requirement, and (c) escalated autonomy to let the Conductor apply the migration + commit + deploy |
| Implement ↔ Regression rounds | 1 (PASS first round; the round-2 was a Conductor-directed test-only de-flake, NOT a fail-round) |
| Diagnose redirects | 0 |
| Wall-clock duration | ~02:04 (09:41 → 11:45 BRT) |
| Token cost (if known) | n/a |

## What worked
- **The Reproducer refuted the Conductor's leading hypothesis cheaply, before any fix was scoped.** The framing named a `completed_at` sort; the Reproducer proved it was already fixed and built a discriminator probe showing the real cause is an N-way `set_number=1` tie broken by physical insertion order (`repro.md:12, 55`). This is the system working as designed — the Reproducer's job is to confirm-or-refute the framing, and it did, with zero downstream cost (0 diagnose redirects, 0 rework).
- **The Diagnostician's "the user's order is persisted nowhere" finding determined the fix shape.** Proving 3 of the live order's 4 inputs are client-only (`diagnosis.md:58-67`) is what forced persistence over a query-only fix, and the 3-shape × 3-direction coverage matrix gave the approval gate a decision table, not a recommendation to trust.
- **The carry-in feedback lessons paid off — three agents applied their own prior feedback.** The Fix Designer cited the prior run's "source-can't-represent-the-must-match-case" lesson verbatim (`fix-plan-v2.md:33`) to reject the symptom-only directions; the Implementer pre-empted the e2e-seed-source trap for the 2nd consecutive run (`implementation.md:50`); the Regression Tester backstopped the deferred `expo export` for the 2nd run. The feedback loop is driving learning across the whole roster.
- **The v1→v2 revision turned a tradeoff into a feature without scope sprawl.** v1's "old sessions can't recover their order" tradeoff became a manual-recovery path (first reorder of a legacy NULL session writes its full order) by reusing the EXISTING `<ExerciseBlock>` chevron props and the EXISTING optimistic-mutation pattern — zero novel UI or cache mechanism.
- **Gates green first pass (455/455), 0 adjacent regressions, single I↔R round.** The Implementer caught the migration-number collision (0016→0019) by listing the directory, removed a post-discard staleness race via an effect-synced ref, and kept `uuid[]` on a precedent-based rationale (no `jsonb` fallback needed — confirmed live).

## What was friction
- **The owner added a requirement AT the approval gate (History reorder), expanding scope from pure bug-fix to bug-fix + small feature.** Handled cleanly via a fix-plan-v2 re-route (pre-approval iteration, did NOT consume the diagnose-redirect budget), but it is the one place the pipeline's linear shape met a mid-flight scope change. The Fix Designer absorbed it well because the new requirement reused the in-flight column/mechanism.
- **One e2e assertion was flaky** due to the app's `PersistQueryClientProvider` localStorage-rehydration race on `page.goto` reopen — a test-harness artifact, not a fix defect (the write/persist assertion passes every run). The Regression Tester root-caused it, proved it via a `toPass`-wrapped throwaway (3/3), and flagged it; the Conductor did the test-only de-flake.
- **The migration was applied to the LIVE shared Supabase project mid-run** (additive/nullable/reversible, owner-authorized). Low-risk by construction, but it is the highest-risk action in the run and depended on the owner's explicit autonomy escalation.

## Prompt / schema adjustments to fold back
- **Conductor hypothesis framing:** the framing at `state.md:8` / `repro.md:6` named a leading hypothesis. `repro.md:6` already phrased it as "Leading hypothesis to confirm/refute" — keep that phrasing as the standard so the framing reads as a falsifiable starting point, not a conclusion the Reproducer must overturn. The refutation-by-Reproducer is a FEATURE; do not change the routing.
- **Diagnostician persistence-variant recommendation:** when recommending a "lowest-write-frequency" persistence variant (here: snapshot-at-Finish), add a one-line note on how the write path generalizes IF a manual-edit/recovery UI is ever wanted on the same data — this would have anticipated the gate's reorder-requirement expansion.
- **`retro.md` ownership:** confirmed again as Conductor-attributed scaffolding (the Conductor delegated it to the Evaluator step this run, `state.md:24`). No template change needed.

## Was the pipeline overhead worth it for this fix?
**Yes.** The bug looked like a one-line sort fix from the report ("order gets messed up"), and the Conductor's own leading hypothesis was a `completed_at` sort. A direct fix would have chased that already-fixed path or shipped a symptom-only secondary-sort key that leaves ad-hoc/reordered sessions "stably wrong." The pipeline's value was concentrated upstream: the Reproducer refuted the wrong cause, the Diagnostician proved the order is persisted nowhere (forcing a schema change), and the approval gate caught a schema-on-live-DB change for human sign-off — which is also where the fix grew a small, well-scoped recovery feature. For a bug that touches a live migration + shared query path + 3 screens, the overhead was clearly justified.

## Action items for the playbook
- [ ] Consider documenting in `docs/playbook-fix.md` that the Conductor's leading hypothesis should always be phrased "confirm OR refute" (as `repro.md:6` did), so framing is a falsifiable starting point.
- [ ] Consider a Diagnostician-contract note: when recommending a persistence variant, state how the write path generalizes to a manual-edit UI on the same data (anticipates gate-added requirements).
- [ ] (Carry-over, low priority) A finalize-step check that the transcript's last entry matches `state.md`'s closed-loop status — flagged after the prior feature run's transcript truncation; did NOT recur this run.

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-06-01_0941_session-finish-exercise-order/` on <BRT timestamp — Conductor fills at archive>.
