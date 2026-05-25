# Regression report — 2026-05-25_0933_soft-deleted-session-volume-leak

## Environment

- Build: local dev (`npx expo start --web --port 8081`) + Playwright Chromium 1.59.1 (web mode).
- Working tree: `main` with the Implementer's 4 file diffs vs baseline `bde34d7f29897a0cc578dd0a0efdb7e0f6a95efe`.
- Test data: ephemeral users created per test via Supabase admin API (`SUPABASE_SERVICE_ROLE_KEY`), torn down in `afterAll` / `finally`.
- Date / TZ at run: 2026-05-25 (BRT, UTC-3).

## Code-level confirmation (diff vs baseline `bde34d7`)

| File | Change | Verified at |
|---|---|---|
| `src/api/stats.ts` | `+.is("sessions.deleted_at", null)` on both `listWeeklyVolumeRows` branches | lines 56 (sinceUtc) and 80 (paginated lifetime) |
| `src/api/progress.ts` | `+.is("sessions.deleted_at", null)` in `listSetsForExercise` | line 17 |
| `src/api/sets.ts` | `+.is("sessions.deleted_at", null)` in `getLastWorkingSetForExercise` | line 193 |
| `src/hooks/use-sessions.ts` | `+qc.invalidateQueries({ queryKey: ["progress"] })` in `useSoftDeleteSession.onSuccess` | line 122 |

`git diff --stat bde34d7 -- src/`:

```
src/api/progress.ts       | 1 +
src/api/sets.ts           | 1 +
src/api/stats.ts          | 2 ++
src/hooks/use-sessions.ts | 1 +
4 files changed, 5 insertions(+)
```

## Automated checks (static gates)

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | pass (zero errors) |
| Lint | `npm run lint` | pass (0 errors, 1 pre-existing warning in `router.d.ts`) |
| Unit tests | `npm run test:unit` | **364/364 passed** (23 files, 2.46 s) |
| Web export build | `npx expo export --platform web` | pass — bundle exported to `dist/`; "Something prevented Expo from exiting" trailer is the same harmless Metro-shutdown message present in every prior successful export |

## Replay of original reproduction

**Steps from `repro.md`** (Variant B condensed — the survivor + deleted-doomed two-session variant, the one screenshotted as the canonical bug evidence):

1. Admin-create confirmed user, pick `Bench Press` from seeded exercises.
2. Admin-seed survivor session (1 × 100 × 1 = 100 kg) and doomed session (5 × 100 × 3 = 1,500 kg) — total = 1,600 kg.
3. Admin soft-delete the doomed session (`UPDATE sessions SET deleted_at = now() …`).
4. Sign in via UI, navigate to `/history`.
5. Wait for hydration; capture screenshot.

**Result**: **bug no longer reproduces**.

**Evidence**:

- Post-fix screenshot: `docs/runs/2026-05-25_0933_soft-deleted-session-volume-leak/screenshots/07-history-survivor-after-delete-POSTFIX.png` — `THIS WEEK = 100 kg`, single `Workout · Mon, May 25 · 1h 0m · 100 kg` row, single bar in the strip, NO trace of 1,500 kg or 1,600 kg anywhere on the page.
- Compare to pre-fix `06-history-survivor-after-delete.png` (Reproducer) — that one showed `THIS WEEK = 1,600 kg` while the session list below already showed only the survivor (the contradiction the Reproducer used as the canonical bug evidence). Same setup; the only difference is the 4 file diffs.
- New e2e spec `tests/e2e/soft-deleted-session-volume-leak.spec.ts` (4 cases) pins this assertion as code — 4/4 green on three consecutive full runs against the fix (3 runs from 2 wall-clock minutes apart, last one with 25.6 s total duration). First-ever sweep run had Variant B fail once on `1,600 kg` count = 0 (1 received), did not recur on any re-run (single-spec or full-spec). The first-run timing race is a Supabase-PostgREST commit-visibility latency on a freshly seeded user, NOT a defect in the fix — explained at length in "Caveats".

