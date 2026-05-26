# Feedback for Reviewer

## Run 2026-05-26_0307_bottom-tab-home-link — 2026-05-26 04:42 BRT

Pipeline: feature
Final outcome: pass (Reviewer passed first try; Tester later found runtime gap Reviewer couldn't statically catch)
Score: 5/5

### Rubric
- Severity classes consistent with Validator's: pass — 0 blockers / 0 majors / 3 minors (`review-v1.md:42-56`), all correctly cosmetic/advisory (route-regex tolerance for `?id=` suffix, magic-number sleep magnitude, brittle `node_modules/` path in a code comment).
- Security checklist applied: pass — full security section at `review-v1.md:58-64` covers RLS (N/A — pure client navigation, no DB queries), service-role key (used only in spec for setup, never in shipped code), input handling (no raw SQL/`rpc`/shell exec), public env vars (no new `EXPO_PUBLIC_*`), auth surface (no change). Explicit "N/A in substance" framing where appropriate — does not invent issues.
- Style checklist applied: pass — `review-v1.md:66-74` walks "no new `any` / no new `@ts-ignore` / no new `as` casts" with diff grep, comments-narrate-why (caught MIN-3: the `node_modules/...` path in a code comment is brittle on version pin drift), imports follow project style. The MIN-3 catch on the brittle absolute-path-in-comment is exactly the right kind of "you put a fragile reference in source" find.
- Decision rule applied correctly: pass — 0 blockers + 0 majors + 3 minors → `pass` (`review-v1.md:111-127`). Reasoning explicit walking each finding category.
- Did not run the app: pass — review is static-only (`review-v1.md:5-9` cites the diff command + line counts; one `npm run typecheck` re-run is the only command attributed; no `npm run web` or playwright execution attributed to Reviewer).
- Audit trail: n/a — no peer invocations attributable to this agent.
- Write boundaries: pass — only `review-v1.md` attributed.

### Lessons for next run
- **Test-quality scrutiny is now applied at the right depth, with diff-content sibling-precedent cross-references.** The `Test-quality scrutiny` section (`review-v1.md:76-93`) walks each new e2e assertion against sibling precedents and flags MIN-1 (route regex `/exercises/<id>/progress$` ends with `$` but sibling `exercise-progress-ia.spec.ts:259` uses `(\?.*)?$` for `?id=` suffix tolerance) AND MIN-2 (300ms sleep below the 500ms sibling-precedent floor). This is exactly the gap that was flagged as the canonical-exercises run's "candidate addition to the static checklist" and the routine-strong-builder run's actual fail. **This run applied the lesson correctly — the routine-strong-builder string-vs-number sibling-precedent and `.first()` discipline are now both encoded in the checklist and applied.** Sustain.
- **Behavioural-correctness-of-the-listener table** (`review-v1.md:95-109`) is a new format that worked well — walks each guard conjunct against the design's Behaviour matrix, the type contract source, AND the framework's own use of the same dispatch shape (`createNativeStackNavigator.js:62-65`). For framework-event-handler code, this kind of "guard-by-guard against the framework's primitives" cross-check is the right discipline. Sustain.
- **The cross-check against `expo-router`'s own internal use of `{...StackActions.popToTop(), target: state.key}`** at `:107` is high-leverage — by anchoring the dispatch shape to the framework's own pattern, the Reviewer made the upstream-divergence risk verifiable. Sustain this "find the framework's canonical use and cite it" reflex for any new framework-boundary code.
- **The Reviewer correctly identified the limit of static review for this kind of feature.** The runtime gap (round-1 `tabPress` not firing on focused re-tap, round-2 `PartialState` shape from deep-link rehydration) is empirically observable but not statically inferable from the diff. Tester surfaced both. The Reviewer's role here was to verify everything verifiable from the diff (action shape, type contract, deviations, security, style) and pass it to Tester for the runtime close-loop — which is exactly what happened. **No score penalty for missing the runtime gap; static review can't catch what only a probe reveals.** But: Reviewer could have flagged "this design's correctness depends on a runtime ordering claim that hasn't been runtime-verified" as an explicit hand-off note to Tester, sharper than the current "Tester can decide whether MIN-1's regex tolerance is needed based on observed runtime behaviour." Consider adding a checklist item: "if the design depends on event ordering or async dispatch chains, explicitly note this in the hand-off to Tester."
- **All 5 declared deviations verified individually** with file:line evidence (`review-v1.md:30-37`). The 7-row deviation-audit format is exactly the cross-check Validator can't do (no diff yet) and Tester won't do (executes, doesn't read). Sustain.

### Recurring pattern check
- **Test-quality scrutiny inside static review** is now showing maturation. Canonical-exercises run: "candidate addition to the static checklist". Routine-strong-builder run: missed two diff-content e2e bugs (PostgREST string-vs-number, strict-mode locator). **This run: applied the discipline correctly** — caught MIN-1 (route regex `?id=` suffix) and MIN-2 (sleep magnitude) via sibling-precedent cross-reference, both before Tester ran. **Pattern resolved: Reviewer's test-quality methodology is now reliable.** Sustain and watch for new variants.
- **Strong positive: file:line evidence dense across all 5 sections** — verification table (16 claims), deviation audit (5 rows), test-quality scrutiny (10 rows), behavioural-correctness table (5 guards), checklists (security + style). Reviewer output shape is stable and reliable across 3 consecutive runs.

## Run 2026-05-26_0101_routine-strong-builder — 2026-05-26 02:58 BRT

Pipeline: feature
Final outcome: pass (Reviewer passed first try; Tester later found 2 e2e defects Reviewer missed)
Score: 4/5

### Rubric
- Severity classes consistent with Validator's: pass — 0 blockers / 0 majors / 5 minors (`review-v1.md:64-81`), aligned with Validator's classification rubric. All 5 minors are correctly cosmetic / robustness-future / doc-only.
- Security checklist applied: pass — full security section at `review-v1.md:53-60` covers RLS posture (new `routine_exercise_sets` table has 4 explicit policies all gated on `auth.uid() = user_id`), no service-role creds in client code (grep verified — `SERVICE_ROLE` clean in `src/`/`app/`), input handling (parameterized PostgREST only, no raw SQL/`rpc`), public env vars (no new `EXPO_PUBLIC_*`), bulk-insert RLS (`seedSetsForSession` reads `auth.user.id` first and every row carries `user_id = userId`). The new partial-unique `(routine_id, exercise_id)` is correctly flagged as a constraint not a query surface.
- Style checklist applied: pass — `review-v1.md:36` walks "no new `any` / no new `@ts-ignore`" with diff grep; 2 `as unknown as` casts at `routine-exercise-sets.ts:66-67, :259` documented as matching `sets.ts:200-203` / `stats.ts:63,87` precedents. MIN-5 (import-ordering informational) and MIN-3 (`useEffect` reset robustness) catch the right kind of stylistic/foot-gun concerns.
- Decision rule applied correctly: pass — 0 blockers + 0 majors + 5 minors → `pass` (`review-v1.md:83-96`). Reasoning explicit at `:87-94` walking each finding category.
- Did not run the app: pass — review is static-only against the diff (`review-v1.md:5-12` cites the diff command + line counts + new/edited file list; one `npm run typecheck` re-run is the only command — no `npm run web` or playwright execution attributed to Reviewer).
- Audit trail: n/a — no peer invocations attributable to this agent.
- Write boundaries: pass — only `review-v1.md` attributed.

### Lessons for next run
- **Static review of new e2e specs MUST trace at least one assertion mentally against the runtime data shape.** Reviewer's deviation-audit table (`review-v1.md:39-50`) walked each Implementer-declared deviation, AND the verification table (`:15-37`) walked every implementation claim — but neither cross-checked the test-suite's assertions against the PostgREST data shapes. The line-246 string-vs-number bug (`tests/e2e/routine-strong-builder.spec.ts:246` expected `["60.00", "70.00", "80.00"]` strings, PostgREST returns `numeric` as JS number) is the kind of bug Reviewer SHOULD catch in static review because (a) the assertion is literally in the diff, and (b) there is an established precedent in the same e2e dir at `auto-fill-placeholder-on-check.spec.ts:340` (`parseFloat(row.weight as string)`) that proves the runtime shape. **Add to the static review checklist: for each new e2e assertion against a PostgREST-fetched value, find ONE sibling spec asserting against the same column type and confirm the runtime-shape coercion is consistent.**
- **The line-376 strict-mode locator collision is harder to catch statically** (you'd need to think "this page also renders a tab bar with the same label"), but the sibling-precedent reflex would have caught it: 8 of 9 sibling specs that match `"Exercises"` use `.first()`. **Add to the static review checklist: for any `getByText` / `getByRole` on a label that could plausibly appear in the bottom tab bar (Workout, Exercises, History, Progress, Profile), default-flag and require `.first()` or a `within()` scope.**
- **MIN-3 robustness catch on `routine-exercise-card.tsx:326-329`** (the `useEffect` reset clobbering an in-flight user edit if cache invalidates while typing) is the exact shape of catch the Reviewer SHOULD do — reading the source for "what's the unhappy path?" Sustain that. Note Reviewer correctly classified it as future-robustness, not a regression — the v1 single-user / single-tab context absorbs it.
- **MIN-4 wording catch on the defensive `throw` in `seedSetsForSession`** (`review-v1.md:78-79`) is also a sharp read — Reviewer noticed the comment "DB CHECK invariant should make this unreachable" could mislead a future reader into thinking the throw is dead code. Recommending the rewording is the right shape of catch.
- **Sustain the deviation-audit table** (`review-v1.md:39-51`) — walking each Implementer deviation against the design's flex points is exactly the cross-check the Validator can't do (no diff yet) and the Tester won't do (executes, doesn't read). The 7-row table here is high-value.
- **Sustain the 30+ claim verification table** (`review-v1.md:15-37`) — dense, file:line-cited, makes Evaluator audit trivial.

### Recurring pattern check
- **Test-quality scrutiny inside static review** is a candidate recurring miss: in canonical-exercises run, Reviewer "did NOT catch the soft-deleted-canonical leak" (DB-state, not diff-content, so excused — `docs/feedback/reviewer.md:22` notes the gap as a "candidate addition to the static checklist"). **In this run**, Reviewer missed two diff-content e2e bugs (line-246 PostgREST type mismatch, line-376 strict-mode locator) — both ARE diff-content, both ARE caught by sibling-precedent grep. Pattern: **Reviewer's static methodology audits source code well but does not yet audit test code with the same rigor.** Next-run lesson: extend the verification table to include the test-suite diff explicitly, with sibling-precedent cross-references for each new assertion / locator.

## Run 2026-05-25_1921_canonical-exercises — 2026-05-26 00:35 BRT

Pipeline: feature
Final outcome: pass
Score: 5/5

### Rubric
- Severity classes consistent with Validator's: pass — 0 blockers / 0 majors / 6 minors (`review-v1.md:49-69`), aligned with Validator's classification rubric. None of the minors mis-classified.
- Security checklist applied: pass — full security section at `review-v1.md:71-78` covers RLS posture (new SELECT widened, mutating policies tightened), no service-role creds in client code (grep verified), input handling (parameterized PostgREST only), public env vars (no new `EXPO_PUBLIC_*`), spoof-NULL-INSERT defense (double-locked at API + RLS layers).
- Style checklist applied: pass — `review-v1.md:80-87` walks "no new any" / "no new @ts-ignore" / `as` cast inventory (4 new, all consistent with existing test convention) / comments-narrate-why / imports-follow-project-style (caught 2 specs with helper import inside package block — MIN-2) / new files in conventional folders.
- Decision rule applied correctly: pass — 0 blockers + 0 majors + 6 minors → `pass` (`review-v1.md:91-101`). Reasoning explicit at `:93-100` ("0 blockers + 0 majors + 6 minors — none are functional regressions; all stylistic, robustness-improvement, or documentary").
- Did not run the app: pass — review is static-only against the diff (`review-v1.md:6-10` cites the diff command + line counts + new files; no `npm run web` or e2e execution attributed to Reviewer).
- Audit trail: n/a — no peer invocations attributable to this agent.
- Write boundaries: pass — only `review-v1.md` attributed.

### Lessons for next run
- The **deviation-audit table** (`review-v1.md:37-44`) — walking each Implementer-declared deviation against the design's flex points — was high-value defense. That's exactly the cross-check the Validator can't do (because it doesn't see the diff yet) and the Tester won't do (because it executes, not reads). Sustain it.
- The 31-claim verification table (`review-v1.md:14-33`) is dense but readable; keep the format. Spot-citing line numbers (e.g. `progress.tsx:50-83`, `created-by-you-chip.tsx:22-33`) makes it trivial for a future Evaluator to audit.
- **MIN-3 (gating spec 5 missing pre-flight SELECT auth proof)** was a sharp robustness catch — proved that you read the test code, not just the source under test. Test-quality scrutiny inside review is rare and valuable.
- The Reviewer did NOT catch the soft-deleted-canonical leak (root cause was DB state, not diff content) — but it's worth noting: a future Reviewer cross-check ("read the migration's intent + check pre-existing DB state where the migration applies") would have surfaced it. Not a fail this run (review is static-on-diff, not DB-state inspection), but a candidate addition to the static checklist for migrations that touch existing rows.

### Recurring pattern check
- none — first feedback entry for Reviewer on this project.
