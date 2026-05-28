# Regression report — 2026-05-27_2144_navbar-tab-pop-to-root

## Environment
- Build: Expo Router **web** SPA (`web.output: single`), dev server `npm run web` at `http://localhost:8081` (confirmed UP — `fetch` → 200). Web export built separately to `/tmp/ada11-web-export`.
- Test data: throwaway confirmed users seeded per-test via the e2e admin pattern (`createConfirmedUser` + `admin.auth.admin`), canonical "Bench Press" exercise, seeded routine + sessions (live for Path C, ended for the History spot-check). Playwright `workers: 1` (config default), Chromium headless.
- Fix under test: working-tree-only edits (uncommitted) at `app/(app)/_layout.tsx` + `tests/e2e/bottom-tab-home-link.spec.ts`. Baseline commit `2d5e678` (verified `git rev-parse HEAD`). Working tree contains only those two code files modified (the modified PNGs belong to an unrelated run `2026-05-23_0211` and are not part of this fix).

## Automated checks
| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **pass** (exit 0, 0 errors) |
| Lint | `npm run lint` | **pass** (exit 0; 0 errors, 1 warning in auto-generated `.expo/types/router.d.ts` — pre-existing, baseline-unchanged; 0/0 in the two edited files) |
| Unit tests | `npm run test:unit` | **384 pass / 0 fail** (24 files) |
| Web export build | `npx expo export --platform web` | **pass** (exit 0; Metro bundled 3143 modules, `Exported: /tmp/ada11-web-export`; only `error` token in log is the `error.*.png` routing-boundary asset, not a build error) |

**Note on the build gate**: the Implementer did NOT run `expo export` (dev server had crashed under load). I ran it — it is the gate that catches bundler/compiler issues the typechecker misses. The new `router` / `useSegments` / `type Href` imports and the `TAB_ROOTS` literal map all bundle cleanly. The typecheck pass is the authoritative confirmation that `TAB_ROOTS: Record<string, Href>` is valid under `typedRoutes: true` — an invalid route literal would have failed `tsc`.

## Replay of original reproduction
**Steps from `repro.md`** (Paths B and C were the failing paths; A was the working boundary):
1. **Path B (deep-link / refresh)** — sign in → `page.goto("/(app)/exercises/<id>/progress")` → re-tap focused **Exercises** tab → expect URL `/exercises` + "New exercise" list-root marker.
2. **Path C (cross-tab from live workout)** — seed live session → open `/(app)/workout/<sid>` → tap exercise name → `/exercises/<id>/progress?...&backHref=...` → re-tap **Exercises** → expect `/exercises`.
3. **Path A (must NOT regress)** — same-tab click-through (list → exercise → progress) → re-tap **Exercises** → `/exercises`.

These are locked as cases 4 (B), 5 (C), and 1 (A) in `bottom-tab-home-link.spec.ts`.

**Result**: **bug no longer reproduces.** Path B and Path C now pop to `/exercises` (was: silent no-op). Path A unregressed.

**Evidence** (`bottom-tab-home-link.spec.ts`, JSON reporter → `/tmp/pw-bothome.json`, parsed):
```
PASS passed 4.1s case 1: re-tap on already-focused tab pops nested → root            [Path A — fast path, no-regress]
PASS passed 3.1s case 2: cross-tab tap navigates normally + browser-back preserves backBehavior=history
PASS passed 2.6s case 3: re-tap on a leaf tab (Profile, no child Stack) is a harmless no-op
PASS passed 3.1s case 4: re-tap pops to root after a deep-link arrival (Path B PartialState)   [BUG GONE]
PASS passed 5.6s case 5: re-tap pops to root after cross-tab arrival from a live workout (Path C) [BUG GONE]
--- stats: expected=5 unexpected=0 flaky=0 skipped=0
```
(Run twice — `BOTHOME_EXIT=0` on the first run too — identical, deterministic.) Cases 4 and 5 were confirmed RED on the pre-fix source by the Implementer (`implementation.md:43`), so they genuinely exercise the bug rather than passing vacuously.

## Adjacent regression checks
Picked the touchpoints that share code paths with the fix: the changed nav button serves every tab, and the fix sits next to the `backHref` cross-tab progress flow.