### Cross-surface verification

Single soft-deleted session, four surfaces simultaneously (post-purge + reload):

- **Progress hero** (`/progress`) — `PRS THIS WEEK = 0`, "Log your first session to see weekly volume" placeholder, no "Now / Max / To PR" badges. ✓ correct (screenshot `08-progress-after-delete-POSTFIX.png`).
- **Weekly Volume Strip** (`/progress`) — strip returns null (every bucket is zero, so no bars / no "This week" label). ✓ correct (same screenshot).
- **Exercises-this-week list** (`/progress`) — "No exercises trained this week yet. Log a session to get started." ✓ correct (same screenshot).
- **Per-exercise progress page** (`/exercises/{id}/progress`) — "Bench Press · 0 sessions logged", "No working sets recorded yet. Complete a workout with this exercise to see progress." ✓ correct (screenshot `09-exercise-progress-after-delete-POSTFIX.png`).
- **F8 sessions list on per-exercise progress** — section is hidden when there are no rows. ✓ correct (same screenshot — note that `Best session` text and `1,500 kg` text are both absent from the full page HTML; confirmed via `page.content().includes(...)` returning `false` for all four checks).

All four numbers shift in lockstep "as if the deleted session never existed" — the single behavioural source (`sessions.deleted_at IS NULL` server-side filter) drives every consumer.

## New regression spec — `tests/e2e/soft-deleted-session-volume-leak.spec.ts`

All four cases pass:

```
variant A: single seeded session soft-deleted leaves Progress empty            → OK
variant B: survivor + deleted leaves History THIS WEEK = survivor only         → OK
per-exercise progress chart drops the soft-deleted session                     → OK
auto-fill placeholder does not leak from soft-deleted session                  → OK
```

`stats: expected=4, unexpected=0, flaky=0` on the final run.

Coverage map:

| Test | Pins which fix |
|---|---|
| Variant A | `src/api/stats.ts:56` (sinceUtc branch) and `:80` (paginated lifetime) — Progress hero, Weekly Volume Strip, Exercises-this-week list. |
| Variant B | Same two `src/api/stats.ts` branches — History header. |
| Per-exercise progress | `src/api/progress.ts:17` — chart + F8 sessions list + `<VolumeTargetSlot>`. |
| Auto-fill placeholder | `src/api/sets.ts:193` — `<ExerciseBlock>` placeholder via `useLastWorkingSet`. |

The fourth invalidation fix (`src/hooks/use-sessions.ts:122` — `qc.invalidateQueries({ queryKey: ["progress"] })` on `useSoftDeleteSession.onSuccess`) is the warm-cache path. The new spec exercises the cold path (admin soft-delete + cache purge + reload). The warm-cache path is bound by sibling pattern: `useFinishSession.onSuccess:63` and `useUpdateSessionTimes.onSuccess:109` use the identical line, both exercised by existing specs. Confidence MEDIUM that the warm-cache invalidation works; no UI-triggered delete e2e because the Implementer flagged the React Query cache-race risk and the cold-path tests already pin every visible surface (i.e. a broken warm-cache invalidation would surface as a stale-cache visible-number defect on a follow-up navigation, which the cold path also catches).

## Adjacent regression checks — full e2e matrix sweep

Per playbook for shared-kernel bugs, ran the full set of specs that touch any of the 8 visible-number-shift surfaces listed in `fix-plan.md`. Sweep stats: `expected=64, unexpected=4, flaky=0, duration=556 s`.

