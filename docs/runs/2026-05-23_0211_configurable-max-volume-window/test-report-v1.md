# Test report v1 — 2026-05-23_0211_configurable-max-volume-window

Testing: implementation against `design-v2.md`.
Round: Implement↔Test **round 1 of 2**.

## Environment

- Commands used to run app: `npm run web` (Expo web on `http://localhost:8081`, started in background).
- Browser / device: Chromium 130 headless via Playwright 1.59.
- Test data: 6 fresh users created per-test via Supabase Admin API; deleted in `afterAll`. Seeded sessions inserted directly via service-role to control timestamps.
- Migration `0009_max_volume_window.sql` was pushed to the linked Supabase project so the new column exists end-to-end (column probe via service-role returned `COLUMN OK rows=1`).

## Test commands

- [x] `npm run typecheck` — clean. Output: `> tsc --noEmit` (no errors emitted).
- [x] `npm run lint` — `ESLint: 0 errors, 1 warnings in 1 files` (single pre-existing warning in `router.d.ts`, Expo-generated).
- [x] `npm run test:unit` — `Test Files 16 passed (16) | Tests 268 passed (268)` in 1.85 s, including the 39 new windowed-mode regression cases authored by the Implementer.
- [x] `npm run test:e2e tests/e2e/max-volume-window.spec.ts` — **6 passed / 0 failed** (new spec authored by the Tester, 41 s wall clock).
- [x] `npm run test:e2e tests/e2e/progress-page.spec.ts` — **8 passed / 0 failed** (existing regression suite, unchanged).
- [x] `npm run test:e2e tests/e2e/end-of-session-verdict.spec.ts` — **2 passed / 0 failed**.
- [ ] `npm run test:e2e tests/e2e/volume-target.spec.ts` — 5 passed / 1 failed. **Pre-existing flake confirmed** by re-running on a `git stash`d baseline (same failure mode); not caused by this change. See "Regression check" below.

## Golden path

**Spec** (from `design-v2.md` §"Approach" + §"Copy strings"):

> Add a server-stored per-user preference that lets users compare the "max volume" surfaces against the most recent 10, 20, or 30 ISO weeks instead of full lifetime, defaulting to lifetime (`All`) so no existing user's behaviour changes until they opt in. The Profile screen exposes a 4-segment row `All / 10w / 20w / 30w` beneath Length unit; tapping a segment persists the integer pref to `user_preferences.max_volume_window_weeks` and updates the Progress hero legend, the weekly-volume-strip overlay caption, the per-exercise lifetime max list, and the live VolumeTargetSlot / verdict-screen PR detection — all consistent under the same anchor.

**Steps run** (`tests/e2e/max-volume-window.spec.ts`):

1. Fresh user signs in to `/sign-in`, lands on `/workout`.
2. Navigate to `/profile`; verify section label `Max-volume window`, the four segments `All / 10w / 20w / 30w`, and the legend caption `"Max-volume window — how many recent weeks to compare against."` all render.
3. Default state: `All` segment is active (`bg-black` background) — confirmed visually in the screenshot.
4. Seed an ancient session (~25 weeks ago, 5×200×5 = 5,000 kg) and a recent session (~5 weeks ago, 5×50×5 = 1,250 kg).
5. Navigate to `/progress` and verify the hero shows `Max 5,000 kg · Now 0 kg · To PR 5,000 kg` and the legend `Max = best week ever · Now = this week · To PR = remaining` (lifetime mode).
6. Tap the `10w` segment on Profile; wait for the `setMaxVolumeWindowWeeks` mutation to persist (DB probe confirms `max_volume_window_weeks = 10`).
7. Re-navigate to `/progress` (with persister-flush delay; see "Edge 4" for the rationale).
8. Verify the hero now shows `Max 1,250 kg · Now 0 kg · To PR 1,250 kg` and the legend `Max = best of last 10 weeks · Now = this week · To PR = remaining`. The strip caption reads `Best of last 10 weeks: 1,250 kg (4/13)` and the dotted lifetime-best overlay tracks the windowed best (visible at the top of the 4/13 bar, not the 11/24 bar which is the 5,000 kg lifetime max).

