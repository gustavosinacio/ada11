# Validation v1 — 2026-06-03_1124_progress-chart-window

## Decision: **GO**

0 blockers, 1 major, 4 minors. Per the playbook rule (0 blockers + ≤1 major → go), this is a **go** — the single major (MAJ-1, e2e shrink-assertion has no teeth) is a TEST-quality defect, design-recoverable by the Implementer/Tester without a re-design, and does not touch any production code path. I carry it forward as a **known must-fix for the e2e spec** (the Tester must prove the shrink assertion fails when the window does NOT shrink). The design's production-code seam is sound and every load-bearing factual claim verified against source.

Recommendation: **invoke Implementer**, with MAJ-1 routed as a must-fix on the e2e contract (F11).

---

## Per-claim verdicts (verified against source, not the design's prose)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1a | `presentWeeklyVolumeByMuscle` loops `rows` TWICE (earliest @ `:61`, bucket @ `:92`) | **VERIFIED** | `weekly-muscle-volume.ts:61-64` (earliest `for`), `:92-113` (bucket `for`). Two distinct `for (const row of rows)`. |
| 1b | `presentTopExerciseE1rm` loops `rows` TWICE (earliest @ `:98`, aggregate @ `:119`) | **VERIFIED** | `e1rm-strength.ts:98-101` (earliest), `:119-150` (aggregate). Two distinct loops. |
| 1c | If the guard is NOT added to the EARLIEST loop, the axis keeps a dead pre-window lead-in | **VERIFIED (correct concern)** | `earliestMs` (`:60-64` / `:97-101`) → `firstMonday` (`:67`/`:104`) → `isoWeeksBetween` (`:69`/`:106`) builds the axis from the UNFILTERED earliest. Guarding only the bucket loop leaves the left axis edge at a pre-window Monday with zero data plotted. R-2's MEDIUM risk is real and the both-loops fix is correct. |
| 1d | No THIRD leak path (e.g. LOCF/ranking reading unfiltered rows) | **VERIFIED (I checked beyond the claim)** | In e1RM, `agg.cell`/`agg.sessions`/`agg.lastActiveMs` are populated ONLY inside the guarded aggregate loop (`:144-149`); ranking (`:157`), selection (`:167-212`), and LOCF (`:215-245`) all derive from `byExercise`, never from `rows`. Guarding both `rows` loops is sufficient — no escape hatch. |
| 2a | The 3-line guard matches `bucketLifetimeWeeklyVolumes` (`progress-page-math.ts:82-84`) | **VERIFIED** | `progress-page-math.ts:82-84`: `if (windowStartMs !== undefined) { const startedMs = parseISO(row.sessions.started_at).getTime(); if (startedMs < windowStartMs) continue; }` — byte-identical to the design's proposed block (design-v1.md:80-83). |
| 2b | `WeeklyVolumeRow.sessions.started_at` is guaranteed present (`!inner` join) | **VERIFIED** | `stats.ts:29` types `sessions: { started_at: string; ... }` (non-optional); `stats.ts:34` SELECT uses `sessions!inner(started_at, ended_at)`. The unit fixture also always sets it (`weekly-muscle-volume.test.ts:38`). No NPE on the guard's `parseISO(row.sessions.started_at)`. |
| 3 | Invariant W: `windowStartMs===undefined` ⇒ byte-for-byte today's output | **VERIFIED** | The two presenters contain NO `windowStartMs` reference today (`grep`: 0 matches). The only new code is the `if (windowStartMs !== undefined) {…continue}` guard, skipped when unset. No hidden coercion: `windowStartMs?: number` default-undefined; the `!== undefined` test is exact (does not collapse `0`, though `0` is never a valid threshold anyway). Section memo deps add `props.windowStartMs` (F7/F8) — when the page passes `undefined` (pref `0`), the memo input is stable `undefined`, identical to today. Baseline suites green (33 pass / 0 fail) — the no-param call must continue to match. |
| 4a | `computeWindowStart(0, now) === undefined` | **VERIFIED** | `window-utils.ts:45`: `if (weeks === 0) return undefined;`. |
| 4b | `weeks>0` ⇒ inclusive Monday-00:00 instant `weeks` ISO-weeks back | **VERIFIED** | `window-utils.ts:46-48`: `isoWeekStart(now)` → `subWeeks(monday, weeks)` → `parseISO(localISO).getTime()`. Docstring `:27-29` confirms INCLUSIVE lower bound (`>=`), matching the guard's `startedMs < windowStartMs` (drops strictly-before). |
| 4c | Default-`0` user ⇒ no filter ⇒ Invariant W | **VERIFIED** | `useMaxVolumeWindowWeeks()` returns `0` when prefs absent (`use-preferences.ts:42`); `0 → computeWindowStart → undefined → guard skipped`. (See R-6 note below — the seed correctly captures `0`.) |
| 5a | `MAX_VOLUME_WINDOW_LABELS` lives privately in `profile.tsx:27-34` with `{0:"All",10:"10w",…,50:"50w"}` | **VERIFIED** | `profile.tsx:27-34` — exact keys/values. Used only at `:182`. |
| 5b | Moving it to `db/types.ts` is safe (no cycle; leaf) | **VERIFIED** | `db/types.ts` imports only `drizzle-orm` + `./schema`; `schema.ts` imports only `drizzle-orm` (`schema.ts:1-12`). Pure leaf. `profile.tsx` ALREADY imports `MaxVolumeWindowWeeks` + `MAX_VOLUME_WINDOW_OPTIONS` from `~/db/types` (`profile.tsx:7-12`) — adding `MAX_VOLUME_WINDOW_LABELS` to that import introduces NO new edge. `MaxVolumeWindowWeeks` type exists (`db/types.ts:68`). |
| 6a | `progress/index.tsx` threads a single page-derived value (`bestWeekKg`/`bestWeekLabel`) into `<WeeklyVolumeStrip>` @ `:70-73` | **VERIFIED** | `progress/index.tsx:70-73` — `<WeeklyVolumeStrip bestWeekKg={…} bestWeekLabel={…} />`. The threading precedent is real. |
| 6b | The page already imports/reads `useMaxVolumeWindowWeeks` @ `:11`/`:40` | **VERIFIED** | `:10-13` import block includes `useMaxVolumeWindowWeeks`; `:40` `const weeks = useMaxVolumeWindowWeeks();`. The hook is already in scope — F6's `prefWeeks` reuses it. |
| 6c | `useState(prefWeeks)` seed + single `useMemo(()=>computeWindowStart(windowWeeks, new Date()), [windowWeeks])` matches the existing idiom (`use-progress-page.ts:76-79`) | **VERIFIED** | `use-progress-page.ts:76-79` is `useMemo(() => computeWindowStart(weeks, new Date()), [weeks])` with `new Date()` INSIDE the factory — F6's memo is structurally identical. Convention preserved (no per-render recompute). |
| 7a | Each section re-seeds `visible` on `seriesKeysSig` change (`weekly-muscle-volume-section.tsx:67-71`, `e1rm-strength-section.tsx:87-91`) | **VERIFIED** | Muscle `:67-71` and e1RM `:87-91`: `const [lastSig,setLastSig]=useState(seriesKeysSig); if (lastSig!==seriesKeysSig){ setLastSig(...); setVisible(new Set(seriesKeys)); }`. Render-phase re-seed, exact match. |
| 7b | Changing `windowStartMs` ⇒ model recompute ⇒ series change ⇒ visibility re-seed to "all on" | **VERIFIED (chain holds)** | Adding `props.windowStartMs` to the model memo deps (F7/F8) ⇒ `model` recomputes ⇒ `seriesKeys` memo (dep `[model]`, `:56-59`/`:76-79`) recomputes ⇒ `seriesKeysSig` string changes IFF the series SET changes ⇒ re-seed. NOTE: if the window shrinks but the SAME series remain (just fewer weeks), `seriesKeysSig` is UNCHANGED and visibility is preserved — which is the correct/desired behavior. R-4 ("all lines re-appear") only fires when the window actually adds/drops a series; that is acceptable and intended. |
| 8a | Both sections `return null` on empty series | **VERIFIED** | `weekly-muscle-volume-section.tsx:85` `if (!model || model.series.length === 0) return null;`; `e1rm-strength-section.tsx:109` identical. |
| 8b | Selector at PAGE level survives both charts going null | **VERIFIED** | F6 renders `<ProgressWindowSelector>` as a sibling ABOVE both sections inside the `<ScrollView>` (design-v1.md:131-134). The sections returning `null` removes their subtree but not the selector. No layout trap. |
| 8c | No `<ScrollView>` issue with both sections collapsing | **VERIFIED (no defect)** | `progress/index.tsx:51-78` — sections are direct `<ScrollView>` children; `null` children simply render nothing. `contentContainerClassName="pb-12"` and surrounding blocks (`<ProgressHero>`, `<WeeklyVolumeStrip>`, `<ExercisesThisWeekList>`, `<StreakCard>`) keep the page non-empty. No collapse-to-zero-height crash. |
| 9a | Touches NONE of the per-exercise screen's trend-chart logic | **VERIFIED** | F1–F11 list excludes `app/(app)/exercises/[id]/progress.tsx`. Out-of-scope §232. |
| 9b | Touches NOT the strip, NOT the pref write path | **VERIFIED** | No F-row touches `weekly-volume-strip*`, `use-preferences` setters, or `api/preferences`. F4 (profile) is import-only. |
| 9c | F4 profile edit is a pure no-behavior-change refactor | **VERIFIED, with a caveat (MIN-2)** | Replacing the local const with an import of the identical map changes no behavior at `profile.tsx:182`. Caveat: a stale third copy exists in tests — see MIN-2. |
| 9d | The 5 pre-existing cache-buster files are not functionally modified by F1–F11 | **VERIFIED** | `git status` confirms the 5 dirty files (`history/week/[isoWeek].tsx`, `use-progress-page.ts`, `query-client.ts`, `progress-page-math.ts`, `weekly-volume-strip-math.ts`). F1–F11's change set does not include any of them (`progress-page-math.ts` is cite-only). R-8 holds. |

