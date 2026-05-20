# Final summary — 2026-05-20_0410_strong-workout-routines-unify

## Outcome
- **Feature**: Item #1 from `docs/features.md` — Strong-style unification of Workout + Routines. Drops the Routines tab (now 5 tabs); the Workout tab becomes a unified home with Quick start + routines list + edit-pill per card + headerRight `+` to create a routine. Sticky `ActiveSessionBanner` mounted globally so an in-progress workout is visible across all tabs. `/routines` redirects to `/workout` for web bookmarks.
- **Pipeline result**: **shipped** (typecheck/lint clean, 51/51 unit, Playwright probe + 19/19 adjacent specs green).
- **Baseline commit**: `3b92ffa`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (web; Playwright probe + 19 adjacent specs) |
| Human interventions | 0 |
| Total round-trips | 4 (2 D↔V respins; I↔R and I↔T both single-pass) |
| Design ↔ Validate rounds | 3 (v1 no-go, v2 no-go, v3 go) |
| Implement ↔ Review rounds | 1 (`pass`, 2 polish minors) |
| Implement ↔ Test rounds | 1 (`pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~77 min (04:10 → 05:27 BRT) |
| Round budget used | D↔V 3/3 (max); I↔R 1/2; I↔T 1/2 |

## What shipped (8 files)

- **NEW** `src/components/active-session-banner.tsx` — sticky banner showing "Workout in progress" + ChevronRight CTA; returns `null` when no active session. Mounted globally above `<Tabs>`. Dark-mode tokens throughout.
- **EDIT** `app/(app)/_layout.tsx` — dropped `ListChecks` import; added `<Tabs.Screen name="routines" options={{ href: null }} />` (hides tab while keeping `/routines/...` routes resolvable per Expo Router v6); wrapped `<Tabs>` in `<View>` with `<ActiveSessionBanner />` sibling.
- **EDIT** `app/(app)/workout/index.tsx` — rewritten as the unified home. Removed auto-redirect + modal picker. Added: `useColorScheme()` for header icon, early-return on `active.isLoading`, two-layer active-session guard (handler short-circuit + `disabled` prop dimming routine cards), headerRight `+` for new routine.
- **EDIT** `src/components/routine-list-item.tsx` — added `Pencil` import; new `onEditPress?` prop with `e.stopPropagation?.()`; new `disabled` prop applies `opacity-60`.
- **EDIT** `app/(app)/routines/index.tsx` — replaced with 2-line `RoutinesRedirect` → `/(app)/workout`. All other imports dropped.
- **EDIT** `tests/e2e/crud.spec.ts` — lines 81-129 rewritten to drive routine flows from Workout home; lines 170 + 175 copy update "Start ad-hoc workout" → "Quick start workout".
- **EDIT** `tests/e2e/exercise-progress-ia.spec.ts:182` — same copy update.
- **EDIT** `tests/e2e/measurements.spec.ts:320-330` — renamed test to "5 tabs render, no Routines tab..."; removed positive Routines assertion; added negative `not.toBeVisible()` assertion.

(Plus a probe spec `tests/e2e/probe-strong-unify.spec.ts` added by Tester.)

## Decisions locked in
1. **Reading B** (full Strong unify), not A (light enrich).
2. **Option 1 routes**: keep at `/routines/...` paths; just hide the tab.
3. **5-tab order**: Workout / Exercises / History / Measurements / Profile.
4. **`href: null` on the Routines tab** — Expo Router v6 auto-mounts directory routes; deleting the `<Tabs.Screen>` line alone wouldn't hide it.
5. **Active-session protection**: three layers — loading gate (`active.isLoading`), per-handler `active.data` guard, UI `disabled` dimming routine cards.
6. **Banner placement**: above `<Tabs>` (accepted "between status bar and per-tab header" visual on iOS as v1; follow-up if visual review flags it).
7. **`<Pencil>` edit-pill** per card, with `e.stopPropagation?.()` to prevent the row's start-session tap.
8. **Web bookmark forwarder**: `/routines` redirects to `/workout`.
9. **Titles + icons preserved verbatim** — explicit decision NOT to rename Measurements ("Body") or swap icons (Library/Clock).

## Bugs caught and fixed
- **v1 BLK-1** (Validator → Designer v2): `<Tabs.Screen>` removal alone wouldn't hide the tab. Fixed with `href: null`.
- **v1 MAJ-1/MAJ-2** (Validator → Designer v2): missed test impacts (`crud.spec.ts:175`, `exercise-progress-ia.spec.ts:182`, `measurements.spec.ts:320-330`). All folded into the test-edit list.
- **v1 MAJ-3** (Validator → Designer v2): orphan-session race (concurrent in-progress sessions). Designer added handler-level guards.
- **v2 MAJ-NEW-1** (Validator → Designer v3): `active.isLoading` gating dropped from v2; re-introduced in v3.
- **v2 MAJ-NEW-2** (Validator → Designer v3): designer snippet introduced undeclared title/icon renames in `_layout.tsx`; reverted in v3.
- **v3 MIN-NEW-5** (Validator → Implementer): stray `Clock` import in snippet; Implementer dropped it.

## Known-debt (non-gating, tracked for follow-up)
- 2 Reviewer minors: undocumented `bg-white dark:bg-black` on the `_layout.tsx` View wrapper (cosmetic addition); Quick start button has no visual cue when blocked (asymmetric with the dimmed cards).
- Server-side unique partial index `(user_id) WHERE ended_at IS NULL` for definitive orphan-session prevention — out of scope this run.
- iOS / Android device smoke not exercised — flagged for release.
- Pre-existing `tests/e2e/crud.spec.ts > exercises: create custom exercise` failure traces to commit `b51dd01` (placeholder removed by `MuscleGroupPicker` refactor); unrelated to this run.

## Why we stopped
- Feature complete. All gates green. Last D↔V round was needed but landed clean.

## Artifacts
- discovery.md, design-v1.md, validation-v1.md, design-v2.md, validation-v2.md, design-v3.md, validation-v3.md
- implementation.md, review-v1.md, test-report-v1.md
- state.md, transcript.md, final-summary.md
- retro.md (post-run, owner)

## Notes for the owner
- **Working tree uncommitted.** Suggested commit pattern: `feat(workout): unify with Routines tab Strong-style` + `test(e2e): rewire routine flow + Strong-unify probe` + `docs(pipeline): archive Strong-unify run`.
- **No migration needed.** IA + UI only.
- **All features in `docs/features.md` are now shipped.** Backlog cleared (#1, #2, #3, #4, #5). 5 features → 4 pipeline runs total.
- **Open follow-ups** (no urgency): server-side concurrent-session guard, iOS device smoke, Quick start button dim symmetry.

## Archive
- To archive: `cp -r docs/runs/2026-05-20_0410_strong-workout-routines-unify "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-20_0410_strong-workout-routines-unify"` + vault README entry.