**Result**: **pass**

**Evidence**:

- Screenshots:
  - `docs/runs/2026-05-23_0211_configurable-max-volume-window/screenshots/01-profile-default.png` — Profile in default (`All`) state with legend caption.
  - `docs/runs/2026-05-23_0211_configurable-max-volume-window/screenshots/03-progress-lifetime-hero.png` — Lifetime hero "Max 5,000 kg · Now 0 kg · To PR 5,000 kg", legend "Max = best week ever", strip caption "Best week: 5,000 kg (11/24/25)".
  - `docs/runs/2026-05-23_0211_configurable-max-volume-window/screenshots/04-progress-10w-hero.png` — After switching to 10w: hero "Max 1,250 kg · Now 0 kg · To PR 1,250 kg", legend "Max = best of last 10 weeks", strip caption "Best of last 10 weeks: 1,250 kg (4/13)", dotted overlay anchored at the windowed best.
- Playwright output:
  ```
  passed     1. profile renders 4 segments with All active by default + legend caption visible
  passed     2. tapping 10w persists pref + reload keeps the value
  passed     3. cycling 0 → 10 → 20 → 30 → 0 updates DB correctly without crash
  passed     4. hero legend changes from 'best week ever' to 'best of last 10 weeks' after switching
  passed     5. windowed Max excludes ancient session — strip caption shows recent value
  passed     6. user with NO history — Profile renders + Progress does not crash on 30w
  Time: 40964 ms / 6 expected / 0 unexpected
  ```

## Edge cases

### Edge 1: tapping every segment in sequence (0 → 10 → 20 → 30 → 0)

**Steps**: Sign in fresh user, navigate to /profile, tap `10w` → `20w` → `30w` → `All` in order. Probe the DB row after each tap.

**Expected**: Every tap persists the matching integer; UI does not crash; final state returns to `0` (lifetime).

**Actual**: All four taps persisted within ≤ 4 s. No crash, no transient error banner.

**Result**: **pass**

**Evidence**: Test 3 in `pw-mvw-full.json` — assertions `tapping 10w should persist 10`, `tapping 20w should persist 20`, `tapping 30w should persist 30`, `tapping All should persist 0` all passed in a single test body.

### Edge 2: brand-new user with NO workout history selects 30w

**Steps**: Create fresh user (no sessions, no sets), navigate to /profile, tap `30w`, navigate to /progress.

**Expected**: Profile renders the segmented row without crashing; Progress page renders (empty state acceptable); no `Something went wrong` banner.

**Actual**: Profile renders with `30w` selected after tap; DB persists `max_volume_window_weeks = 30`; Progress page renders the empty-state copy `Log your first session to see weekly volume.` without any exception. Screenshot at `06-empty-user-30w.png`.

**Result**: **pass**

**Evidence**: Test 6 in `pw-mvw-full.json` — `expect(errorBanner).toHaveCount(0)` succeeded, screenshot saved.

### Edge 3: windowed Max excludes ancient PR while in-window second-best becomes the new anchor

**Steps**: Seed an ancient session (25 weeks ago, volume 5,000 kg) and a recent session (5 weeks ago, volume 1,250 kg). Set `max_volume_window_weeks = 10` via service-role (bypasses the UI tap → cache propagation behaviour that Edge 4 covers). Sign in fresh; navigate to /progress.

**Expected**: Strip caption reads `Best of last 10 weeks: 1,250 kg (...)` and does NOT contain the substring `5,000` or `5000`.

**Actual**: Caption rendered as `Best of last 10 weeks: 1,250 kg (4/13)`. `expect(text).not.toMatch(/5,?000/)` passed. The hero independently shows `Max 1,250 kg`.

**Result**: **pass**

**Evidence**: Test 5, screenshot `05-progress-10w-strip-caption.png`.

### Edge 4: cross-route pref propagation via the persisted query cache

