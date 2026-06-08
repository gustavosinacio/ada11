# Test report v1 — 2026-06-04_1700_routine-preview-start

Testing: implementation against `design-v2.md` (Strong-style routine preview-then-start).

## DECISION: **pass**

All feature-related e2e pass (24/25 across the 3 specs; the single remaining FAIL is a
PROVEN pre-existing, feature-independent test from commit `0f68164`). Golden path + all 3 start
guards + the row-disabled-when-active regression behavior verified live. Guard-A teeth proven
RED→GREEN under a flip. Production code ends UNCHANGED (only the 3 e2e specs edited by me).
Recommendation: **finalize**.

---

## Environment
- App: Expo web dev server already running on `http://localhost:8081` (reused, never killed/restarted; `curl` → `UP`).
- Runner: Playwright (Chromium, headless) via `npx playwright test`, `playwright.config.ts` `webServer: null`, `workers: 1`, `fullyParallel: false`.
- Trustworthy counts: every run written directly to a file via `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/*.json` (the `rtk` shell wrapper truncates piped/redirected stdout to ~2000 chars; the env-var path bypasses it and was parsed from the on-disk JSON).
- Test data: fresh per-test users via service-role admin (`createConfirmedUser`), `pickCanonicalExercise(admin, "Bench Press")` (confirmed live in the canonical catalog — no throw).
- Static gates re-run by me: `tsc --noEmit` 0 errors · `expo lint` 0 errors · `vitest run` **515/515**.

---

## Confirmed root-cause of the original 12 failures (test-side, NOT a feature defect)

**Confidence HIGH** — confirmed by reading a real failing test error AND extracting the actual
navigated URL from the retained trace, not by trusting the hand-off diagnosis.

### Cause 1 — preview-route `$`-anchor vs the `?id=` query (the diagnosed cause — CONFIRMED)
The rewritten specs asserted `waitForURL(/\/routines\/[0-9a-f-]+\/preview$/)` (anchored `$` right
after `preview`). On RN-Web, expo-router navigates a **router.push** to a dynamic `[id]` route by
appending the id as a **query string**. The trace of the failing golden-path test shows the real URL:

```
localhost:8081/routines/367f59a3-ede3-4e3d-9713-9e853a3d2936/preview?id=367f59a3-ede3-4e3d-9713-9e853a3d2936
```

The `$` after `preview` never matches the `?id=…` suffix → every test routing through the preview
hit a 15 000 ms `waitForURL` timeout. **This is a test-regex bug; the route + nav work** (the URL is
correct, the screen renders).

A throwaway URL-shape probe (removed after use) recorded the per-navigation truth — the `?id=` suffix
is **router.push-only**, NOT present on `page.goto` or on the builder push:

| Navigation | Real URL | `?id=` appended |
|---|---|---|
| sign-in → `/workout` | `/workout` | no |
| **row click → preview** (router.push) | `/routines/{id}/preview?id={id}` | **YES** |
| Edit jump → builder (router.push) | `/routines/{id}` | no |
| `page.goto` → preview | `/routines/{id}/preview` | no |
| `page.goto` → builder | `/routines/{id}` | no |

**Fix applied:** every preview-route assertion `…/preview$/` → `…/preview(\?|$)/` (allow the optional
query). 12 sites: `routine-strong-builder.spec.ts` (217, 279, 330, 438, 508, 516, 624, 669, 707, 750,
775) + `crud.spec.ts:115`. The builder assertions (`…/routines/[0-9a-f-]+$/` at rsb:714, probe:242,
crud:122) were left as-is — the probe proved they carry **no** query, and they pass.

### Cause 2 — `getByLabel("Start workout")` does not resolve the `<Button>` (NEW — surfaced after Cause 1)
After the regex fix, the preview-routing tests progressed PAST the URL wait and then failed on
`getByLabel("Start workout")` with **"element(s) not found"**. This is the Reviewer's MIN-2 / T-2
hand-off materializing. A throwaway locator probe (removed) on the live preview proved:

```
getByLabel('Start workout')                       : count=0  visible=false   ← why the tests failed
getByText('Start workout')                        : count=1  visible=true
getByRole('button',{name:'Start workout'})        : count=1  visible=true
DOM chain of the leaf: DIV < BUTTON[role=button] < DIV < DIV < DIV
```