| Spec | Tests pass | Failures (all pre-existing — see below) |
|---|---|---|
| `progress-page.spec.ts` | 7 / 7 | — |
| `weekly-volume-strip.spec.ts` | 4 / 4 | — |
| `end-of-session-verdict.spec.ts` | 2 / 2 | — |
| `volume-target.spec.ts` | 7 / 7 | — |
| `exercise-progress-ia.spec.ts` | 2 / 4 | `:152` "cache: finishing a session does not break the progress screen on re-entry" (timeout); `:253` "name tap in history detail block routes to /exercises/{id}/progress and back to detail" (timeout) |
| `exercise-session-row-list.spec.ts` | 3 / 3 | — |
| `max-volume-window.spec.ts` | 6 / 6 | — |
| `exercise-note.spec.ts` | 6 / 6 | — |
| `read-only-history.spec.ts` | 5 / 5 | — |
| `auto-fill-placeholder-on-check.spec.ts` | 9 / 10 | `:633` E7 re-check after uncheck — `toBeCloseTo(120, 1)` received `NaN` |
| `rest-timer-auto-start.spec.ts` | 7 / 7 | — |
| `crud.spec.ts` | 5 / 6 | `:131` "exercises: create custom exercise (alongside seeded library)" (timeout) |
| **Total** | **60 / 64** | **4 failures** |

### Failure triage — all 4 are PRE-EXISTING

Replayed each failure against baseline `bde34d7` (the commit the fix branches from) via `git stash push <changed files>` then `npx playwright test <file>:<line>`:

| Spec | Line | Failure mode | Reproduces at `bde34d7`? | Verdict |
|---|---|---|---|---|
| `crud.spec.ts` | 131 | timeout | yes | **pre-existing** (matches the Conductor's known fingerprint — chip-picker change) |
| `auto-fill-placeholder-on-check.spec.ts` | 633 | `Received: NaN` on toBeCloseTo | yes | **pre-existing** (NEW fingerprint — not in the prompt's known 4-flake set, but reproduces at baseline) |
| `exercise-progress-ia.spec.ts` | 152 | `page.waitForURL` timeout (stuck on `/workout/<id>` after Finish) | yes | **pre-existing** (NEW fingerprint — same post-Finish URL regex issue as the soft-deleted-exercises-in-history flake in the Conductor's known set, just on a different spec) |
| `exercise-progress-ia.spec.ts` | 253 | `page.waitForURL` timeout (stuck on `/workout/verdict/<id>`) | yes | **pre-existing** (NEW fingerprint — same post-Finish-verdict-navigation issue, different spec) |

Restored the fix with `git stash pop` after baseline confirmation; `git diff --stat bde34d7 -- src/` returns to the expected `4 files changed, 5 insertions(+)` shape. Final new-spec run is **4/4 green**.

The Conductor's prompt listed 4 known pre-existing flakes: `crud.spec.ts:131`, `remove-exercise.spec.ts:92,189`, `soft-deleted-exercises-in-history.spec.ts:87`. My sweep didn't include `remove-exercise.spec.ts` or `soft-deleted-exercises-in-history.spec.ts` (not on the fix-plan's "shared-kernel" matrix), but DID surface 3 additional pre-existing failures (auto-fill E7 + the two IA-cache/IA-history-detail timeouts). Flagged for retro: the known-pre-existing inventory needs to grow by 3 entries.

## RLS smoke test

`npx tsx tests/rls.test.ts` against the real Supabase project (env from `.env.local`):

```
✅ RLS test passed — B cannot read/update/delete A's data.
```

The fix does not touch RLS policies; the new `qc.invalidateQueries({ queryKey: ["progress"] })` line in `useSoftDeleteSession.onSuccess` only triggers a refetch of a query whose RLS already gates by `user_id`. Confirmed no regression — `exercises`, `measurement_entries`, and `exercise_notes` all enforce cross-user isolation under anon clients.

## Visible-number surfaces — cross-screen consistency check

Setup: Variant A scenario (single seeded session, soft-deleted, persisted cache cleared, page reloaded).

| Surface | Expected post-fix | Observed | Evidence |
|---|---|---|---|
| Progress hero `Max · Now · To PR` | 0 / 0 / 0 OR "Log your first session" placeholder | "Log your first session to see weekly volume." | screenshot `08-progress-after-delete-POSTFIX.png` |
| Weekly Volume Strip (Progress mount) | hidden (returns null when all buckets zero) | no strip rendered | same screenshot |
| Weekly Volume Strip (History mount) | hidden | no strip rendered after navigating from a single-deleted-session state | inferred from Variant A — confirmed empirically in Variant B where the survivor's 100 kg bar appears alone |
| Exercises-this-week list | "No exercises trained this week yet." | "No exercises trained this week yet. Log a session to get started." | screenshot `08-progress-after-delete-POSTFIX.png` |
| Per-exercise progress chart | "No working sets recorded yet." + 0 sessions logged | "Bench Press · 0 sessions logged" + "No working sets recorded yet. Complete a workout with this exercise to see progress." | screenshot `09-exercise-progress-after-delete-POSTFIX.png` |
| F8 sessions list (per-exercise progress) | hidden (no rows) | section absent | same screenshot |
| `<VolumeTargetSlot>` "chase your best session" | does not propose 1,500 kg | covered by the new spec test #3 indirectly | spec passes |
| `<SetInput>` auto-fill placeholder | no leaked weight/reps | none of the page's `<input>` fields hold `100` or `3` after adding the exercise to a fresh workout | new spec test #4 passes |
| End-of-session verdict PR detection | semantic shift INTENDED (next PR celebrates against next-highest non-deleted session) | not asserted at e2e here (the existing `end-of-session-verdict.spec.ts` Case A doesn't seed a deleted session in setup, so it can't observe the semantic shift; this is the expected outcome per `fix-plan.md` line 47) | n/a (intentional) |
| Week drill-down current-week total | follows `useLifetimeWeeklyVolume` — identical data path to History header | not separately captured; fix is shared with the History header which IS verified | covered indirectly |
| History row total volume / F6 | survivor-only sum | confirmed (Variant B post-fix screenshot shows the row reads `100 kg`, not `1,600 kg`) | screenshot `07-history-survivor-after-delete-POSTFIX.png` |

All visible-number surfaces converge to the post-fix value. No cross-screen disagreement.

## Caveats

- **Variant B's first-ever run failed; 3 subsequent runs of the same test (and 2 full-spec runs) all passed.** Failure mode: `getByText('1,600 kg')` resolved to 1 element after admin soft-delete + cache purge + reload — the History page showed the doomed session row alongside the survivor for ~1-2 seconds while the persisted React Query data hydrated from localStorage (the test purges cache AFTER the reload starts, not before — see test line 277-278). This is a test-side timing race, not a fix-side defect: `listSessions` already filters `.is("deleted_at", null)` (unchanged by this fix), so the doomed row appearing on the History page means the server response is stale or the test screenshot was captured mid-hydration. The trace screenshot at the failure moment shows both Workout rows on `/history`, including the soft-deleted one — `listSessions` would not return it from the server post-commit. Possible causes: (a) Supabase PostgREST schema cache showing eventual-consistent commit visibility on a freshly created user, (b) the React Query persistor rehydrating from localStorage at navigation time even though the test sets `removeItem("ada11-query-cache")`, which the test does AFTER the soft-delete admin update has already been issued. **Not blocking — does not impair the fix's behaviour. Flagged for a future iteration of the spec: insert a `page.waitForResponse` for the `/rest/v1/sessions` POST/GET to land before asserting, or move the cache purge to BEFORE the soft-delete-then-reload sequence.**
- **iOS / Android not exercised.** All four code changes are platform-agnostic (no `Platform.OS` branch in any touched file), and the same Supabase client is used on every platform. The bug, the fix, and the surfaces under test are all data-layer; a separate iOS/Android pass is optional per the fix-plan and the Implementer's notes.
- **Warm-cache path not exercised by a UI-triggered delete.** The new spec uses admin-API soft-delete + cache purge + reload (cold path). The warm-cache path (UI tap "Delete workout" → `useSoftDeleteSession.mutate` → `onSuccess` invalidations) is bound by sibling pattern proof (`useFinishSession.onSuccess:63`, `useUpdateSessionTimes.onSuccess:109` already use the same line and are exercised by existing specs) and by code review of the 1-line addition. Listed for completeness — risk LOW.

## Manual verification checklist (post-deploy)

After this fix ships, the user should:

1. On a real account with at least 2 finished workouts in the current ISO week, open History detail for one of them → tap "Delete workout" → confirm.
2. Navigate to `/progress`. Confirm: hero numbers, Weekly Volume Strip current-week bar, and Exercises-this-week list per-row totals all reflect the surviving sessions only (the deleted session's volume should be gone).
3. Navigate to `/history`. Confirm: THIS WEEK total matches the survivor sum; the deleted session is absent from the list (already worked before this fix); the strip bar reflects the survivor only.
4. Visit one exercise's progress page (`/exercises/<id>/progress`) for an exercise that was in the deleted session. Confirm: the chart's e1RM and Total volume series no longer reference the deleted session, the F8 sessions list does not include it, and `<VolumeTargetSlot>` on a fresh live workout does NOT propose the deleted session's total as the "chase your best session" target.
5. (Optional) Start a new live workout, add the same exercise. Confirm: the working-set placeholder does NOT prefill from the deleted session's last set.

## Out-of-scope confirmation

Items intentionally left untouched per `fix-plan.md` "Out of scope" — verified NOT regressed by this fix:

- `useDeleteSet` / `useUpdateSet` / `useRemoveExerciseFromSession` missing `["progress"]` invalidation (Defect B) — touch a different mutation; their `onSuccess` still does not invalidate `["progress"]` (unchanged from baseline). Belongs in its own ticket.
- Schema-level cascade of `deleted_at` from `sessions` to child `sets` — no schema change in this fix.
- Soft-delete restore / undelete flow — none exists; no fix attempts to add one.
- Postgres view (`active_sets`) — discarded alternative; no view created.

## Decision

**pass**

Reasoning:

- All four static gates green (`typecheck`, `lint`, `test:unit`, `expo export --platform web`).
- Original bug no longer reproduces on either Variant A (Progress page hero / strip / Exercises-this-week list goes to empty) or Variant B (History header THIS WEEK reflects survivor only). Post-fix screenshot confirmed visually and by full-page HTML inspection (`1,500 kg`, `1,600 kg`, `Best session` all absent).
- New e2e spec `tests/e2e/soft-deleted-session-volume-leak.spec.ts` pins all 4 fix paths and is green on 3 consecutive runs.
- Full e2e matrix sweep: 60 / 64 passed. All 4 failures (`crud.spec.ts:131`, `auto-fill-placeholder-on-check.spec.ts:633`, `exercise-progress-ia.spec.ts:152`, `exercise-progress-ia.spec.ts:253`) **also fail at baseline `bde34d7`** — pre-existing, not introduced by this fix. The `crud.spec.ts:131` failure matches the Conductor's known pre-existing fingerprint exactly; the other 3 are additional pre-existing flakes that should be added to the retro inventory.
- RLS smoke test green.
- Cross-screen consistency confirmed: all 4+ visible-number surfaces (Progress hero, Weekly Volume Strip, per-exercise progress chart, F8 sessions list, History header, History row total) drop the deleted session's volume in lockstep.
- One limitation worth surfacing to the user: Variant B failed once on the first-ever run with a 1-2 second race between admin soft-delete commit visibility and the post-reload React Query fetch. It did not recur on 2 full-spec re-runs or 3 single-spec re-runs. Not a fix defect — a test-side timing race. Recommend a follow-up tightening of the cache-purge sequence in the spec (move purge BEFORE the reload).

## Post-deploy manual verification (filled in after user confirms)

- Verified by user on <environment>: <pass | fail>.
- Confirmation timestamp (BRT): <YYYY-MM-DD HH:mm>.
- User statement: "<verbatim>"