- **`bottom-tab-home-link.spec.ts` case 2 (cross-tab + `backBehavior="history"` browser-back invariant)**: **pass** — cross-tab tap navigates and `page.goBack()` returns to the source deep route. This is the load-bearing invariant the `navigate`-not-`replace` mechanism was chosen to protect; it holds.
- **`bottom-tab-home-link.spec.ts` case 3 (Profile leaf no-op)**: **pass** — at-root/leaf re-tap stays on `/profile`, no spurious navigation. The segments gate (`length > 2` false) correctly falls through to the default no-op.
- **`exercise-progress-back-nav.spec.ts` (the recent `backHref` header-back change — adjacent flow flagged in the report)**: **pass** (1/1) — `from a live session, header back returns to the session — not the exercises list`. The `backHref` flow the diagnosis flagged as a red herring is confirmed unaffected by the fix. Evidence (`/tmp/pw-adjacent.json`):
  ```
  PASS passed 5.5s exercise-progress-back-nav :: header back returns to the session, not the exercises list
  ```
- **`exercise-progress-ia.spec.ts` (shares the `progress.tsx` screen + cross-tab nav surface)**: **pass** (5/5) — golden+delete IA flow, finish-session cache re-entry, live-workout name-tap → progress → back, history-detail name-tap → progress → back.
  ```
  PASS exercise-progress-ia :: golden + delete: list → progress → pencil → edit → save → progress; delete lands on list
  PASS exercise-progress-ia :: cache: finishing a session does not break the progress screen on re-entry
  PASS exercise-progress-ia :: name tap in live workout block routes to /exercises/{id}/progress and back
  PASS exercise-progress-ia :: name tap in history detail block routes to /exercises/{id}/progress and back to detail
  --- adjacent stats: expected=5 unexpected=0 flaky=0
  ```
- **History deep-link generalization spot-check (ad-hoc, tab-agnostic claim)**: **pass** — deep-link onto `/history/<sessionId>` → re-tap focused **History** tab → URL pops to `/history`. Confirms the single `tabBarButton` fix generalises beyond Exercises (the segments gate `segments[1] === route.name` is tab-agnostic). Driver: `tests/e2e/_adhoc-history-deeplink-popcheck.spec.ts` (created, run, then **deleted** — not left in the tree; working tree re-verified clean afterward). Evidence (`/tmp/pw-history.json`):
  ```
  PASS passed 5.9s HISTORY deep-link re-tap pops to /history (generalization spot-check)
  --- stats: expected=1 unexpected=0 flaky=0
  ```

**Environmental noise filtered**: none observed this run. The Supabase auth rate-limit / dev-server-crash failure modes the Implementer warned about (heavy parallel e2e load) did NOT occur — all setup phases (`createConfirmedUser`, `signInAndLand`) succeeded, dev server stayed healthy (paced runs, one spec file at a time, `workers: 1`). Zero flaky across all 12 e2e tests. No `createConfirmedUser: Internal server error` and no setup-phase `waitForURL` timeouts.

## Manual verification checklist (native — cannot test locally)
Web is the authoritative surface for this bug and is fully covered above. **Native (iOS / Android) is NOT verifiable in this environment (no device/simulator).** `useSegments` / `router.navigate` are platform-agnostic expo-router primitives, so the same logic should apply, but it is unverified. Action for the user, if a device/simulator is handy:
1. Cold-start (or deep-link) the app directly onto an exercise progress screen (`/exercises/<id>/progress`).
2. Tap the **Exercises** bottom-tab icon (the already-focused tab).
3. Confirm it navigates to the exercises list (`/exercises`), not a no-op.
4. Repeat for a History detail deep-link → re-tap History → should land on the history list.
5. Confirm a normal cross-tab tap (e.g. Workout → History) and the OS back gesture still behave (native analogue of the case-2 `backBehavior="history"` invariant).

