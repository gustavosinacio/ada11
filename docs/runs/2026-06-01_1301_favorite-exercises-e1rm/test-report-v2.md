# Test report v2 — 2026-06-01_1301_favorite-exercises-e1rm

Testing: implementation against `design-v2.md` (final) + `review-v1.md` (PASS). Implement↔Test **round 2 of 2 — final confirming round**.

**Verdict: PASS.** The round-1 FAIL was a test-harness defect only (the shipped spec returned to the chart via `gotoProgress(page)` = `page.goto("/progress")`, a HARD browser reload that raced the persistence INSERT and intermittently rehydrated a stale empty favorites list from the `PersistQueryClientProvider` AsyncStorage cache). The feature itself was already PROVEN working in round 1 (golden path 3/3 via the real in-app path, RLS arm green, union pins the non-top-N favorite live, 12/12 regression). This round is a NARROW confirmation that the test-only nav fix made the spec deterministic — and it does: I ran the corrected spec myself (warm-up + `--repeat-each=3`) → **4/4 consecutive green, 0 flake.** The round-1 flake is closed.

## Environment
- Run-the-app: `npm run web` (Expo web dev server on `http://localhost:8081`), env from `.env.local`. Server pre-warmed (`/`, `/sign-in`, `/progress` all HTTP 200) before the e2e run; health re-checked HTTP 200 after the repeat run — no OOM cascade this round.
- e2e runner: Playwright (Chromium headless, workers:1 per `playwright.config.ts`).
- Authoritative e2e verdicts taken from `test-results/.last-run.json` + the parsed `PLAYWRIGHT_JSON_OUTPUT_NAME` report (the terminal reporter stream is mangled by the RTK passthrough layer — confirmed again this round: "Output truncated (3340 → 2000 chars)").
- Migration `0020_user_exercise_favorites.sql` confirmed LIVE: `user_exercise_favorites` head-select → HTTP 200.

## 1. Static gates (observed — all PASS)

| Gate | Command | Observed | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | `tsc --noEmit`, **0 errors** | PASS |
| Lint | `npm run lint` | **0 errors, 1 warning** — the pre-existing `.expo/types/router.d.ts` auto-generated warning, baseline-unchanged across every prior run | PASS |
| Unit | `npm run test:unit` | **477 passed (29 files)** — matches the expected 477/477 and round-1 baseline | PASS |

## 2. Corrected spec — ran it myself (PASS, deterministic 4/4)

I did NOT merely trust the Implementer's claim. Pre-warmed the dev server, then ran the corrected `tests/e2e/favorite-exercises-e1rm.spec.ts` twice:

**Warm-up pass (1 run):**
```
exit=0
test-results/.last-run.json: {"status":"passed","failedTests":[]}
```

**Determinism run (`--repeat-each=3`):**
```
exit=0
test-results/.last-run.json: {"status":"passed","failedTests":[]}
PLAYWRIGHT_JSON stats: {"expected":3,"skipped":0,"unexpected":0,"flaky":0, "duration":67814.57}
derived per-test outcomes -> expected(pass)=3 unexpected(fail)=0 flaky=0 skipped=0
```

**Combined: 4/4 consecutive green, 0 unexpected, 0 flaky** (warm-up 1/1 + repeat-each 3/3). The single spec covers the full golden path in one test: favorite an outside-top-5 canonical exercise (`Lat Pulldown`) on its detail page → its line/chip joins the "Estimated 1RM per exercise" chart; unfavorite → it leaves. Plus the canonical-gate split (star visible + `"Edit exercise"` Pencil absent) and the carry-in settle-gate before every `toHaveCount(0)`.

So per the spec's own internal scenarios the result is **3/3 sub-assertions, ×4 independent runs** — the previously RED test (`:255` `getByLabel("Toggle Lat Pulldown")` not visible after the hard reload) is now reliably GREEN.

## 3. Round-1 flake — closed (root cause vs fix confirmed)

- **Round-1 root cause** (from `test-report-v1.md` §4d, HIGH confidence): the two post-toggle returns used `gotoProgress(page)` = `page.goto("/progress")`, a HARD browser reload. This (a) raced the optimistic favorite's persistence INSERT (only ~107 ms between click and navigation; 0 INSERT POSTs in the failing trace) and (b) even with the POST forced to land, intermittently rehydrated a stale empty favorites list from the AsyncStorage-persisted query cache (30 s `staleTime` + persist-throttle race) without refetching. Flaky on the hard-reload path only; the real in-app path was reliable 3/3.
- **Round-2 fix** (in the spec, confirmed by reading the file): steps 5 and 6 now (i) `await Promise.all([page.waitForResponse(POST|DELETE /rest/v1/user_exercise_favorites, status<300), star.click()])` so the write lands server-side before navigation, and (ii) return to the chart via a CLIENT-SIDE bottom-tab tap — `page.getByText("Progress", { exact: true }).first().click()` + `page.waitForURL(/\/progress$/)` — instead of `page.goto`. No hard reload → the in-memory query cache (optimistic + `onSettled`-invalidated favorites) is preserved → no rehydration race. Mirrors the established convention at `auth.spec.ts:303`.
- The INITIAL `gotoProgress` on first landing (`:217`) and the two `page.goto(/exercises/<id>/progress)` deep-links to the detail page (`:229`, `:280`) were left untouched, as scoped — they are not post-toggle returns. The settle-gate before every NOT-present assertion was kept.