**All 24 load-bearing sub-claims verify against real source. Zero false claims this round.** The design's file:line anchors are accurate; the both-loops subtlety (design §"Where the two row loops are") is a correct catch the Discovery phrasing under-specified.

---

## Issues

### Blockers
None.

### Majors

**MAJ-1 — The e2e shrink assertion (F11 step 3) has no teeth as written; it may not even be true.**
- **Location:** design-v1.md:200 ("tap '10w'; assert BOTH charts' x-axis label count drops (fewer week labels)").
- **What is wrong (FACT, verified):** `<MultiSeriesChart>` thins the x-axis to ~5 ticks via `xLabelStep = Math.max(1, Math.floor(count / 5))` (`multi-series-chart.tsx:99-102`), rendering them as SVG `<text>` nodes (`:162-173`). The **visible tick COUNT is ~5–6 regardless of whether the axis spans 50 weeks or 10 weeks** — thinning holds the displayed count roughly constant. So "x-axis label count drops" is likely FALSE: tapping 10w on a 50-week user does NOT reduce the number of rendered tick labels. The assertion would either (a) never fail (false-green, the carry-in lesson from the e1rm-strength run) or (b) fail for the wrong reason. Counting SVG `<text>` content in Playwright web-export is also fragile. This is precisely the "does the assertion have teeth?" gap the Validator's own feedback file flags as a standing check on shrink/negative e2e cases.
- **Suggested fix (terse):** Replace the brittle "label COUNT drops" with a signal that actually changes on shrink and has teeth:
  - Assert a specific OLD week's tick LABEL (a `dd/mm` string only present pre-window) is gone after 10w and present at "All" (label *text*, not count); OR
  - Assert an old-only **series/legend chip** disappears after 10w and returns at "All" (`getByLabel("Toggle <oldExercise>")` → `toHaveCount(0)` then `toHaveCount(1)`), mirroring the existing absent-chip idiom (`e1rm-strength.spec.ts:310`, `weekly-muscle-volume.spec.ts:280`). The chip-disappearance signal is robust, already-supported by the suite, and proves the window changed the data set.
  - Keep the design's settle-gate requirement (await a stable post-tap anchor before the negative assertion) — the design already calls for this (`:203`), which is good.
