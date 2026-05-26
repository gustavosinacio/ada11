# Review v1 — 2026-05-26_0307_bottom-tab-home-link

Reviewing: the diff for the implementation against `design-v2.md` (Validator-approved `go` at `validation-v2.md:55-66`).

## Diff scope
- Diff command: `git diff 77029d4cd609631877a5870b91dc16e4e1b7bf4c -- 'app/(app)/_layout.tsx' 'tests/e2e/bottom-tab-home-link.spec.ts'`
- Files changed: 1 edited (`app/(app)/_layout.tsx`), 1 new (`tests/e2e/bottom-tab-home-link.spec.ts`)
- Lines: +43 / -1 in `_layout.tsx`; +209 in the new spec.
- Sanity gate: `npm run typecheck` re-run during review — 0 errors. Lint not re-run (Implementer reported clean + 1 pre-existing baseline warning).

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| `_layout.tsx` adds `screenListeners.tabPress` with guards focused + childState present + `type === "stack"` + `index > 0` + `key` is string; dispatches `popToTop` with `target: childState.key` | **yes** | `app/(app)/_layout.tsx:31-68`. Guard order and conjuncts match design-v2.md `Contratos > Listener body` (`:159-178`) verbatim, plus the 5th guard (deviation 2). |
| `import { StackActions } from "@react-navigation/native"` at top of file | **yes** | `app/(app)/_layout.tsx:1`. Re-export chain verified: `@react-navigation/native/src/index.tsx:17` re-exports `@react-navigation/core` which (per validation-v2.md:9) re-exports `@react-navigation/routers` where `StackActions` lives. Type-safe under strict mode. |
| `backBehavior="history"` + load-bearing comment block (lines 17-26 pre-edit) preserved | **yes** | `app/(app)/_layout.tsx:18-29` — comment block and `backBehavior="history"` prop untouched. |
| All 5 visible `<Tabs.Screen>` blocks and 2 hidden (`href: null`) tabs untouched | **yes** | `app/(app)/_layout.tsx:70-112` — workout, routines (`href: null`), exercises, history, progress, measurements (`href: null`), profile, in the original order. No options changed. |
| New e2e spec at `tests/e2e/bottom-tab-home-link.spec.ts` with three cases (re-tap pop, cross-tab + goBack, leaf no-op) | **yes** | Files matches `git status` (`?? tests/e2e/bottom-tab-home-link.spec.ts`). Cases at `:94-135`, `:137-173`, `:175-207`. |
| All tab-label clicks use `.first()` per sibling precedent | **yes** | Cross-checked against 8 sibling specs (auth, crud, exercise-progress-ia, measurements, probe-strong-unify, progress-page, routines-add-exercise-race, routine-strong-builder): every `getByText("Exercises"\|"History"\|"Profile")` in the e2e suite uses `.first()`. New spec at `:105, :127, :158, :184, :196` all follow this. |
| `getByLabel("New exercise")` is the stable list-root marker (deviation 4) | **yes** | `app/(app)/exercises/index.tsx:22` — `accessibilityLabel="New exercise"` is the only such label in source. Same selector used at `tests/e2e/soft-deleted-exercises-in-history.spec.ts:103` and `tests/e2e/crud.spec.ts:145`. |
| `Sign out` exact text is Profile content marker (deviation 5) | **yes** | `app/(app)/profile.tsx:219` — `<Button label="Sign out" ... />` is the only "Sign out" occurrence in `app/` + `src/`. Auth spec uses the same selector at `tests/e2e/auth.spec.ts:307`. |
| Static gates: typecheck 0, lint 0 + 1 pre-existing, unit 376/376 | **yes (typecheck re-verified)** | `npm run typecheck` re-run: 0 errors. Lint/unit not re-run (out of static-review scope; Implementer's report aligns with prior baseline). |
| No new `any`, no new `// @ts-ignore`, no new `as` casts in changed files | **yes** | Grep on the two files: zero `any`, zero `@ts-ignore`, zero `as` casts. The only `as` in the spec is `import * as dotenv` (standard CJS interop, identical to 13 other specs in the suite). |
| First-party precedent for `@react-navigation/native` already exists (deviation 1) | **yes** | `app/_layout.tsx:3` imports `{ DarkTheme, DefaultTheme, ThemeProvider }` from `@react-navigation/native`. Implementer's claim that MIN-NEW-2's "greenfield" premise is moot is correct. |
| Dispatch shape matches expo-router fork's own use | **yes** | `node_modules/expo-router/build/fork/native-stack/createNativeStackNavigator.js:62-65` uses `{...StackActions.popToTop(), target: state.key}` — same shape. |

## Deviation audit (each deviation declared in `implementation.md > Deviations from design`)

| # | Deviation | Justified? | Reviewer note |
|---|---|---|---|
| 1 | Import `StackActions` from `@react-navigation/native` (not `@react-navigation/routers` per Validator MIN-NEW-2 advisory) | **yes** | `@react-navigation/native` is already first-party at `app/_layout.tsx:3`. The Validator's MIN-NEW-2 was explicitly opt-in ("either choice works"). Matches design-v2's own `Contratos` snippet at `:130`. |
| 2 | Added 5th guard `typeof childState.key === "string"` | **yes — robustness, not change in behaviour** | `PartialState<NavigationState>` (verified `node_modules/@react-navigation/routers/src/types.tsx`) allows `key?: string`. Dispatching with `target: undefined` would route to the Tabs navigator (which doesn't handle POP_TO_TOP) — same silent-drop failure mode that motivated `target:` in the first place. The extra conjunct short-circuits cheaply on a path that's already short-circuit-heavy. Addresses Validator MIN-NEW-3 (`validation-v2.md:45`) by code-hardening rather than prose annotation — equivalent intent, stronger artifact. |
| 3 | E2E Case 1 deep-links to `/exercises/<id>/progress` (not `/exercises/<id>`) | **yes** | Verified at `app/(app)/exercises/index.tsx:64` — row tap goes to `/progress`. There is no UI affordance to reach `/exercises/<id>` directly (that route is the edit screen reached via `headerRight` pencil from the progress screen). Both push frames onto the same child Stack and exercise the same `childState.index > 0` guard. Using `page.goto(...)` deep-link rather than `getByText` row-click matches `tests/e2e/exercise-session-row-list.spec.ts:200, 257, 297` precedent and removes a flake source (FlatList paint). |
| 4 | E2E Case 1 uses `getByLabel("New exercise")` as list-root marker (no "search field placeholder" exists) | **yes** | Confirmed: `app/(app)/exercises/index.tsx` has FlatList + ActivityIndicator + a "+" Pressable with `accessibilityLabel="New exercise"`. No search input. The design's prose at `:285` was loose — implementer picked the only stable selector that exists. |
| 5 | Case 3 uses `Sign out` (exact) as Profile marker | **yes** | The design said "profile content still visible" without naming a selector. `Sign out` is the only Profile-unique text marker; selector matches `tests/e2e/auth.spec.ts:307` precedent. |

All five deviations are justified, evidence-cited, and behaviour-equivalent to the design.

## Issues

### Blockers

None.

### Majors

None.

### Minors

- **[MIN-1]** `tests/e2e/bottom-tab-home-link.spec.ts:120-123, 151-154, 166-169`: the `waitForURL` regex `/\/exercises\/${exercise.id}\/progress$/` ends with `$` and would not match a URL with a `?id=<uuid>` query suffix. Sibling spec `tests/e2e/exercise-progress-ia.spec.ts:256-261` documents that expo-router's web linking layer appends `?id=<uuid>` when navigating into a dynamic `[id]` route **from outside the exercises stack**, and uses `(\?.*)?$` to tolerate. For Case 1, the suffix is unlikely on direct `page.goto("/(app)/exercises/<id>/progress")` (no NAVIGATE-from-outside path). For Case 2 the goBack restores the URL stored in browser history — if expo-router wrote the suffix on the inbound nav, `goBack` returns to the suffixed form. This is a flake risk on web. Fix (advisory): change the three progress-route regexes to `new RegExp(\`/exercises/${exercise.id}/progress(\\?.*)?$\`)`. Optional (Implementer can defer to Tester if the test passes empirically on the first run).

- **[MIN-2]** `tests/e2e/bottom-tab-home-link.spec.ts:199`: the bare 300ms `waitForTimeout` after the second Profile tap is a magic-number sleep. Sibling specs use the pattern but always at >=500ms (`tests/e2e/auto-fill-placeholder-on-check.spec.ts` uses 500-800ms consistently; `tests/e2e/rest-timer-auto-start.spec.ts` uses 500-5000ms). 300ms is below every existing precedent. The implementer's reasoning is sound (let any erroneous dispatch propagate before reading `page.url()`) but the magnitude has no precedent floor. Fix (advisory): bump to 500ms for parity with the suite's existing settle convention, or replace with a non-time-based assertion (e.g. `await expect(page).toHaveURL(/\/profile$/, { timeout: 1_000 })`).

- **[MIN-3]** `app/(app)/_layout.tsx:32-48`: the 17-line comment block is mostly excellent (explains *why* — the dispatch routing via `target`, the cross-platform idempotency, the run reference) but lines 41-43 narrate *what* the snippet does ("This is the same shape expo-router's forked native-stack uses internally") with a `node_modules/...` path. Per the reviewer-feedback rubric "comments narrate why, not what", citing a `node_modules/` path is fragile (version pin will drift). Fix (advisory): keep the rationale but drop the brittle absolute path or pin it via a `// see expo-router fork's createNativeStackNavigator tabPress effect` reference. Not load-bearing; the run-doc link at line 35 already provides the authoritative trail.

## Security checklist

- [x] **RLS / authorization**: this is a pure client-side navigation change. No DB query added or modified. The new spec uses the admin client only for setup (`createConfirmedUser`, `pickCanonicalExercise`) — same pattern as 11 other specs. No user-typed PostgREST query; no migration. N/A in substance.
- [x] **Service-role key**: `SUPABASE_SERVICE_ROLE_KEY` is only read in the spec file (`tests/e2e/bottom-tab-home-link.spec.ts:40`), never in shipped code (`app/`/`src/`). The spec is excluded from the React Native bundle per the standard test directory convention. Matches existing precedent (`tests/e2e/exercise-note.spec.ts`, every other e2e).
- [x] **Input handling**: no raw SQL / `rpc` calls; no shell exec.
- [x] **Public env vars**: no new `EXPO_PUBLIC_*` introduced. The two read in the spec (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) are pre-existing, intended-public values.
- [x] **Auth surface**: no auth path change. The `(app)` group remains gated by `app/_layout.tsx:14-35`. Listener fires only inside the authenticated tab navigator.

## Style / convention checklist

- [x] **No new `any`**: grep confirms zero `any` in the two changed files.
- [x] **No new `// @ts-ignore`**: zero in the two changed files.
- [x] **No new `as` casts**: zero in the two changed files (the spec has `import * as dotenv`, standard CJS interop, not a type cast).
- [x] **Comments narrate `why` not `what`**: mostly yes (see MIN-3 for the one weak line). The listener-block comment explains the load-bearing rationale (Tabs-vs-Stack routing, preventDefault scoping, fork interoperability).
- [x] **Imports follow project style**: package imports first (`@react-navigation/native`, `expo-router`, `lucide-react-native`, `react-native`), then relative aliases (`~/components/...`). Matches the pre-edit shape and the project convention across `app/`.
- [x] **New file in conventional folder**: `tests/e2e/bottom-tab-home-link.spec.ts` follows the kebab-case + `.spec.ts` convention of the 30+ siblings in the same directory. Helper imports relative; package imports first.
- [x] **No stray `console.log` / debug**: grep clean.

## Test-quality scrutiny (per reviewer.md feedback lesson — extend rigor to test diff)

Walking each new e2e assertion against sibling precedents:

| Assertion | Precedent | Verdict |
|---|---|---|
| `page.getByText("Exercises", { exact: true }).first().click()` | 8 sibling specs (auth, crud, exercise-progress-ia, measurements, probe-strong-unify, progress-page, routines-add-exercise-race, routine-strong-builder) | Matches. `.first()` is the established defense against strict-mode locator collision when the tab label is also rendered elsewhere on the page. |
| `page.getByText("History"\|"Profile", { exact: true }).first().click()` | 8 and 9 sibling specs respectively | Matches. |
| `page.getByLabel("New exercise").first()` | `soft-deleted-exercises-in-history.spec.ts:103` (no `.first()`), `crud.spec.ts:145` (no `.first()`) | Slightly more defensive than precedent (which uses bare `getByLabel`). Defensible — no harm; the `+` button is unique today but `.first()` future-proofs. |
| `page.getByText("Sign out", { exact: true }).first()` | `auth.spec.ts:307` (no `.first()`) | Slightly more defensive than precedent. Same future-proofing rationale. |
| `page.waitForURL(/\/exercises\/${id}\/progress$/)` | `exercise-progress-ia.spec.ts:259` uses `(\?.*)?$`; `exercise-session-row-list.spec.ts` uses no trailing `$` | **Diverges** — see MIN-1. |
| `page.waitForURL(/\/history$/)` after cross-tab click | `crud.spec.ts:208`, `exercise-progress-ia.spec.ts:315`, `measurements.spec.ts:334` (all match `/history` without query suffix) | Matches. History root is not a dynamic `[id]` route, so no `?id=` concern. |
| `page.waitForURL(/\/profile$/)` after tab click | `auth.spec.ts:303` matches `/profile/` (no `$`); `measurements.spec.ts:75` and `:337` similar | Slightly tighter than precedent but consistent. |
| `await page.goBack(); waitForURL(...)` after cross-tab nav | `exercise-progress-ia.spec.ts:264` (with `?id=` tolerance regex); `week-drill-down.spec.ts:448` (`toHaveURL` not `waitForURL`); `measurements.spec.ts:138` (no waitForURL) | Sound pattern. The regex tolerance is the same MIN-1 concern. |
| `await page.waitForTimeout(300)` between two synchronous clicks | All sibling specs use >=500ms | **Diverges** — see MIN-2. |
| `createConfirmedUser` + `signInAndLand` + `deleteUserSafe` fixture | `exercise-note.spec.ts:46-89` (cited in design as the source) | Matches verbatim. The afterAll cleanup via `Set<string>` + Promise.all is identical to the established pattern. |

No PostgREST-shape assertion in this spec (no numeric/string coercion question per the reviewer-feedback lesson). The route-regex divergence (MIN-1) is the equivalent of the strict-mode `.first()` lesson: a sibling-precedent reflex that flags risk without proving it (test may pass empirically on first run, but the regex is tighter than necessary).

## Behavioural correctness of the listener

The listener body matches design-v2's `Contratos` snippet at `:159-178` byte-for-byte, plus one extra defensive guard:

| Guard | Purpose | Verified |
|---|---|---|
| `if (!navigation.isFocused()) return;` | Skip cross-tab taps | Matches the design's contract; type confirmed at `node_modules/@react-navigation/core/src/types.tsx` (Tabs navigation prop has `isFocused()`). |
| `childState && childState.type === "stack"` | Skip leaf tabs (Profile) and partial-state rehydrates | Matches Behaviour matrix row "On `/profile` (leaf, no Stack)" at design-v2.md:204. |
| `typeof childState.index === "number"` | Defends against `PartialState` where `index` may be absent | Matches Validator MIN-NEW-3 defensive intent. |
| `childState.index > 0` | Skip at-root re-tap (Progress, Exercises root) | Matches Behaviour matrix row "On `/exercises` (root)" at design-v2.md:202. |
| `typeof childState.key === "string"` (deviation 2) | Defends against `PartialState` where `key` may be absent — would otherwise dispatch with `target: undefined` and silently route to Tabs | Cheap conjunct on already-short-circuit-heavy path. |

The dispatch `navigation.dispatch({ ...StackActions.popToTop(), target: childState.key })` is the exact shape the expo-router fork itself uses at `node_modules/expo-router/build/fork/native-stack/createNativeStackNavigator.js:62-65`. No upstream-divergence risk.

The conditional `e.preventDefault()` (only when we actually pop) is the design-v2's MAJ-1 fix — it neutralises the fork's RAF listener via `!e.defaultPrevented` for the cases we handle, and leaves the framework's default everywhere else. Verified against design-v2.md `Investigation §4` (`:97-101`).

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 3 minors → meets the playbook decision rule (≤1 major, 0 blockers → pass).
- All three minors are advisory polish (MIN-1 regex tolerance for a known web URL-suffix corner; MIN-2 sleep-magnitude parity; MIN-3 brittle absolute-path in comment) — none functional regressions, none security-relevant.
- The listener body matches design-v2's `Contratos` snippet exactly, plus one extra defensive guard (deviation 2) that the Implementer correctly justified as code-hardening of Validator MIN-NEW-3.
- All 5 declared deviations are individually justified with file:line evidence; the deviation-audit table walks each against the design's flex points.
- E2E spec covers design-v2's three test cases (re-tap pop, cross-tab + goBack history invariant, leaf no-op) with sibling-precedent locators (`.first()` consistently applied) and the established admin-seed + canonical-exercise fixture pattern.
- Static gates: typecheck re-verified 0 errors; no new `any` / `@ts-ignore` / `as` casts. Comments narrate why except one weak line (MIN-3).
- Security checklist substantively N/A — pure client navigation change, no DB / API / auth surface; admin-client usage in the spec follows established convention.
- The three minors can be deferred to Tester polish or left as-is; the test suite may pass empirically on the first run despite MIN-1 (the `?id=` suffix is conditional, not guaranteed).

Recommendation to Conductor: **invoke Tester**. Pass the three minors as advisory notes — Tester can decide whether MIN-1's regex tolerance is needed based on observed runtime behaviour; MIN-2/MIN-3 are pure polish.

Counts: `{ blockers: 0, majors: 0, minors: 3 }`.
