# Review v1 — 2026-06-03_1124_progress-chart-window

Reviewing the diff for the implementation against `design-v1.md` (approved) and the Validator's GO (`validation-v1.md`, with MAJ-1 e2e-teeth as a must-fix).

## Decision: **PASS**

0 blockers / 0 majors / 2 minors. Both minors are documentary/coverage-completeness, not regressions. The production seam (F1–F8) shipped byte-for-byte to the contract; Invariant W is provable-by-construction AND pinned by a deep-equal unit case in each presenter; the MAJ-1 e2e must-fix landed with teeth and a settle-gate; the security surface is unchanged (no new query, no new table, no secret in shipped code).

Recommendation: **invoke Tester**.

---

## Diff scope
- Diff command: `git diff 25db98beb5bb219b3405b7d2fa75a13849665d92...HEAD` (baseline from `state.md:10`); feature files only (the 5 pre-existing cache-buster files + `dist/` are out-of-run noise per `state.md:12-20`, not reviewed).
- Feature files changed: 11 (8 source + 3 unit test) + 2 new (`progress-window-selector.tsx`, `progress-window-selector.spec.ts`).
- Source line delta: `+55 / -2` across the 3 kernel/types files; `+27 / -2` page; `+1 / -15` profile; `+6 / -2` each section; new selector 70 lines; new e2e 403 lines.

## Verification of implementation.md claims (re-traced against the REAL diff, not the prose)

| # | Claim | Verified? | Evidence |
|---|---|---|---|
| 1 | Muscle guard in BOTH loops (earliest + bucket) | yes | `weekly-muscle-volume.ts:72-75` (earliest-edge loop) + `:107-110` (bucket loop). Two distinct guards. |
| 2 | e1RM guard in BOTH loops (earliest + aggregate) | yes | `e1rm-strength.ts:111-114` (earliest-edge) + `:136-139` (aggregate). Two distinct guards. |
| 3 | Guard shape = `progress-page-math.ts:82-84` (anchored on `sessions.started_at`, strict `<`) | yes | All 4 guards are byte-identical: `if (windowStartMs !== undefined) { const startedMs = parseISO(row.sessions.started_at).getTime(); if (startedMs < windowStartMs) continue; }`. `started_at` (not `completed_at`); strict `<` ⇒ inclusive lower bound. |
| 4 | Invariant W: `windowStartMs===undefined` ⇒ byte-for-byte today's output | yes | The ONLY new code in each loop is the `!== undefined` guard; when unset every guard is skipped ⇒ identical control flow to baseline. Pinned by W-0 deep-equal in BOTH unit files (`weekly-muscle-volume.test.ts:307-352`, `e1rm-strength.test.ts:460-498`) over populated multi-week/multi-series fixtures: `presentX({…, windowStartMs: undefined})` `.toEqual` `presentX({…})`. |
| 5 | No THIRD leak path | yes | e1RM ranking (`:177`), selection (`:187-232`), LOCF (`:235+`) all read `byExercise`, populated ONLY in the guarded aggregate loop (`:152-169`). Muscle series emission (`:133-140`) reads `byMuscle`, populated ONLY in the guarded bucket loop (`:125-130`). No `rows` re-iteration outside the two guarded loops. |
| 6 | `MAX_VOLUME_WINDOW_LABELS` lifted + exported in `db/types.ts` | yes | `db/types.ts:81-90` — identical keys/values to the old private copy; JSDoc names both consumers. |
| 7 | `profile.tsx` imports the shared map, no behavior change | yes | `profile.tsx:8` import; `:168` usage; old private const + its docstring deleted. No dangling reference (grep: only the import + the use). |
| 8 | `progress-window-selector.tsx` stateless, typed, a11y, Profile idiom | yes | `progress-window-selector.tsx:22-25` typed props `{value, onChange}`; no `useState`/`useEffect`; `accessibilityRole="button"` (`:42`), `accessibilityState={{ selected }}` (`:48`), `accessibilityLabel` (`:43-47`); `flex-1 rounded-md py-2` + active `bg-black dark:bg-white` (`:49-53`); tap short-circuits when already active (`:38-41`); no preference write. |
| 9 | Page F6 wiring | yes | `progress/index.tsx:53` `useState<MaxVolumeWindowWeeks>(weeks)` (seed-once, NO `useEffect` re-bind); `:56-59` single `useMemo(() => computeWindowStart(windowWeeks, new Date()), [windowWeeks])` with `new Date()` INSIDE the factory; `:95` selector rendered ABOVE both sections; `:99-100` `windowStartMs` threaded into both. |
| 10 | Section memo deps include `props.windowStartMs` (F7/F8) | yes | `weekly-muscle-volume-section.tsx` deps `[rows, exercises, measurements, props.windowStartMs]`; `e1rm-strength-section.tsx` deps `[rows, exercises, favoriteSet, props.windowStartMs]`. Stale-chart bug avoided. |
| 11 | MIN-1 closed: no third label-map copy | yes | `profile-max-volume-window.test.ts:46-48` now `const LABEL_MAP = MAX_VOLUME_WINDOW_LABELS` imported from `~/db/types`; the stale "keep in sync with profile.tsx" comment removed. |
| 12 | MAJ-1 e2e teeth | yes | `progress-window-selector.spec.ts:227,251,265` — `Toggle Bench Press` chip `toHaveCount(1)` at All → `toHaveCount(0)` at 10w → `toHaveCount(1)` restored. Assertion changes with the window (not statically true). NOT x-axis label count. |
| 13 | Gates: typecheck 0 / lint 0+1 / unit green | yes (re-run) | I re-ran: `tsc --noEmit` 0 errors; ESLint 0 errors / 1 warning (pre-existing `router.d.ts`); `vitest run` on the 3 touched files 52 pass / 0 fail. Matches implementation.md. |