## Code-level confirmation
| File | Before | After |
|---|---|---|
| `app/(app)/_layout.tsx:131-147` | focused-re-tap had ONLY the keyed fast path (`childState.type === "stack"` → `popToTop({ target: childState.key })`); on PartialState it fell straight through to `onPress?.(e)` no-op | keyed fast path **unchanged**; new `else` fallback `:148-184` — gates on `useSegments()` (`segments[0]==="(app)" && segments[1]===route.name && segments.length>2`) and pops via `router.navigate(TAB_ROOTS[route.name])` |
| `app/(app)/_layout.tsx:99-105` | (absent) | new module-scope `TAB_ROOTS: Record<string, Href>` for the 5 visible tabs (typed-route literals) |
| `app/(app)/_layout.tsx:9,116` | `import { Tabs } from "expo-router"` | `import { Tabs, router, useSegments, type Href }`; `const segments = useSegments()` in the button |
| `tests/e2e/bottom-tab-home-link.spec.ts` | 3 cases (Path A + cross-tab + Profile) | +case 4 (Path B deep-link) +case 5 (Path C cross-tab live); cases 1-3 unchanged |

**Mechanism-deviation note (verified, not a defect)**: the shipped code does NOT use the fix-plan's primary `router.dismissAll()`/`canDismiss()` nor the literal secondary (gate on child-Stack `routes`). The Implementer runtime-disproved both on web — on Path C the focused tab's child state is `undefined` and indistinguishable from a genuine at-root cross-tab arrival, so any child-Stack-based gate is unsound. The pivot to a `useSegments()` URL gate is sound (the URL is the reliable discriminator) and is fully runtime-verified by cases 4/5 + the History spot-check above. The plan explicitly authorised a documented deviation here (MEDIUM-confidence `TODO`), and constraints were respected: no `props.onPress`/`href` routing, no `router.replace` (case-2 browser-back invariant green).

**Stale-comment nit (non-blocking, does not affect behaviour)**: the spec file-header (`bottom-tab-home-link.spec.ts:24-31`) and the case-4/5 inline comments still say the fallback is `router.dismissAll()`, but the shipped mechanism is `router.navigate(TAB_ROOTS[...])` gated on `useSegments()`. Comments don't execute and tests pass, so this is not a regression — flagging for the Conductor to optionally correct the comment before commit so the lock-in test docs match the code.

## Out-of-scope confirmation
Items intentionally left untouched per `fix-plan.md > Out of scope` — verified not regressed:
- **Scroll-to-top on re-tap** — not implemented; no `useScrollToTop`. Not touched.
- **Header-tap-to-pop** — not touched.
- **Hidden-tab parity** (`routines`, `measurements`, `admin`, all `href: null`) — confirmed absent from `TAB_ROOTS` by design (no tab-bar button → no re-tap event possible). `_layout.tsx:220,245,261` still `href: null`, unchanged.
- **Refactor of `HomeLinkTabBarButton` for testability** — not done; the live-stack fast path is byte-for-byte unchanged.
- **Security**: n/a — `diagnosis.md:71-75` flagged `security_relevant: no` (carried forward in `fix-plan.md:3`); the security checklist is skipped per contract. Confirmatory sanity scan of the production diff: zero auth / secret / credential / network / raw-query / eval tokens introduced — the only added code is client-side navigation (`router.navigate`, `useSegments`) and a static route-literal map (`TAB_ROOTS`). `(app)` remains auth-gated upstream (`app/_layout.tsx`, unchanged).

No "while I'm here" creep: the production change is confined to the additive `else` branch + the `TAB_ROOTS` constant + 3 import tokens.

## Decision

**pass**

Reasoning:
- All four static gates green: typecheck (incl. `TAB_ROOTS` under `typedRoutes: true`), lint, 384/384 unit, and the web-export build the Implementer had not run.
- Original reproduction no longer fires: Path B (deep-link, the primary repro) and Path C (cross-tab from live workout) now pop to `/exercises`; Path A (the working boundary) is unregressed. Cases 4/5 were RED pre-fix, so they genuinely lock the bug.
- Adjacent surfaces clean: cross-tab browser-back invariant (case 2), Profile leaf no-op (case 3), the `backHref` header-back flow, and the full `exercise-progress-ia` suite all pass; the tab-agnostic generalization holds on History.
- Zero flaky / zero environmental noise this run.
- **Limitations**: native is unverified (web-only environment) — see the manual checklist. One non-blocking stale-comment nit in the test-file header/inline comments (says `dismissAll`, code uses `navigate`); recommend a comment fix before commit, not a code change.

## Post-deploy manual verification (filled in after user confirms)
- Verified by user on <environment>: <pass | fail>.
- Confirmation timestamp (BRT): <YYYY-MM-DD HH:mm>.
- User statement: "<verbatim>"