- **Severity rationale:** Major, NOT blocker — it is a TEST-spec defect (F11 is a NEW file), recoverable by the Implementer/Tester without re-designing any production code; the production seam (F1–F8) is correct. Carried forward as a must-fix the Tester must honor (prove the shrink assertion fails when the data does NOT shrink).

### Minors

**MIN-1 — F3/F4 leaves a THIRD hand-maintained copy of the label map; the "single source of truth" goal is only partially met.**
- **Location:** `tests/unit/profile-max-volume-window.test.ts:44-55` (local `LABEL_MAP`), comment `:46` ("kept in sync with `app/(app)/profile.tsx` `MAX_VOLUME_WINDOW_LABELS`").
- **What is wrong (FACT):** This test does NOT import `MAX_VOLUME_WINDOW_LABELS` from `profile.tsx` — it declares its own copy and only documents a "keep in sync" comment that will become stale once the source const moves to `db/types.ts`. F4's move does NOT break the test (no symbol reference), but it leaves the comment pointing at the wrong location and a divergent third copy. The design's F3 stated rationale is "ONE source of truth" — this test undercuts it.
- **Suggested fix:** Optionally have F10/F9 (or a small F-edit) update this test to `import { MAX_VOLUME_WINDOW_LABELS } from "~/db/types"` and assert against it, retiring the local `LABEL_MAP` and the stale comment. Not required for go; it's polish that completes the stated F3 goal.