All 13 claims verify against real source. No false claims.

---

## Scrutiny against the prompt's checklist

**1. Invariant W (load-bearing) — HELD.** Provable by construction (only-skipped-guards) AND empirically anchored: the W-0 deep-equal in both files compares the `windowStartMs: undefined` call against the no-param call over a populated fixture (3 rows, 2 muscles / 2 exercises, W10–W21). `.toEqual` proves byte-for-byte equality of the full model (weeks + series). The default flow `pref 0 → computeWindowStart(0, …) → undefined → no guard` (the never-opened-Profile user sees the pre-feature chart) is verified: `window-utils.ts:45` returns `undefined` for `weeks===0` (cited by the Validator, unchanged this run).

**2. Both-loops guard — PRESENT in all four loop heads.** Verified at `weekly-muscle-volume.ts:72-75` + `:107-110` and `e1rm-strength.ts:111-114` + `:136-139`. The earliest-edge guard is what makes the axis left edge shrink to the first in-window Monday (W-1 asserts `windowed.weeks[0].key !== full.weeks[0].key` AND `windowed.weeks.length < full.weeks.length` in both unit files). Without it, R-2's dead pre-window lead-in would survive — it does not.

**3. Guard correctness — anchored on `sessions.started_at`, strict `<`.** All four guards read `row.sessions.started_at` (NOT `completed_at`), strict `<` (inclusive lower bound). W-3 (muscle, `weekly-muscle-volume.test.ts:436-477`) pins the anchor + boundary: a session whose `started_at === threshold` is INCLUDED (Chest present), `threshold - 1ms` is EXCLUDED (Legs absent) — both bucketing in the same week so ONLY inclusion varies. This is the cross-surface-consistency anchor (R-1): the chart now windows the SAME way as the "Max" callouts.

**4. Page wiring (F6) — correct.** Ephemeral `useState(weeks)` seed with NO `useEffect` re-bind (honors the locked ephemeral decision, `state.md:50`); single `useMemo` with `new Date()` inside the factory and `[windowWeeks]` deps (no per-render recompute, matches `use-progress-page.ts:76-79`); selector rendered as a sibling ABOVE both sections inside `<ScrollView>` (survives both charts going `null`); `windowStartMs` threaded into both sections.

**5. Section memo deps (F7/F8) — `props.windowStartMs` present in BOTH.** No stale-chart bug. The existing `seriesKeysSig` re-seed mechanism (verified unchanged by the Validator, claims 7a/7b) handles visibility: a window that changes the series SET re-seeds to all-on; a same-series shrink preserves toggles. MIN-4 e2e (test 3) pins the preserve case.

