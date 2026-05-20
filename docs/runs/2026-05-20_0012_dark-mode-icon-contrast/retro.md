# Retro — 2026-05-20_0012_dark-mode-icon-contrast

> First debug run. Goal of this retro: extract the pipeline-fix playbook from what worked.

## What the Conductor actually did (phases observed)

| # | Phase | Output artifact | Duration estimate |
|---|---|---|---|
| 1 | Intake | (verbal in chat) | seconds |
| 2 | Reproducer round 1 | (chat — asked structured questions, rejected) | ~1 min |
| 3 | Reproducer round 2 | repro.md | ~3 min after screenshot arrived |
| 4 | Diagnostician | diagnosis.md | ~3 min (grep + read) |
| 5 | Fix Designer | fix-plan.md | ~3 min |
| 6 | Implementer | implementation.md + 9 file edits | ~2 min |
| 7 | Regression Tester | regression-report.md | ~3 min (gates + build) |
| 8 | Retro | this file | inline |

## What worked

- **Visual evidence pivot.** The screenshot completely reframed the bug class (from "blank screen" → "icon contrast"). Without it, the Conductor would have spent meaningful time on red herrings (service workers, PWA manifest, auth gating, routing).
- **Grep as first diagnostic tool.** Once the symptom class was known (hardcoded icon color), `grep` found all 13 candidate locations in seconds. The triage (3 blockers + 5 minors deferred) emerged from listing them side-by-side.
- **Cross-environment question** ("why only PWA?") confirmed the root cause was right, not coincidental. Non-blocking but high-confidence-multiplier.
- **Explicit out-of-scope statement** in `fix-plan.md` prevented the natural urge to "while I'm here, fix all 13 icons". Scope held.
- **Static gates (typecheck + lint + unit + web export) are cheap and high-signal.** All 4 ran in < 60s combined.
- **`useColorScheme` already integrated in root layout** → no plumbing work to bring it into the affected files.

## What was friction

- **AskUserQuestion was rejected at Reproducer round 1.** Structured multi-choice felt too heavy for the user; they wanted to volunteer the critical clue ("PWA only") in free text. **Lesson**: in Reproducer phase, default to free-text questions. Use structured prompts only when the user has narrowed enough that a 2-3 option choice is clearly all that remains.
- **The initial bug description was wildly off.** "Telas em branco" → actually "icon invisible". A verbal-only Reproducer round would have led the Conductor astray. **Lesson**: for any UI bug, **the first thing to request is a screenshot or screen recording**, before any code work.
- **Visual verification of the fix could not be automated** in this session because the routes are auth-gated and the canonical environment is the PWA install on iOS. The Conductor had to delegate the final visual check back to the user, which means the run is "done with code, pending manual confirm". **Lesson**: for UI bugs verified on real device, the regression report should always include a clear manual-verification checklist for the user.

## What surprised the Conductor

- The bug had been reported as "blank screen" but the actual class is "low contrast". The mental model "blank screen ⇒ render failure" almost dominated the early investigation. **Implication for the playbook**: Reproducer must treat verbal descriptions of UI bugs as approximate until visual evidence is in hand.
- The fix touched **two different icon-color patterns** (one straight, one inverted) depending on whether the icon was on the screen background or inside a `dark:`-flipping button. A naive "find/replace hardcoded color" would have broken the routine detail "Add" button.

## Proposed pipeline-fix playbook (draft v0)

Phases — all artifacts ad-hoc until templates are created:

```
[bug report]
    │
    ▼
1. INTAKE          (Conductor logs the report verbatim)
    │
    ▼
2. TRIAGE          (Conductor decides: trivial-fix path or full pipeline)
    │   trivial → direct fix, skip pipeline
    │   non-trivial ▼
3. REPRODUCER      → repro.md
    │   (must include visual evidence for UI bugs)
    │   (free-text questions, NOT structured prompts, in round 1)
    ▼
4. DIAGNOSTICIAN   → diagnosis.md
    │   (grep-first; cross-environment confirmation if applicable)
    ▼
5. FIX DESIGNER    → fix-plan.md
    │   (scope, risks, alternatives, out-of-scope explicit)
    │   ← human approval gate
    ▼
6. IMPLEMENTER     → implementation.md + code changes
    │   (static gates: typecheck, lint, unit, build)
    ▼
7. REGRESSION TEST → regression-report.md
    │   (manual-verification checklist if visual + auth-gated)
    ▼
8. RETRO           → retro.md
```

### Key differences vs feature pipeline
- **No Designer→Validator loop.** A single Fix Designer + human approval suffices for small fixes. For larger debug work (refactor of root cause spanning many files), add Validator back.
- **Tester emphasizes regression**, not golden path. The "golden path" is "the bug is gone"; regression is "nothing else broke". Different framing → different test plan.
- **Triage phase added.** Trivial bugs should bypass the pipeline entirely; the pipeline is for non-obvious or risky fixes.
- **Visual evidence mandatory in Reproducer** for UI bugs.

### Open questions for the next debug run
- Should Reproducer include a "questions answered / unanswered" section to make ambiguity explicit?
- Should the Fix Designer always produce 1-2 alternatives, or is 1 OK for trivial mechanical fixes? (Feature pipeline mandates 1+; for debug it may be over-engineering.)
- How should the manual-verification checklist be returned to the Conductor after the user runs it? Append to regression-report.md? New file `manual-verification.md`?

## Recommendation
Before running another debug, draft `docs/playbook-fix.md` and `docs/runs/_template-fix/` based on this retro. The playbook will be lean (7 phases vs feature's 6+budgets) and will reuse some artifacts (transcript.md, state.md).