The preview's `<Button label="Start workout">` (`button.tsx`) renders a real `<button role="button">`
with the label as a **`<Text>` child** and NO explicit `accessibilityLabel`. On RN-Web, `getByLabel`
matches `aria-label`/`aria-labelledby` (count 0); the accessible name is computed from content, which
`getByRole("button",{name})` and `getByText` resolve (count 1, visible). **Every existing spec queries
`<Button>`s via `getByText`/`getByRole`, never `getByLabel`** — the spec author chose the wrong locator.
**The FEATURE is correct** (the button renders, is visible, is a real clickable `<button>`); the test
locator was wrong.

**Fix applied:** all 7 `getByLabel("Start workout")` → `getByRole("button", { name: "Start workout" })`
in `routine-strong-builder.spec.ts` (222, 282, 337, 441, 511, 639, 780).

---

## Final e2e counts

`npx playwright test routine-strong-builder probe-strong-unify crud` (authoritative JSON to file):

```
{"expected":24,"unexpected":1,"flaky":0}   →  24 PASS / 1 FAIL / 0 flaky
```

Progression across iterations: 13/12 (start) → 15/10 (regex fix) → 21/4 (getByRole fix) → 22/3
(flake fixes) → **24/1** (pre-existing setup fixes). The 1 remaining FAIL is pre-existing + unrelated
(see Regression).

---

## Golden path — verdicts (observed, not assumed)

**Spec:** tap a routine row → read-only preview of the exercises + per-set target reps/weight; "Start
workout" seeds + lands on `/workout/{id}`; "Edit this routine" → `/routines/{id}`; row tap does NOT
direct-start.

| # | Golden-path claim | Verdict | Evidence |
|---|---|---|---|
| G1 | Row tap → preview renders the exercise + per-set targets read-only | **PASS** | `rsb` test "preview: …shows the set targets" green; screenshot `screenshots/preview-golden.png`: "Bench Press / Chest · Barbell", a `# / Weight (kg) / Reps` table with rows `1:60,8  2:70,8  3:80,6`, working-set `•` badges, NO TextInput/trash/add (read-only). |
| G2 | "Start workout" seeds + lands on `/workout/{id}` | **PASS** | `rsb` golden-path test green: after Start, `waitForURL(/\/workout\/[0-9a-f-]+/)` + admin reads 3 seeded `sets` `[1,2,3]` weights `[60,70,80]`, all `working`, all uncompleted, no parent. |
| G3 | "Edit this routine" → `/routines/{id}` (builder) | **PASS** | `rsb` "header 'Edit this routine' jumps to the routine builder" green: `getByLabel("Edit this routine")` → `waitForURL(/\/routines\/[0-9a-f-]+$/)` → "Exercises" visible. |
| G4 | Row tap does NOT direct-start | **PASS** | `rsb` "tapping a routine row never direct-starts a session" green: after row click `toHaveURL(/preview(\?|$)/)` and sessions `count === 0` (no session created by opening the preview). |

---

## Edge cases / guards — verdicts

### Guard A (E4/P5) — Start-while-active routes to the EXISTING session — **PASS, teeth proven**
`rsb` "preview Guard A …" green. **Teeth proof (REQUIRED) — RED→GREEN under a flip:**
1. Temporarily disabled Guard A in `app/(app)/routines/[id]/preview.tsx` (commented the
   `if (active.data) { router.push(active.id); return; }` early-return).
2. Re-ran P5 → **RED** as designed:
   ```
   FAIL preview Guard A … TimeoutError: page.waitForURL … waiting for /workout/{existingId}
     navigated to "http://localhost:8081/workout/d8f7ba88-…?sessionId=d8f7ba88-…"
   ```
   With Guard A gone, `onStart` started a NEW session (`d8f7ba88…`, NOT the seeded `existingId`) and
   `router.replace`'d into it — exactly the failure mode P5 guards.
3. Reverted Guard A **byte-for-byte** (literal `if (active.data) {` + `router.push(\`/(app)/workout/${active.data.id}\`)` restored; 0 `TESTER-TEETH-FLIP` markers; 0 commented remnants).
4. Re-ran P5 → **GREEN** (`expected:1, unexpected:0`): URL lands on the pre-existing `existingId`,
   sessions `count === 1` (no 2nd session). Genuine teeth — not a false-green.

### Guard B (E10/test 3) — double-tap Start → exactly ONE session — **PASS**
`rsb` "idempotency: rapid double-tap …" green, 5/5 under `--repeat-each=5` (0 flaky). The failing
trace proves the production behavior is correct: **exactly 1 POST `/rest/v1/sessions` + 1 POST
`/rest/v1/sets`**, page reached `/workout/{id}` — the `pendingRoutineId` in-flight guard held.