**6. MAJ-1 in the e2e (F11) — teeth + settle-gate + MIN-4 sub-step all present.** Test 1 asserts an old-only legend chip (`Toggle Bench Press`) `toHaveCount(1)` → `toHaveCount(0)` → `toHaveCount(1)` (NOT x-axis label count). Each negative assertion is preceded by a settle-gate: the target segment carrying `bg-black` (`:242-244`, `:262-264`) AND a positive in-window anchor (`Toggle Squat (Barbell)` count 1, `:247`) before the `toHaveCount(0)` at `:251`. MIN-4 same-series-shrink visibility-preserved sub-step exists as test 3 (`:337-401`): toggle off → shrink to a non-dropping window → chip still present AND still `opacity-40`.

**7. F3/F4 + MIN-1/2 — done.** Label map lifted to `db/types.ts:81-90` and exported; `profile.tsx` imports it (no behavior change); `profile-max-volume-window.test.ts` imports the shared map (no third copy). MIN-1 from the Validator is fully closed.

**8. Component quality (F5) — clean.** `<ProgressWindowSelector>` is stateless, typed, a11y-labelled, Profile-idiom-matching, no preference write (see claim 8). It adds a `"Chart window"` caption + descriptive per-segment `accessibilityLabel` ("Chart window: all history" / "Chart window: last N weeks") that the e2e keys off — a clean improvement over a bare numeric label.