**MIN-2 — F4 "zero behavior change" is true at the screen, but the design should explicitly note the test surface above so the Reviewer/Tester re-checks it.**
- **Location:** design-v1.md:234 ("the only Profile edit, F4, is a pure import-the-now-shared-constant refactor with zero behavior change").
- **What is wrong:** The claim is correct for `profile.tsx` runtime, but `profile-max-volume-window.test.ts` is the spec that guards this slot and the design's regression-surface list does not name it. Per the Validator's own carry-in lesson (favorite-exercises MIN-NEW-2): when a change touches a slot another spec asserts on, name that spec as the re-run surface even when the change looks safe. The vitest config restricts `include` to `tests/unit/**/*.test.ts`, so this file IS run by `npx vitest run`.
- **Suggested fix:** Add `tests/unit/profile-max-volume-window.test.ts` to the Tester's re-run list and note it stays green after F3/F4 (it does today — verified the test never imports the moved symbol). Documentation-only.

**MIN-3 — R-6 (seed-flicker) is correctly ACCEPTED, but verify the verdict: it is a real, minor, transient UX wrinkle, not a blocker.**
- **Location:** design-v1.md:215 (R-6); F6 `useState(prefWeeks)`.
- **Assessment (my independent verdict, CONFIDENCE HIGH / severity MINOR):** The mechanism is real — `useMaxVolumeWindowWeeks()` returns `0` until prefs load (`use-preferences.ts:42`), so a cold mount of a user with stored `20w` captures `0` ("All") in `useState`, then the resolved pref does NOT re-sync (no `useEffect`, by design). Result: a user with a non-default stored pref sees "All" on a cold Progress mount until they re-tap. **This is acceptable, NOT a blocker, for three concrete reasons:** (1) it is byte-for-byte consistent with the page's EXISTING `bestWeekLabel` tolerance (`progress/index.tsx:44-48` reads the same `weeks` and accepts the `0`-then-resolve flicker today — so this feature introduces no NEW class of flicker the page doesn't already exhibit); (2) it only affects users who BOTH set a non-default pref AND cold-mount Progress before prefs hydrate — and the failure mode is "shows MORE data than intended," never wrong/corrupt data; (3) the design's rejected mitigation (`useEffect` re-sync) would re-introduce the bind the human explicitly locked OUT (ephemeral seed-only, `state.md:50`). **The seed-flicker is the correct trade for honoring the locked ephemeral decision.** Do NOT block on it. (If the Implementer can cheaply seed from `prefs.data?.max_volume_window_weeks` only once it is non-null without re-binding — e.g. lazy `useState` initializer guarded on first hydrated value — that's a nice-to-have, but it risks the bind and is out of the locked scope; leave it.)