### Guard C (E9/test 6) — seed-fail stays on preview, orphan empty session — **PASS**
`rsb` "hard fail: seed insert fault …" green, 3/3 under `--repeat-each=3`. With the seed POST faulted
500, the user stays on `/routines/{id}/preview(\?|$)`, exactly 1 orphan session exists, 0 sets written.

### Edge — dropset (test 2) — **PASS**
`rsb` "dropset variant …" green: live `sets` show the dropset's `parent_set_id` linked to the working set.

### Edge — edit-then-restart (test 5) — **PASS**
`rsb` "edit-then-restart …" green: removing a routine set after Start does NOT alter the active session's seeded sets.

### Edge — row-disabled-when-active (R-3, `probe-strong-unify:opacity-60`) — **PASS** (was a doubly-broken pre-existing test, fixed)
The feature-preserved behavior: while a session is active the row is dimmed (opacity-60) and its tap
is a no-op. Now green, 3/3 deterministic. (Two pre-existing test defects fixed — see Regression.)

---

## Two test-quality flakes owned + fixed (production correct; trace-confirmed)

Both surfaced after the locator fix; both proven by trace to be **test-timing only**, not feature defects.

1. **`waitForLoadState("networkidle")` hang (tests 3 + 6).** RN-Web keeps long-lived connections, so
   `networkidle` can never settle → the test burns the full 60 s timeout. **Fix:** replaced the
   `networkidle` waits with `expect.poll` on the admin session-count (deterministic — retries the DB
   until the expected state). This is a pre-existing pattern in the spec (`networkidle` was in the
   baseline test 3 at line 328), not introduced by the feature.
2. **Double-tap second `click()` hangs (test 3).** `Promise.all([click, click])` — when the FIRST
   click's `router.replace` detaches the button mid-navigation, the SECOND `.click()` auto-waits for
   actionability and hangs the full timeout (`Promise.all` never resolves). The trace proved exactly
   1 session POST regardless (Guard B fine). **Fix:** `noWaitAfter: true` on both clicks + a short
   `timeout: 2_000` + `.catch` on the second so it fails fast instead of hanging. 5/5 green after.

---

## Regression check