**9. Types/style/architecture — clean.** No new `any`/`as any`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable` in any of the 8 source files (grep-clean). `windowStartMs?: number` and `MaxVolumeWindowWeeks` used correctly. Presenters stay PURE (the only new code is a row filter; no I/O, no React). New files in conventional folders (`src/components/`, `tests/e2e/`). Imports `~/`-rooted, package-first.

---

## Issues

### Blockers
None.

### Majors
None. (The Validator's MAJ-1 e2e-teeth must-fix is verified CLOSED — see claim 12 / checklist item 6.)

### Minors

**[MIN-1]** `tests/unit/e1rm-strength.test.ts:589` — W-4 asserts the windowed series is EXACTLY `["recent"]` (the pre-window-only `old` exercise excluded), which is the right exclusion proof. But it does not also assert `full.series` would have placed `old` FIRST under a different ranking that the window inverts — it asserts `full` = `["old","recent"]` at `:579` (good) and `windowed` = `["recent"]` at `:589`. This is complete for the exclusion + rank-0 recompute claim; the residual gap is only that it never exercises a window where TWO exercises both survive but their relative RANK flips (e.g. a high-session pre-window exercise vs. a low-session recent one where windowing changes the order without dropping either). Coverage-completeness only — the mechanism (rank recomputes over `byExercise`, which is built from the guarded loop) is verified-correct. Fix (optional): add a windowed case where two surviving exercises swap rank. Not required.

**[MIN-2]** `tests/e2e/progress-window-selector.spec.ts:178-184` — test 1/2 seed against the named canonical rows `Bench Press` and `Squat (Barbell)` via `pickCanonicalExercise(admin, NAME)`, which THROWS on a catalog miss. Whether those exact names exist in the LIVE canonical catalog (`exercises WHERE user_id IS NULL AND deleted_at IS NULL`) is a DB-state property the static review cannot confirm; the Implementer used only suite-green names (`e1rm-strength.spec.ts:164`, `:211` — see implementation.md note) and the sandbox blocked a direct service-role probe. This is the standing pre-flight from the feedback file. Fix: none in code; **Tester hand-off (T-2 below)** — if either name throws at seed time, substitute another verified-green weighted name and re-run. LOW risk (both names are asserted-on by currently-passing sibling specs).

---

## Security checklist
- [x] **RLS / authorization:** NO new query surface. Both presenters are PURE functions over the already-fetched `useLifetimeWeeklyVolume()` / `useAllExercises()` / `useMeasurements()` / `useMyFavoriteExerciseIds()` caches — the window is a client-side row filter, no new SELECT/INSERT/DELETE. No new table, so no policy needed. The e2e seeds via service-role admin (`createUser` + `sessions`/`sets` inserts carrying `user_id`), reads via the signed-in UI — the standard test pattern.
- [x] **No service-role / signing key in client-bundled code:** grep-clean across all 8 shipped source files + the new component. `SUPABASE_SERVICE_ROLE_KEY`/`SERVICE_ROLE` appear ONLY in `progress-window-selector.spec.ts` (test-only, never bundled).
- [x] **Input handling / injection:** no raw SQL, no `rpc`, no shell exec, no string concat of user input. The selector emits a typed `MaxVolumeWindowWeeks` from a fixed option list; `computeWindowStart` is pure date math. The e2e uses parameterized PostgREST builders.
- [x] **Public env vars:** no new `EXPO_PUBLIC_*` vars. The two referenced in the e2e (`EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY`) are pre-existing and non-secret by design.

## Style / convention checklist
- [x] **No new `any`** — grep-clean (`: any` / `as any` / `<any>` = 0) across all 8 source files.
- [x] **No new `@ts-ignore` / `@ts-expect-error` / `eslint-disable`** — grep-clean.
- [x] **Comments narrate WHY** — the presenter docstrings explain the dual-anchor rationale + Invariant W; the page comment explains seed-vs-bind + why `new Date()` is inside the memo; the selector docstring explains the stateless/no-write contract. None are what-narration.
- [x] **Imports follow project style** — `~/`-rooted within source root, package imports first (`react`/`react-native` before `~/...`), type-only imports marked.
- [x] **New files in conventional folders** — `src/components/progress-window-selector.tsx` (component); `tests/e2e/progress-window-selector.spec.ts` (e2e).

---

## Items I explicitly assessed and found SOUND (no issue)
- **`Squat (Barbell)` is the e1RM chip name only, no double-match:** the e1RM legend uses `Toggle ${s.name}` (`e1rm-strength-section.tsx:168`), the muscle legend uses the muscle KEY (`Legs`, not the exercise name, `weekly-muscle-volume-section.tsx:131-140`). So `getByLabel("Toggle Squat (Barbell)")` matches exactly one chip (the e1RM one) → `toHaveCount(1)` is unambiguous. No strict-mode collision.
- **Test 2 collapse assertion is correct:** both section headers `Estimated 1RM per exercise` (`e1rm-strength-section.tsx:123`) and `Weekly volume per muscle` (`weekly-muscle-volume-section.tsx:99`) render only in the non-null branch (both `return null` on empty series, `:113` / `:89`), so `toHaveCount(0)` proves the sections collapsed while the selector (page-level) stays mounted — Unknown 6 / R-3 verified.
- **`new Date()` inside the memo factory** (not captured as a render-time const) — correct; deps `[windowWeeks]` only, no per-render recompute, threshold stays correct for ~24h. Matches the page's existing idiom.
- **`mkRow` builds `sessions.started_at`** (`weekly-muscle-volume.test.ts:30,39`) and supports the `started_at` override — the guard's `parseISO(row.sessions.started_at)` never NPEs in the fixtures.
- **R-6 seed-flicker** correctly accepted (no `useEffect` re-bind) — consistent with the page's existing `bestWeekLabel` tolerance and the locked ephemeral decision. Not an issue.

---

## Counts
- Blockers: **0**
- Majors: **0**
- Minors: **2** (MIN-1 W-4 rank-flip coverage-completeness; MIN-2 e2e seed-name DB-state hand-off)

## Tester hand-off notes
- **T-1 (runtime — chart actually re-renders on tap):** the unit tests pin the presenter output; the e2e pins the legend chip appearing/disappearing. Confirm at runtime the actual SVG chart redraws (axis shrinks) on tap — the chip-count is the data-set proxy, not the rendered line. LOW risk (chip presence derives from `model.series`, the same source the chart plots).
- **T-2 (DB-state — seed names):** verify `Bench Press` + `Squat (Barbell)` resolve via `pickCanonicalExercise` against the LIVE canonical catalog (not just the seed migration). A throw at seed time = the catalog drifted; substitute another verified-green WEIGHTED name (must plot on the e1RM chart) and re-run. (MIN-2.)
- **T-3 (runtime — `bg-black` settle-gate):** the e2e gates on the active segment carrying the `bg-black` NativeWind class (rn-web 0.21 does not emit `aria-selected`). Confirm rn-web actually emits `bg-black` on the active `<Pressable>` (the sibling specs assert `opacity-40`/`bg-emerald-500`, so class-on-active is the established pattern, but this specific class is new to this control).
