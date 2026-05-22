# Transcript — 2026-05-21_2155_volume-math-wrong

## 2026-05-21 21:55 BRT — Conductor: intake + triage

Two related volume-math symptoms reported (weekly total + per-exercise "Volume to PR"). Multi-file scope likely (stats query, strip component, possibly F11 PR calculator). Regression risk: shared math kernel used by both surfaces. Triage → **pipeline-worthy**.

Visual evidence: two screenshots received in chat, captured numerically in `docs/runs/2026-05-21_2123_volume-bugs-evidence/README.md` (4.9k Bench, 5.8k Squat, 26.2k week total). Strong reference also saved for the row-tint feature (out of scope here).

Routing: Reproducer next.

## 2026-05-21 21:57 BRT — Conductor (Reproducer-role)

- **Inputs passed**: bug report verbatim, screenshots, code paths `src/components/weekly-volume-strip.tsx`, `src/components/volume-target-slot.tsx`, `src/utils/volume-target.ts`, `src/api/progress.ts`, `src/api/stats.ts`, `scripts/import-strong.ts`.
- **Action**: ran `scripts/debug-weekly-volume.ts` against prod (read-only, service role). Diagnostic returned: 8-week histogram (W21 = 26.21k matching display), per-session breakdown for W21 (4 sessions sum to 26 210 kg), 46 duplicate `(session_id, exercise_id, set_number)` tuples from the 2026-05-20 Strong import.
- **Returned**: `status=done`, `repro_deterministic=yes`, `visual_evidence=yes`.
- **Conductor decision**: Routes to Diagnostician.

## 2026-05-21 21:58 BRT — Conductor (Diagnostician-role)

- **Inputs**: `repro.md`, `src/utils/volume-target.ts`, `src/api/progress.ts`, `src/api/stats.ts`, `scripts/import-strong.ts`, diagnostic output.
- **Returned**: `status=done`. Verdict: **no code bug in volume kernels.** Both displayed values reproduce exactly from DB using the current code paths. The user's report is a **spec/definition mismatch**, not a math bug. Separate side-finding: real data-integrity bug in `import-strong.ts:517-518` (set_number defaults to 1 on missing/empty CSV column).
- **Conductor decision**: **PAUSE THE PIPELINE.** Fix Designer cannot proceed without a product decision from the user on:
  1. What spec to ship for "Volume to PR" (current = per-session max; user expects something more lenient).
  2. Whether the weekly total spec needs changing (no observed math divergence; perception may be subjective).
  3. Whether to queue a separate bug-fix run for the Strong-import set_number bug.
- **Status**: `needs-input`. Awaiting user direction.