**MIN-4 — The test plan does not pin a case for "window shrinks but the SAME series remain ⇒ visibility PRESERVED" (the complement of R-4).**
- **Location:** Test plan §F9/F10 (W-0..W-5) + R-4.
- **What is wrong:** The design's edge-case list tests "a series DROPS OUT when its data is pre-window" (W-2, W-4) and notes R-4 ("re-seed to all-on when series change"). But the IMPORTANT complementary behavior — when the window shrinks the axis WITHOUT changing the series set, `seriesKeysSig` is unchanged so the user's toggled-off lines STAY off — is implied by claim 7b but never asserted. This is the behavior most users will hit (shrink 50w→20w while still training the same lifts). A unit case is hard to write (it's component-level visibility, not presenter output), but it's worth one e2e sub-step or an explicit note that visibility is preserved across a same-series shrink. Minor — the mechanism is verified-correct (claim 7b), this is just test-coverage completeness.
- **Suggested fix:** Add a one-line e2e assertion or a documented note: after toggling a line off and then shrinking the window WITHOUT dropping that series, the line stays off (proves `seriesKeysSig` stability). Optional.

---

## Items I explicitly assessed and found SOUND (no issue)

- **Contract A (pre-computed `windowStartMs`) over B (`weeks`+`now` per section):** correct. B's two `new Date()` captures could desync across a Monday rollover; A keeps `new Date()` in one page memo. Matches the `use-progress-page.ts:76-79` single-source idiom. No issue.
- **Dual-anchor (`started_at` include / `completed_at` bucket):** the guard reads `sessions.started_at` exactly like the kernel (`progress-page-math.ts:83`); bucket placement stays on `completed_at` (`:93`/`:120`). Cross-surface consistency with the "Max" numbers holds. R-1 mitigation is real. No issue.
- **Empty-window: keep selector mounted, do NOT force an empty chart frame (alt #8 rejected):** correct call. Page-level mount already solves the no-way-back trap; an empty 200px chart frame would be worse. No issue.
- **Reuse `MAX_VOLUME_WINDOW_OPTIONS` (alt #6 rejected):** correct — guarantees the pref seed is always a valid option and `computeWindowStart` needs zero new math. No issue.
- **No simpler/safer approach was dismissed incorrectly.** The section-level pre-filter (alt #1) is genuinely worse (duplicates dual-anchor logic, un-unit-testable as a pure fn). The presenter-param approach is the right seam and reuses the tested `bucketLifetimeWeeklyVolumes` precedent verbatim. The write-back (alt #4) and calendar-picker (alt #5) are correctly locked out by the human.
- **Baseline is green:** `npx vitest run` on the two presenter suites → 33 pass / 0 fail. Invariant W's W-0 `deepEqual` anchor has a solid baseline to match against.

---

## Counts
- Blockers: **0**
- Majors: **1** (MAJ-1, e2e shrink assertion teeth — must-fix carried to Implementer/Tester)
- Minors: **4** (MIN-1 third label copy, MIN-2 name the test re-run surface, MIN-3 R-6 seed-flicker accepted-verdict, MIN-4 same-series shrink visibility coverage)

## Decision: **GO** (with MAJ-1 as a known must-fix on the F11 e2e contract)