The 4/4-green outcome confirms the fix removed the flake: the spec is now deterministic. **Confidence HIGH** (4 independent runs, 0 flake; the fix targets exactly the two navigation calls round 1 root-caused).

## 4. Change is test-only (confirmed)

The only file modified since round 1 is `tests/e2e/favorite-exercises-e1rm.spec.ts`. Confirmed via mtime audit of all 12 feature/source/test/migration files: every production source, the migration, both unit-test files, and `tests/rls.test.ts` were last written at 13:36–13:40 (the original implementation pass); only the e2e spec was touched later (14:23:52 — the round-2 nav fix). No production/source/migration/other-test change in round 2.

```
13:36:08  supabase/migrations/0020_user_exercise_favorites.sql
13:36:21  src/db/schema.ts
13:36:35  src/db/types.ts
13:37:17  src/api/exercise-favorites.ts
13:37:34  src/hooks/use-exercise-favorites.ts
13:38:04  src/utils/e1rm-strength.ts
13:38:25  src/components/e1rm-strength-section.tsx
13:38:50  app/(app)/exercises/[id]/progress.tsx
13:40:01  tests/unit/e1rm-strength.test.ts
13:40:38  tests/unit/exercise-favorites-api.test.ts
13:40:54  tests/rls.test.ts
14:23:52  tests/e2e/favorite-exercises-e1rm.spec.ts   ← ONLY round-2 edit
```

## 5. Out-of-scope spec check
No other spec was run or needed this round (narrow confirmation per the brief). `chart-scroll-week-selector` was fixed earlier this session and is the only known prior flake; not re-run here as it is out of scope and unrelated to this feature. The round-1 regression sweep (`canonical-exercise-gating` 5/5 + `exercise-progress-ia` 4/4 + `e1rm-strength` 3/3 = 12/12) remains valid — no source touched since.

## Cross-platform
- **Web**: PASS — static gates (typecheck 0, lint 0/1, unit 477/477) + the corrected e2e 4/4 deterministic, on the live DB with migration 0020 applied.
- **iOS**: not tested. Reason: the change is RN-Web-compatible only — pure-TS presenter (`e1rm-strength.ts`), TanStack hooks (`use-exercise-favorites.ts`), PostgREST INSERT/DELETE/SELECT, a `lucide-react-native` `Star` in the existing header slot, `react-native-svg` `<MultiSeriesChart>` reused as-is; no native modules. Risk LOW per design R-5/R-6. The round-1 hard-reload-cache-staleness defect was web-`page.goto`-specific; native navigation is always client-side, so the underlying race does not manifest there.
- **Android**: not tested. Same reasoning as iOS.

## Test commands
- [x] `npm run typecheck` — `tsc --noEmit`, 0 errors.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning (`router.d.ts`).
- [x] `npm run test:unit` — 477 passed (29 files).
- [x] `npx playwright test tests/e2e/favorite-exercises-e1rm.spec.ts` (warm-up) — 1 passed, `{"status":"passed","failedTests":[]}`.
- [x] `npx playwright test tests/e2e/favorite-exercises-e1rm.spec.ts --repeat-each=3` — 3 passed, `{"expected":3,"unexpected":0,"flaky":0}`. **4/4 combined, 0 flake.**
- [x] Migration 0020 live — `user_exercise_favorites` head-select HTTP 200.

## Decision

**pass.**

Reasoning:
- The test-only nav fix made the spec deterministic: I ran it myself (warm-up + `--repeat-each=3`) → 4/4 consecutive green, 0 unexpected, 0 flaky. The round-1 flake (hard `page.goto` reload racing persistence + stale-cache rehydration) is closed.
- Static gates all green and matching round-1 baseline: typecheck 0 errors, lint 0/1 (pre-existing), unit 477/477.
- The change is test-only — confirmed by mtime audit; the only file edited since round 1 is `tests/e2e/favorite-exercises-e1rm.spec.ts`. No production source, migration, other test, or `docs/features.md` change.

### Final QA sign-off
The favorite-exercises → e1RM chart feature is shippable. Favoriting an exercise persists (POST 201, RLS-allowed row in `user_exercise_favorites`) and unfavoriting removes it (DELETE); a favorited non-top-N exercise (`Lat Pulldown`, single-session, outside the auto top-5) appears in the "Estimated 1RM per exercise" chart via the union, and leaves when unfavorited — now proven deterministically end-to-end through the real client-side navigation path (4/4 runs, 0 flake). Invariant F holds (with no favorites the chart is byte-for-byte the natural top-5, pinned by unit case 8 and the round-1 union probe `[A]`). The per-user `user_exercise_favorites` RLS arm is green (B cannot read/delete/spoof-insert A's favorites). No regression: the round-1 adjacent sweep (`canonical-exercise-gating` 5/5, `exercise-progress-ia` 4/4, `e1rm-strength` 3/3 = 12/12) remains valid since no source changed.

### Confidence / Risk
- Spec is now deterministic / flake closed: **Confidence HIGH** (4 independent runs, 0 flake; fix targets exactly the round-1 root cause). **Risk LOW** (test-only fix).
- Feature works end-to-end: **Confidence HIGH** (carried from round 1's live union probe + in-app golden path + RLS arm + 477/477 unit + 12/12 regression, none invalidated — no source changed). **Risk LOW**.