- **`routine-strong-builder.spec.ts`** (the feature's own + adjacent start-flow suite): **11/11** in
  isolation (golden, dropset, idempotency, soft-delete, edit-restart, seed-fail, duplicate, P1/P3/P4/P5).
- **`probe-strong-unify.spec.ts`** (IA + active-session + the row-disabled regression): **9/9** —
  including the 4-tab IA, `/routines`→`/workout` redirect, the active-session banner/guard, cold-reload,
  AND the row-opacity-60 + no-op-tap behavior this feature preserves.
- **`crud.spec.ts`**: **5/6** — the routine create/preview/Edit/delete flow (the feature's re-routed
  path) is green; the 1 FAIL is pre-existing + unrelated.

### The single remaining FAIL is PRE-EXISTING + feature-independent (PROVEN)
`crud.spec.ts › exercises: create custom exercise` — `getByPlaceholder("e.g. Barbell", { exact: true })`
times out.
- The Exercises **create form** (`app/(app)/exercises/new.tsx`) has only the placeholders
  `"e.g. Barbell Bench Press"` (name) + `"Cues, grip width, stance, etc."` (notes). There is **no**
  `"e.g. Barbell"` placeholder — commit **`0f68164 feat(exercises): equipment selector mirroring
  MuscleGroupPicker`** replaced the equipment text input with a selector. The test still expects the old
  text input → test drift from a PRIOR feature.
- `git diff 592dd51 -- app/(app)/exercises/new.tsx` = **empty** (this feature did not touch the form);
  `git diff 592dd51 -- tests/e2e/crud.spec.ts | grep -c 'e.g. Barbell'` = **0** (this feature did not
  touch line 169). It fails in isolation on the current tree AND was confirmed feature-independent.
- **Not fixed — out of scope** for routine-preview (it is an Exercises-form test from `0f68164`). Flagged
  for the Conductor as a latent pre-existing broken test.

### The 2 OTHER originally-failing pre-existing tests — PROVEN pre-existing, then fixed (in-scope)
Both failed at a SETUP step: `waitForURL(/\/workout$/)` after "Save routine". **Proven pre-existing via
a git-stash-to-baseline run** (stashed the 5 tracked feature files, ran on baseline → IDENTICAL failure,
`navigated to /routines/{id}`, then `git stash pop`). Root cause: `app/(app)/routines/new.tsx:42` does
`router.replace('/routines/{id}')` after creating a routine — it goes to the **builder**, not `/workout`
(intended app behavior; the test's `/workout$` assumption is stale). These are NOT feature- or
regex-caused.
- `crud.spec.ts › routines: create, see in list, …, delete` — **FIXED + green.** Corrected the setup
  nav (save → builder URL, then purge `ada11-query-cache` + `goto('/workout')`) so the row appears; same
  purge before the post-delete assertion so the soft-delete reflects (the persisted-cache rehydration
  class from prior runs). The feature's re-routed delete flow (row→preview→Edit→builder→delete) is now
  fully exercised.
- `probe-strong-unify.spec.ts › routine card with active session: opacity-60 …` — **FIXED + green
  (3/3).** Same setup nav fix. Plus a SECOND pre-existing defect in the same test: the `opacity-60`
  class is on the row's WRAPPING `<View>` while the `aria-label` is on the inner `<Pressable>`
  (`routine-list-item.tsx:28` vs `:33`), so `getComputedStyle(pressable).opacity` read the inner node's
  OWN opacity (`"1"`), not the dimmed wrapper. Fixed to read `el.parentElement`'s opacity (poll-settled).
  This is the SAME structure at baseline (label on Pressable, opacity on View) → the assertion was
  latent-broken; the feature only relabeled the Pressable. Now PROVES the row dims to 0.6 + the tap is a
  no-op (stays on `/workout$`) while a session is active.

---

## Cross-platform
- **Web**: PASS — tested via Playwright Chromium + the running Expo web build (the harness platform).
- **iOS**: not tested — web-only harness. Risk LOW: the feature is a new expo-router screen reusing
  existing data hooks + the `<Button>`/`<Pressable>` primitives that already ship on iOS; no native
  module, no new dependency, no migration (design R-6). The `?id=` query + `getByLabel`-vs-`getByRole`
  findings are RN-Web URL/DOM specifics; native nav is client-side and uses the same components.
- **Android**: not tested — same reasoning as iOS.

---

## Test commands
- [x] `npx tsc --noEmit` — **0 errors** (re-run after every spec + production-flip/revert edit).
- [x] `npx expo lint` — **0 errors** (exit 0).
- [x] `npx vitest run` — **515 passed / 0 failed** (baseline unchanged).
- [x] `npx playwright test routine-strong-builder probe-strong-unify crud` — **24 passed / 1 failed
  (pre-existing, unrelated) / 0 flaky**; key tests re-run with `--repeat-each` to prove flakes closed
  (test 3: 5/5; test 6: 3/3; opacity-60: 3/3; Guard-A RED→GREEN).

---

## Production-code-unchanged confirmation
- Files I (Tester) changed: **only** `tests/e2e/routine-strong-builder.spec.ts`,
  `tests/e2e/probe-strong-unify.spec.ts`, `tests/e2e/crud.spec.ts`.
- `git diff --stat 592dd51` of production = only the feature's own edits
  (`app/(app)/workout/index.tsx`, `src/components/routine-list-item.tsx`); the 2 new feature files
  (`preview.tsx`, `read-only-routine-exercise-card.tsx`) untracked as-implemented.
- Guard-A teeth flip **reverted byte-for-byte**: `grep -Fc 'if (active.data) {' preview.tsx` = 1;
  0 `TESTER-TEETH-FLIP` markers anywhere; 0 leftover `_probe-*.spec.ts` files.

---

## Untestable / not-covered (disclosed, not marked pass)
- iOS / Android (web-only harness) — Risk LOW, reasoning above.
- `crud › create custom exercise` — pre-existing, feature-independent (form drift from `0f68164`); NOT
  marked pass, NOT fixed (out of scope). Flagged for the Conductor.
- E5 (empty-routine Start parity) and E6 (soft-deleted underlying exercise) — verified by construction
  in the design/review (preview reuses the editor's filtered join + Start-allowed-on-empty), not driven
  through a dedicated e2e this round. Coverage residual, LOW risk (same hooks/flow).

## Decision
**pass** — golden path + all 3 guards + the preserved row-disabled regression behavior verified live;
Guard-A teeth proven RED→GREEN with a byte-for-byte revert; the original 12 failures root-caused to two
test-side bugs (preview `?id=` regex + `getByLabel`-vs-`getByRole` Button handle) and fixed; 3 flaky/
pre-existing tests owned and fixed within scope; production code unchanged. The single remaining e2e
FAIL is a proven pre-existing, feature-independent test. Recommend **finalize**.
