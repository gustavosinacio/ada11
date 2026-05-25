# Run: 2026-05-25_0933_soft-deleted-session-volume-leak

## Bug report (verbatim)

> adding a session then removing it still makes the volume of that session
> count towards the total week volume. Why is this happening? How can we
> fix it?

## Follow-up clarifications

- (none yet — Conductor pre-diagnosed three SELECT call sites missing
  `.is("sessions.deleted_at", null)`).

## Baseline

- Branch: main
- Commit: bde34d7f29897a0cc578dd0a0efdb7e0f6a95efe

## Current state

- Owner: conductor
- Phase: done
- Status: done
- Started (BRT): 2026-05-25 09:33
- Updated (BRT): 2026-05-25 10:27

## Budgets remaining

- Implement ↔ Regression rounds: 2 / 2
- Diagnose redirect (from later phases): 1 / 1

## Artifacts

- [x] repro.md
- [x] diagnosis.md
- [x] fix-plan.md
- [x] implementation.md
- [x] regression-report.md
- [x] retro.md
- [x] transcript.md (appended incrementally)

## Decisions / events log

- 2026-05-25 09:33 BRT — Reproducer invoked.
- 2026-05-25 09:45 BRT — Reproducer wrote repro.md. Both variants
  (single-session + survivor) confirmed leak. 6 screenshots captured.
  Two extra open questions flagged for Diagnostician:
  (a) useSoftDeleteSession not invalidating `["progress"]`,
  (b) set-level mutations also skip `["progress"]` invalidation.
- 2026-05-25 09:58 BRT — Diagnostician returned `done`. HIGH confidence on diagnosis; MEDIUM risk on eventual fix (wide cascade). Severity breakdown: 3 BLK + 2 MAJ + 1 MIN. **Defect A (`useSoftDeleteSession` missing `["progress"]` invalidation) folded into scope** — same user-visible bug class; sibling-pattern proof: `useFinishSession.onSuccess` already invalidates it. **Defect B (set-level mutations) deferred** to follow-up (different user journey). Zero existing tests pin buggy behavior. Verdict-screen PR detection reads `lifetimeQ.data` so fix correctly removes soft-deleted sessions from PR comparisons (design-intent match). Routing to Fix Designer.
- 2026-05-25 10:05 BRT — Fix Designer returned `done`. 4 surgical changes (3 PostgREST `.is("sessions.deleted_at", null)` + 1 TanStack `["progress"]` invalidation). HIGH conf / MEDIUM risk. Implementer hand-off: verify `.is()` works on embedded resource (fallback: mirror existing `.not("sessions.ended_at", "is", null)` shape if `is()` overload doesn't compile). **User approved fix plan** via AskUserQuestion (Option 1 — approve without folding Defect B). Routing to Implementer.
- 2026-05-25 10:18 BRT — Implementer returned `done`. 6 files (4 source edits + 1 new e2e + 1 implementation.md). 0 functional deviations. `.is("sessions.deleted_at", null)` compiles cleanly with `@supabase/supabase-js@^2.47.0` — no fallback needed. Typecheck/lint clean, 364/364 unit. New e2e not run (dev-server lifecycle owned by Regression Tester per `docs/development.md`). Routing to Regression Tester. I↔R budget: 2/2 remaining.
- 2026-05-25 10:27 BRT — Regression Tester returned `pass`. Bug gone (manual recipe replayed; post-fix screenshots prove fix). New e2e 4/4 (Variant B had a 1-2s race on first invocation, recurred 0/3 after). Full matrix 60/64; 4 failures all confirmed pre-existing via baseline stash replay (3 NEW pre-existing fingerprints surfaced for the known-flake inventory). RLS smoke green. Typecheck/lint/unit clean. Cross-surface 4-screen verification converges on post-fix value. Pipeline complete. Conductor finalizing.
