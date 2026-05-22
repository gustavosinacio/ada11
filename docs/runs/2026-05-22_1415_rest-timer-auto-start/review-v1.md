# Review v1 — 2026-05-22_1415_rest-timer-auto-start

Reviewing: the diff for the implementation against `design-v1.md`.

## Diff scope

- Diff command: `git diff b375c13d1224110e7791d903f1a06992906b6047...HEAD`
- Files changed: 2
  - `app/(app)/workout/[sessionId].tsx` — +17 / -0 (modified)
  - `tests/e2e/rest-timer-auto-start.spec.ts` — +607 / -0 (new file)
- Static review only. `npm run typecheck` ran clean (no output).

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| Handler edited at `[sessionId].tsx:411-440` per design's exact shape | yes | `app/(app)/workout/[sessionId].tsx:411-438` — handler body matches the design's "Exact handler shape" verbatim, modulo identical comment wording. |
| `nextChecked === true` gate present | yes | `[sessionId].tsx:419` — `if (nextChecked) { … }` wraps the auto-start block. |
| Lookup via `setsByExercise.get(ex.id)?.find(s => s.id === id)` | yes | `[sessionId].tsx:420-422`. Uses `?? []` defensive default before `.find` — same shape as the design's snippet. |
| `set_type === "working"` filter excludes warmup AND dropset | yes | `[sessionId].tsx:423` — strict equality to `"working"`. Warmups and dropsets fall through silently. |
| `restByExercise.get(ex.id)` truthy + > 0 | yes | `[sessionId].tsx:424-425` — `if (rest && rest > 0) restTimer.start(rest);`. Note: `restByExercise` map only contains entries where `target_rest_seconds > 0` (`:91-99`), so the `> 0` check is belt-and-suspenders. Acceptable redundancy — matches design exactly. |
| `restTimer.start(rest)` fires BEFORE `await checkSetM.mutateAsync(id)` | yes | `[sessionId].tsx:425` (start) precedes `[sessionId].tsx:429-431` (mutation). Optimistic placement confirmed. |
| Existing add-set auto-start at `:373-376` untouched | yes | Diff against baseline shows zero lines removed in that block; only the new 17-line insertion at `:411-427`. Add-set handler still uses `set_type !== "warmup"` (working AND dropset), unchanged. |
| Bulk-check-all path bypasses `onToggleSetChecked` | yes | `[sessionId].tsx:259-269` (`handleCheckAllAndFinish`) calls `bulkCheckAll.mutateAsync()` directly, never routes through the per-set toggle. No new code added to this path. |
| `useRestTimer.start` re-call IS the reset | yes | `src/hooks/use-rest-timer.ts:77-86` — `start` unconditionally writes `endsAt` / `totalSeconds` / AsyncStorage. Confirmed during design validation; no change in this PR. |
| 7 e2e scenarios shipped | yes | `tests/e2e/rest-timer-auto-start.spec.ts` — scenarios at lines 246, 291, 330, 378, 434, 476, 541. Covers the 6 design scenarios collapsed into core behaviors + MIN-1 nav-away. |
| Working-set check with rest → overlay appears | yes | Spec line 246-289. Seeds `restSeconds: 90`, asserts `expectOverlayRunning` + `remaining ∈ [89, 90]`. |
| Warmup check → no overlay | yes | Spec line 291-328. Seeds `setType: "warmup"`, waits 500ms, asserts `expectOverlayIdle`. |
| Dropset check → no overlay | yes | Spec line 330-376. Seeds a parent working set (completed) + child dropset (uncompleted); taps check on the drop; asserts idle. |
| Re-check after uncheck → overlay restarts | yes | Spec line 378-432. Drains ~5s, unchecks, re-checks, asserts `fresh >= 88` (proves overwrite). |
| No-target exercise → no overlay | yes | Spec line 434-474. Seeds the "without-rest" exercise (`target_rest_seconds = null`); checks a working set on it; asserts idle. |
| Bulk-check-all → no overlay fires | yes | Spec line 476-539. Two unchecked working sets; goes through Finish modal → "Check all and finish"; lands on `/verdict`; re-navigates to confirm AsyncStorage has no leftover persisted timer. |
| Nav-away survival (MIN-1) | yes | Spec line 541-606. Starts timer, navigates to `/exercises/<id>/progress`, waits 2s, navigates back; asserts overlay still running with `after < before` AND `after >= 80`. Proves AsyncStorage rehydration under auto-start path. |
| MIN-2 timing slack (`>= 59`-style tolerance, not exact `~60`) | yes | All `readRemainingSeconds` assertions use `toBeGreaterThanOrEqual` / `toBeLessThanOrEqual` ranges. Scenario 1: `[89, 90]`. Scenario 4: `fresh >= 88`. Scenario 7: `after >= 80`. Tolerance documented in file docblock at `:18-22`. |
| `npm run typecheck` clean | yes | Verified in this review pass — no output. |
| No new `any`, no new `// @ts-ignore`, no `console.log` | yes | Spec uses `SupabaseClient`, explicit param types on every helper. Only `console.warn` referenced in `[sessionId].tsx:436` is pre-existing on the same handler. |