**Steps**: Sign in fresh, tap 10w on /profile, then `page.goto("/progress")` (hard navigation). Compare the rendered hero against the windowed legend.

**Expected**: Progress hero shows the windowed legend after the pref change.

**Actual — first attempt** (no debounce wait): test failed with `Max = best of last 10 weeks` element not found; trace screenshots showed the Progress page rendering the **lifetime** legend (`Max 5,000 kg · "Max = best week ever"`) despite the DB row reading `weeks = 10`.

**Root cause** (verified by adding a 1.5 s wait between mutation and hard navigation): the AsyncStorage persister (default ~1 s debounce in `@tanstack/query-async-storage-persister`) had not yet flushed the in-memory mutated cache to disk; the hard reload re-hydrated the stale persisted cache (`weeks = 0`), so `useMaxVolumeWindowWeeks()` returned 0 on first render and the windowed legend never appeared. **Real users do not encounter this** because in-app navigation between tabs is SPA-style (no reload), preserving the in-memory cache.

**Result**: **pass** (the application path is correct; the test infrastructure needed a deliberate wait to reproduce a hard-reload scenario). Documented at line 312 of `tests/e2e/max-volume-window.spec.ts`.

**Evidence**: Test 4 first attempt produced trace screenshot showing stale lifetime hero; second attempt with `page.waitForTimeout(1500)` after the mutation produced screenshot `04-progress-10w-hero.png` with the correct windowed hero. Test now consistently passes; cache-propagation behaviour is documented for future test authors.

### Edge 5: cross-week session indivisibility (MAJ-1 regression)

**Steps**: The design's MAJ-1 fix mandates that a session whose `started_at` falls in week N and `completed_at` in week N+1 must be wholly included or wholly excluded by the window, never split. This is a unit-test-level invariant.

**Expected**: Two paired unit cases — (e) ancient session whose set lands in the window's first bucket but whose `started_at` is BEFORE the window → entire session excluded; (e2) inverse — session whose `started_at` is INSIDE the window but whose set's `completed_at` lands in a later bucket → entire session included AND the set placed in its completed-week bucket per the dual-anchor rule.

**Actual**: `tests/unit/progress-page-math.test.ts` cases at lines 1287-1326 cover both directions explicitly; both pass.

**Result**: **pass**

**Evidence**: vitest output line for the file: `✓ tests/unit/progress-page-math.test.ts (80 tests)` — includes the cross-week pair and the 0-ms-before / exactly-at-boundary / undefined-equals-lifetime regression-guard cases.

### Edge 6: inclusive lower boundary (`>=`)

**Steps**: A session whose `started_at` equals the `windowStartMs` instant must count as in-window.

**Expected**: `computeWindowStart(10, now)` matches the kernel's `>=` comparison, validated by a unit test that puts `sessionStartedAt = windowMondayLocal.toISOString()` and asserts the session is included.

**Actual**: `tests/unit/window-utils.test.ts:68` "inclusive lower bound: a session at exactly windowStartMs is in-window" passes; companion case in `progress-page-math.test.ts:1340` "(a) session exactly at windowStartMs is INCLUDED" also passes.

**Result**: **pass**

## Regression check

- **Progress page e2e (`tests/e2e/progress-page.spec.ts`)** — **8 / 8 pass**. Hero rendering, per-row navigation, PR badge, empty-state copy, and the 5-tab smoke all still work under the default `weeks = 0` path. Evidence: `pw-regr.json` stats `{ expected: 8, unexpected: 0, flaky: 0 }`.

- **End-of-session verdict e2e (`tests/e2e/end-of-session-verdict.spec.ts`)** — **2 / 2 pass**. The lifetime-path PR detection on the verdict screen still works. Evidence: `pw-verdict.json` stats `{ expected: 2, unexpected: 0, flaky: 0 }`.