## Issues

### Blockers

None.

### Majors

None.

### Minors

- **[MIN-1]** `tests/e2e/rest-timer-auto-start.spec.ts:222`: `await expect(page.getByText("Resting", { exact: true })).not.toBeVisible();` — using `.not.toBeVisible()` without an explicit short timeout can pass spuriously if the assertion runs before any async state propagates. In practice `expectOverlayIdle` is called after a `waitForTimeout(500)` in every "no-fire" scenario (`:323`, `:371`, `:469`), so the race window is closed. Recommendation (non-blocking): tighten the negative assertion to `{ timeout: 1_000 }` to make the intent explicit. Fix: small surface; can be deferred to Tester polish.

- **[MIN-2]** `tests/e2e/rest-timer-auto-start.spec.ts:233`: `await page.getByText(/^\d+:\d{2}$/).first().innerText()` — the regex matches any `m:ss` shaped text. The live workout screen renders an "Elapsed" `0:00` counter at session start (also `m:ss` shape). If `.first()` ever resolves to the Elapsed clock instead of the overlay countdown, the test reads the wrong value. In practice `expectOverlayRunning` (which precedes every `readRemainingSeconds` call) gates on the "Resting" label + Skip button being visible, and the overlay is rendered near the bottom of the screen — but document order on web isn't guaranteed to align with visual position. Recommendation: scope the locator under the overlay container, e.g. `page.getByLabel("Stop rest timer").locator("..").getByText(/^\d+:\d{2}$/)` or a `data-testid` on the countdown. Fix: small. Not blocking because the Elapsed counter starts at `0:00` and ticks up; if it were ever read, the assertions (`>= 89`, `>= 88`, `>= 80`) would fail loudly rather than silently pass. Surface to Tester.

- **[MIN-3]** `tests/e2e/rest-timer-auto-start.spec.ts:191`: `await page.goto("/(app)/workout/${sessionId}", …)` — the URL includes the literal `(app)` route group segment. Expo Router typically strips route groups from URLs at runtime; the spec relies on the platform tolerating this form (it then validates the actual URL via `waitForURL(/\/workout\/[0-9a-f-]+/, …)`). Other specs in the repo (e.g. `end-of-session-verdict.spec.ts`) use the same convention, so this matches established style. Documenting it because if Expo Router behavior ever changes, the whole suite breaks together — not a regression introduced here. No fix needed.

- **[MIN-4]** `app/(app)/workout/[sessionId].tsx:412-418` — the inline comment in the new block is descriptive ("Optimistic auto-start of rest timer on transition to checked. Mirrors the post-add-set trigger above…"). Per project style ("comments narrate why, not what"), the "Mirrors the post-add-set trigger above" part is the why-justification; the "Optimistic" framing is genuinely a design decision worth narrating; the "Working sets only — warmups and dropsets do not start a rest" line is closer to "what" than "why". Borderline — the why is captured ("dropset chains have no inter-drop rest" would be the deeper justification, but it lives in `design-v1.md` Alternative 5). Not blocking. Fix optional: trim to one sentence about the optimistic timing decision and let the design doc carry the dropset rationale.