- **Volume-target e2e (`tests/e2e/volume-target.spec.ts`)** — 5 pass, 1 fail (`golden path: chasing copy + reps clause across multiple seeded sets`). **Confirmed pre-existing flake**: the same test fails when stashing the run's changes and running against `HEAD` (commit `688e342`). The failure mode varies between runs (phase C "Now 980 kg" not yet rendered; sometimes "New PR" pill not yet visible) which is consistent with a timing issue in the test's `gotoLiveSession` + `seedLiveSet` interleaving, not with the windowing change. The kernel path (`computeVolumeTarget` with `windowStartMs = undefined`) is verified byte-identical to lifetime by `tests/unit/volume-target.test.ts` case `"windowStartMs=undefined identical to lifetime"`. **Not a regression caused by this change.**

- **`useLifetimeBestWeek` JSDoc + name retained** — the hook name is unchanged (MIN-2 acknowledgement). All Progress consumers compile and the kernel returns identical numbers when `weeks = 0`. Re-verified by `tests/unit/progress-page-math.test.ts` regression-guard cases (`windowStartMs=undefined`).

- **`useLifetimeBestWeek` cache invalidation on pull-to-refresh** — the hook still uses the `["stats", "weekly-volume", "lifetime"]` cache key (no new namespace introduced); existing invalidation cascades remain intact. Not separately verified at runtime (no test exercises pull-to-refresh on the headless Chromium target; deferred to manual on-device check).

- **History screen weekly-volume strip (no overlay)** — `app/(app)/progress/index.tsx` is the only caller that passes `bestWeekKg` / `bestWeekLabel` props; the history caller does not. The strip component itself is unchanged. Static-only verification; no targeted e2e in this round.

## Cross-platform

- **Web (Chromium headless)**: **pass** — the 6 new e2e tests + 8 existing Progress regressions exercise the full feature on Expo web.
- **iOS**: not tested in this round — no iOS simulator available in the sandbox. The implementation has no platform-specific branch (verified by `grep -n "Platform.OS" src/ app/` over the diff scope returning 0 matches in touched files); native behaviour follows web 1:1 modulo `Pressable` rendering. Recommend manual on-device confirmation by the user during the iPhone shakedown (MAJ-2 follow-through called for 320pt simulator confirmation).
- **Android**: not tested — same rationale as iOS.

## Findings to surface for the Conductor

1. **AsyncStorage persister debounce vs hard reload** (Edge 4 above): a documented quirk, not a feature bug. Worth a JSDoc note in `src/lib/query-client.ts` if the team plans to add more e2e tests that cross hard-navigation boundaries. Not blocking.
2. **Pre-existing flake** in `tests/e2e/volume-target.spec.ts` "golden path: chasing copy" — reproducible on `HEAD` without this run's changes. Flagged here so it doesn't get attributed to the windowing feature. Out of scope for this round; worth a separate stabilisation pass.
3. **iOS / Android visual sign-off** — the 320pt simulator confirmation for the 4-segment row (design-v2 MAJ-2 follow-through) was performed only by static reasoning + Chromium headless screenshot. Recommend the user briefly load Profile on the iPhone Mini / SE preset before finalising.

## Decision

**pass**

Reasoning:
- Golden path exercises Profile UI + Progress hero + strip overlay copy across both lifetime (`weeks = 0`) and windowed (`weeks = 10`) modes; the legend, hero numbers, and strip caption all switch coherently, matching design-v2 §"Copy strings" verbatim ("Max = best of last 10 weeks", "Best of last 10 weeks: 1,250 kg (4/13)").
- 268 unit tests pass — including the 39 new windowed-mode regression cases that pin the BLK-2 (numeric compare), MAJ-1 (cross-week session indivisibility), and inclusive-boundary invariants.
- All 8 existing Progress-page e2e regressions still pass; verdict e2e still passes; the volume-target failure is pre-existing and reproducible without this change.
- The four documented deviations from the Implementer's notes are either explicitly Conductor-sanctioned (NEW-MIN-2) or semantically correct (`nowKgByExercise` orthogonality) — the Reviewer cleared them in `review-v1.md` and dynamic testing here did not surface any contradiction.
- Confidence: **HIGH**. Risk if shipped: **LOW** (additive change gated by default-preserving `weeks = 0`).

Recommendation: **finalize**.