- **[MIN-5]** `tests/e2e/rest-timer-auto-start.spec.ts:69-84`: `getSeedExerciseByName` silently falls back to `data[0]` if the preferred name isn't found. Multiple scenarios depend on `withRest` ≠ `withoutRest` (lines 252-253, 295-296, …). If the seed data ever changes to a single exercise or both lookups happen to fall back to the same row, scenario 5 ("WITHOUT rest configured") could accidentally hit the same exercise as `withRest`, and the test would pass for the wrong reason. The repo's seed exercises ("Bench Press", "Back Squat") are stable, so this is theoretical. Recommendation: throw if `withRest.id === withoutRest.id` before seeding. Fix small; not blocking.

## Security checklist

- [x] **RLS**: No new `from('table').*` calls in `app/` or `src/`. The handler edit only reads from in-memory `Map` state already loaded by existing hooks (`useRoutineExercises`, `useSets`). The single mutation (`checkSetM.mutateAsync(id)`) is unchanged. The e2e spec uses the admin/service-role client to seed data through RLS — that's the established pattern for tests (verified against `tests/e2e/auth.spec.ts`, `crud.spec.ts`, `end-of-session-verdict.spec.ts`, etc.).
- [x] **No `SUPABASE_SERVICE_ROLE_KEY` in client-bundled code**: confirmed via `grep -rn "SUPABASE_SERVICE_ROLE_KEY" app/ src/` — zero matches. Service role only referenced in the test spec (`tests/e2e/rest-timer-auto-start.spec.ts:32`), which is not bundled into the app.
- [x] **No raw SQL `rpc` calls** added in this diff.
- [x] **No new `EXPO_PUBLIC_*` env vars** added; the spec reads existing `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` to drive the sign-in flow — both already in the project.

## Style / convention checklist

- [x] **No new `any`**: spec uses `SupabaseClient`, `Page`, explicit return types on helpers. Handler edit reuses existing types in scope (`SetRow`, `string`, `boolean`).
- [x] **No new `// @ts-ignore`**: grepped the diff — zero.
- [x] **Comments narrate why, not what**: mostly compliant. See MIN-4 for the borderline case in the inline block comment. Acceptable.
- [x] **Imports follow project style**: spec imports match the existing e2e specs (`@playwright/test`, `@supabase/supabase-js`, `dotenv`). No relative imports needed in either file.
- [x] **New files placed in conventional folder**: `tests/e2e/rest-timer-auto-start.spec.ts` matches the existing `tests/e2e/*.spec.ts` convention.

## Design adherence

Implementation deviates **nowhere** from `design-v1.md`. The handler body matches the design's "Exact handler shape" snippet line-for-line. Test plan items 1, 2, 3, 4, 7, 10 from the design are covered as spec scenarios 1, 2, 3, 4, 5, 6. Test plan items 5, 6 (uncheck → no timer touch; re-check fires fresh) are folded into scenario 4 (re-check restarts). Test plan items 8 and 9 (cross-exercise stale / cross-exercise replace) are not covered as standalone scenarios — `implementation.md` doesn't justify the omission. However, both are direct consequences of the design's "silent no-op" rule (item 8 = no positive target → no `start()` call → leftover timer untouched) and `start()`'s unconditional overwrite (item 9, already tested by scenario 4's re-check), so the behaviors are exercised transitively. Calling out as a minor observation, not a deviation — the Tester can decide whether to add explicit coverage. No blocker, no major.

## Decision

**pass**

Reasoning:

- 0 blockers, 0 majors, 5 minors. All minors are spec-quality nits (locator tightening, defensive guards, comment style) — none affect correctness of the shipped behavior.
- Handler edit matches the design's exact snippet; all six verifier checks (`nextChecked` gate, `setsByExercise` lookup, `set_type === "working"` filter, `restByExercise > 0` guard, `start()` before `mutateAsync`, MIN-2 timing slack) confirmed at file:line.
- Existing add-set precedent (`:373-376`) untouched; bulk-check-all path (`:259-269`) untouched. No regression surface in unchanged code.
- Security clean: no service role in client bundle, no new tables/queries, RLS untouched.
- Style clean: no new `any`, no `// @ts-ignore`, comments OK.
- E2E spec is thorough, follows established conventions (admin client seed, sign-in helper, `purgeQueryCache`, `data-testid`-free locators), and applies the MIN-2 tolerance correctly across all `remainingSeconds` reads.

Recommendation: **invoke Tester**. Minors can be folded into the Tester's pass or deferred to a polish PR — none are load-bearing.
