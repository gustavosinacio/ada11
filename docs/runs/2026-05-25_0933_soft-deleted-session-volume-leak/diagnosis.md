# Diagnosis — 2026-05-25_0933_soft-deleted-session-volume-leak

## Hypothesis (state BEFORE searching)

Given the repro — soft-deleting a session leaves its volume on every
surface that reads finished-session sets — I suspect the cause is exactly
three Supabase SELECT call sites in `src/api/{stats,progress,sets}.ts`
that join `sets → sessions!inner` without filtering on
`sessions.deleted_at IS NULL`. The `!inner` join only requires the parent
session ROW to exist, not that it be non-deleted; `softDeleteSession`
only flips `sessions.deleted_at`, not `sets.deleted_at`, so the joined
rows survive every filter the queries DO apply (`sets.deleted_at IS
NULL`, `sets.completed_at IS NOT NULL`, `sessions.ended_at IS NOT NULL`,
`set_type != 'warmup'`). The user-visible "still counts towards weekly
volume" symptom is the natural consequence: every downstream weekly
volume, lifetime max, PR detector, and per-exercise progress derivation
runs over a set list that still contains the doomed session's rows.

This hypothesis is consistent with:

- The repro reproduces 100 % even after `localStorage.removeItem` +
  reload (so it's not a cache/invalidation bug — it's a SELECT-shape
  bug).
- Every surface listed by the Reproducer routes through one of those
  three queries (verified below).
- `from("sessions")` SELECTs (`sessions.ts:8,19,30`,
  `progress-page.ts:23`) already include `.is("deleted_at", null)` —
  the table is well-guarded on its own side. The leak is exclusively
  via the joined-table side.

## Evidence

### Source-of-truth files (verified by reading)

- `src/api/stats.ts:29` (SELECT constant), used at `:53` and `:76` —
  `"completed_at, weight, reps, set_type, exercise_id, session_id,
  sessions!inner(started_at, ended_at)"`. Both branches
  (`sinceUtc`-bound at `:53-60` and lifetime paginated at `:75-83`)
  filter on `sets.deleted_at IS NULL` and `sessions.ended_at IS NOT
  NULL` and `set_type != 'warmup'`, but neither filters on
  `sessions.deleted_at IS NULL`. Verified by reading lines 28-89.
- `src/api/progress.ts:13` —
  `.select("*, sessions!inner(id, started_at, ended_at)")` with
  `.is("deleted_at", null)` (on `sets`) and `.not("sessions.ended_at",
  "is", null)`, but no `.is("sessions.deleted_at", null)`. Verified at
  lines 10-21.
- `src/api/sets.ts:187` (inside `getLastWorkingSetForExercise`) —
  `.select("*, sessions!inner(ended_at)")` with `.is("deleted_at",
  null)` (on `sets`) and `.not("sessions.ended_at", "is", null)`, no
  `.is("sessions.deleted_at", null)`. Verified at lines 182-203.
- `src/api/sessions.ts:115-121` — `softDeleteSession` only flips
  `sessions.deleted_at`. It does NOT cascade to `sets.deleted_at`.
  Confirms why the three SELECT sites still see the doomed rows: the
  rows themselves are untouched on the `sets` side; only the parent
  session got the timestamp.
- `src/hooks/use-sessions.ts:114-124` — `useSoftDeleteSession.onSuccess`
  invalidates `["sessions"]`, `["sessions","active"]`, `["stats"]`. It
  does NOT invalidate `["progress"]`. Compare to `useFinishSession` at
  `:54-66` which DOES invalidate `["progress"]` (line 63) — proof that
  `["progress"]` is the established invalidation target for events
  that change finished-session set membership.
- `src/hooks/use-progress.ts:5-11` — `useExerciseProgress` query key is
  `["progress", exerciseId]`. Per-exercise progress chart and
  `<VolumeTargetSlot>` both subscribe to this key (consumers verified
  below). After the SELECT fix lands, the warm cache populated before
  the soft-delete still holds the doomed rows — `useSoftDeleteSession`
  must add `["progress"]` to its invalidation list for the warm path
  to recover without a manual refetch.
- `src/hooks/use-stats.ts:24-28` — `useLifetimeWeeklyVolume` query key
  is `["stats", "weekly-volume", "lifetime"]`. Sits under the
  `["stats"]` prefix, so `useSoftDeleteSession`'s existing
  `["stats"]` invalidation already cascades — once the SELECT is
  fixed, the warm-cache refetch returns the corrected rows
  automatically. No `useSoftDeleteSession` change is needed for the
  `["stats"]` surfaces.

### Surface routing (spot-check of consumers)

Independent spot-check confirms the Reproducer's enumeration of
affected surfaces. All three SELECTs and at least three downstream
surfaces verified:

- `src/components/weekly-volume-strip.tsx:82` —
  `useLifetimeWeeklyVolume()` → `listWeeklyVolumeRows`. Used by
  Progress page AND History list header (`app/(app)/history/index.tsx:55`
  mounts `<WeeklyVolumeStrip />` as `ListHeaderComponent`).
- `app/(app)/history/index.tsx:19` — direct
  `useLifetimeWeeklyVolume()` call feeds `groupSessionVolumes` for
  per-session totals on each `SessionSummaryRow`.
- `app/(app)/workout/verdict/[sessionId].tsx:46-70` —
  `useLifetimeWeeklyVolume()` feeds `computePrsForSession({ rows:
  lifetimeQ.data, ... })`, i.e. the PR detector reads the same
  potentially-leaking row set. Confirms the PR-semantics
  question: once the SELECT is fixed, the windowed/lifetime max is
  computed without the deleted session's rows, and the next PR
  celebrates against the next-highest non-deleted session.
- `app/(app)/exercises/[id]/progress.tsx:45` and
  `src/components/volume-target-slot.tsx:37` — both call
  `useExerciseProgress(id)` → `listSetsForExercise`. Both route through
  the leaky `progress.ts:13` SELECT and through the `["progress",
  exerciseId]` cache key.
- `src/components/exercise-block.tsx:114` —
  `useLastWorkingSet(exercise.id)` → `getLastWorkingSetForExercise`
  → leaky `sets.ts:187` SELECT.

### Sets-query inventory (cross-check of Reproducer's claim)

`grep -rn 'from("sets"' src/` returns 17 lines (not 14 — Reproducer
miscounted, but the conclusion is unaffected). I read every match:

- `src/api/stats.ts:53, :76` — the two leak sites in `listWeeklyVolumeRows`.
- `src/api/progress.ts:12` — the leak site in `listSetsForExercise`.
- `src/api/sets.ts:186` — the leak site in
  `getLastWorkingSetForExercise`.
- `src/api/sets.ts:45, :65, :76, :131, :167, :207, :227, :241, :255,
  :270, :297, :308, :320` — single-session-scoped (`eq("session_id",
  ...)`) or pure mutation (UPDATE/INSERT). Each of these is either
  invoked from a code path where the session is already known
  non-deleted (the active-session screen for the live workout, the
  detail screen for finished history) OR is a write. None feeds a
  cross-session aggregation.

Cross-check via `grep -rn 'sessions!inner\|sessions!left\|from("sessions"'`:
exactly three `sessions!inner` matches — they're at the three leak
sites above. Every `from("sessions")` SELECT
(`sessions.ts:6, :16, :28, :64, :78, :92, :106`,
`progress-page.ts:21`) already filters
`.is("deleted_at", null)` on its read paths. **Confirmed: no other
query in `src/api/` joins or selects `sessions` without filtering
deleted ones.**

### Candidate locations affected by the same root cause

| File:Line | Token / pattern | Context | Severity |
|---|---|---|---|
| `src/api/stats.ts:53-60` | `sessions!inner` SELECT, `sinceUtc` branch | Weekly Volume Strip, Progress hero, History header, week drill-down, verdict PR list | blocker |
| `src/api/stats.ts:75-83` | `sessions!inner` SELECT, lifetime paginated branch | Same consumers (`useLifetimeWeeklyVolume` always hits this branch in prod; `sinceUtc` branch is test-only per `use-stats.ts:14-18` JSDoc) | blocker |
| `src/api/progress.ts:10-21` | `sessions!inner` SELECT in `listSetsForExercise` | Per-exercise progress chart, `<VolumeTargetSlot>` | blocker |
| `src/api/sets.ts:182-203` | `sessions!inner` SELECT in `getLastWorkingSetForExercise` | Auto-fill placeholder in `<ExerciseBlock>` for next working set | major |
| `src/hooks/use-sessions.ts:118-123` | `useSoftDeleteSession.onSuccess` missing `["progress"]` invalidation | Warm cache for per-exercise progress chart + `<VolumeTargetSlot>` stays stale after soft-delete; cold path is cured by the SELECT fix above | major |
| `src/hooks/use-sets.ts` (`useDeleteSet:105-110`, `useUpdateSet:65-77`, `useRemoveExerciseFromSession:112-125`) | Same `["progress"]` invalidation gap on set-level mutations inside a finished session | Adjacent defect class — set-level edits change `listSetsForExercise` output but `["progress"]` is only invalidated on finish/time-edit (see `use-sessions.ts:62-63, 108-110`) | minor (out of scope) |

### Cross-environment confirmation

The repro was exercised only on web (Chromium via Playwright). The fix
lives in `src/api/{stats,progress,sets}.ts` and `src/hooks/use-sessions.ts`,
all of which are platform-agnostic — they read/write Supabase via the
shared `~/lib/supabase` client. There is no `Platform.OS` branch in any
of these files (verified by grep). There is no Supabase function /
RLS-layer filter that would mask the leak on native — RLS only
constrains by `user_id`, not by `deleted_at`. So **the bug manifests
identically on iOS and Android**; the user only happened to notice it
on web. No environment specificity to explain.

## Root cause

Three Supabase SELECT call sites that join `sets → sessions!inner`
forget to filter the joined table by `sessions.deleted_at IS NULL`:

1. `src/api/stats.ts:53-60` and `:75-83` — `listWeeklyVolumeRows`
   (both branches).
2. `src/api/progress.ts:10-21` — `listSetsForExercise`.
3. `src/api/sets.ts:182-203` — `getLastWorkingSetForExercise`.

PostgREST's `!inner` join hint requires only that the parent row
EXIST — it does not require `parent.deleted_at IS NULL`. Soft-deleting
a session via `softDeleteSession` (`src/api/sessions.ts:115-121`) flips
`sessions.deleted_at` and nothing else; the rows in `sets` retain
`deleted_at IS NULL` and `completed_at IS NOT NULL` and their parent
session still has `ended_at IS NOT NULL`, so they pass every filter
those three SELECTs DO apply. Every downstream surface that derives
volume / PR / max from those rows therefore behaves as if the deleted
session were still present.

Distinct from the symptom: the user-visible "still counts towards
weekly volume" is just the most-noticed downstream effect. The root
cause is the SELECT shape, and the leak is broader than the user
worded it (verdict-screen PR detection, per-exercise chart, volume
target, auto-fill placeholder all leak by the same mechanism).

## Severity classification

- **Blocker** — user-facing, data-affecting on the most-visited surfaces:
  - `src/api/stats.ts:53-60` and `:75-83` — root cause for weekly
    volume strip, Progress hero (`Max · Now · To PR`), History header,
    week drill-down, verdict PR list, exercises-this-week list,
    per-session totals in `SessionSummaryRow`. Single fix (add
    `.is("sessions.deleted_at", null)` to both branches) cures all
    these surfaces.
  - `src/api/progress.ts:10-21` — root cause for per-exercise progress
    chart and `<VolumeTargetSlot>` "chase your best session" target.
    Single fix.

- **Major** — should fix in this run; same root cause and same
  defect class:
  - `src/api/sets.ts:182-203` — auto-fill placeholder leaks a working
    set from a soft-deleted session into the live workout screen.
    Lower visibility (no number on screen, just a wrong default
    placeholder), but bundling it with the three-SELECT fix costs one
    line and avoids a second pipeline run for the same defect class.
  - `src/hooks/use-sessions.ts:118-123` — `useSoftDeleteSession`
    must invalidate `["progress"]` for the warm-cache path on the
    per-exercise progress chart and `<VolumeTargetSlot>`. Reproducer
    flagged this as Defect A. **Decision: fold into scope.**
    Justification: same user-visible bug class ("the deleted session
    keeps showing up"), trivially small change (one line), and
    without it the SELECT fix only cures the cold path. Cold-only
    fix would leave a real regression on the most-common UI flow —
    user is already on the exercise progress chart, deletes a
    session, watches the chart not update.

- **Minor (out of scope by default)** — note for follow-up; do NOT
  address in this run:
  - `src/hooks/use-sets.ts` — `useDeleteSet` / `useUpdateSet` /
    `useRemoveExerciseFromSession` skip `["progress"]` invalidation.
    Reproducer flagged this as Defect B. **Decision: defer to a
    separate ticket.** Justification: adjacent defect class
    ("set-level edits inside a finished session don't refresh the
    progress chart"), different user journey (the user has to be
    editing sets on a finished session via the History detail
    screen, not deleting a session), not part of the verbal report.
    Folding it in inflates the regression surface and dilutes the
    test plan. The "while I'm here" anti-pattern in playbook-fix.md
    applies. Capture as a follow-up in `retro.md`.

## Symptom-only fix risk

The fix is at the root cause, not at the symptom level. Adding
`.is("sessions.deleted_at", null)` to the three `!inner` joins matches
the established pattern at every direct `from("sessions")` SELECT and
removes the leak at the source. No symptom-level patching (e.g.
post-filtering on the client, or hiding the Volume Strip when a
delete just happened) is needed or recommended.

## Existing tests that pin the buggy behavior

Searched `tests/unit/`, `tests/e2e/`, `tests/rls.test.ts`, and
`tests/seed-and-auth.test.ts` for:
- assertions on soft-deleted SESSION rows (`deleted_at` on sessions);
- assertions that `listWeeklyVolumeRows` / `listSetsForExercise` /
  `getLastWorkingSetForExercise` return rows from deleted sessions.

**Finding: zero tests pin the buggy behavior.** All `deleted_at`
matches in the test suite are either:
- Fixture rows constructed with `deleted_at: null` (filler default,
  no assertion attached).
- Filters on `exercises.deleted_at` in `tests/e2e/*.spec.ts:70-95`
  (test setup picks a non-deleted seed exercise — unrelated to
  session deletion).
- `read-only-history-display.test.ts:231-233` — tests the
  soft-deleted EXERCISE suffix in the row title (unrelated to
  session volume leakage).
- `soft-deleted-exercises-in-history.spec.ts` — tests soft-deleted
  EXERCISES, not sessions.

No existing test will need to flip when the fix lands.

## Cascade risk on existing e2e assertions

For each spec that asserts on visible volume / PR / max numbers,
checked whether the test seeds a session that gets soft-deleted during
the run. **None do** — searched for `softDelete` / `update.*deleted_at`
across `tests/e2e/*.spec.ts`: zero hits on session-level soft-delete.

Surfaces sorted by likelihood of accidental regression after the fix:

1. `tests/e2e/weekly-volume-strip.spec.ts`, `progress-page.spec.ts`,
   `max-volume-window.spec.ts`, `week-drill-down.spec.ts`,
   `end-of-session-verdict.spec.ts`, `session-total-volume-header.spec.ts`
   — all consume `useLifetimeWeeklyVolume` or its math. Risk: LOW.
   None creates soft-deleted sessions during their setup.
2. `tests/e2e/volume-target.spec.ts`, `exercise-progress-ia.spec.ts`
   — consume `useExerciseProgress`. Risk: LOW. Same reason.
3. `tests/e2e/auto-fill-placeholder-on-check.spec.ts` — consumes
   `useLastWorkingSet`. Risk: LOW. Same reason.
4. `tests/e2e/crud.spec.ts` — exercises the soft-delete flow at the UI
   level. **Spot-checked**: it does not subsequently assert on a
   volume / PR figure that would be affected by the absent session.
   Risk: LOW.

Conclusion: the fix is expected to flip exactly the surfaces shown in
the repro screenshots (3 and 6) without breaking any existing test.
Regression Tester should still re-run the full e2e suite — the
above is a written prediction, not a verified test pass.

## Confidence and risk

- **Confidence: HIGH** — root cause traced to three explicit SELECT
  call sites; the fix pattern is the same single-line addition
  already present at every `from("sessions")` SELECT in the codebase
  (so the change matches established style and PostgREST semantics);
  the deterministic repro plus the inventory of joined queries (3 of
  17 `from("sets")` SELECTs) leaves no ambiguity about where else the
  same defect could hide. Defect A (warm-cache invalidation gap) is
  also HIGH-confidence: query key shape verified, mutation
  invalidation list verified, established sibling pattern in
  `useFinishSession.onSuccess` verified.
- **Risk: MEDIUM** — the fix changes visible numbers on the
  most-trafficked Progress and History surfaces for any user with a
  soft-deleted session. Reversible (one-line per call site) and
  bounded (no schema migration, no RLS change), but the cascade
  surface is wide: weekly volume strip, Progress hero, History
  header, week drill-down, verdict PR list, per-exercise chart,
  volume target, auto-fill placeholder. Regression Tester MUST run
  the full e2e suite, not just the new repro spec. The PR-semantics
  shift (next PR celebrates against the next-highest non-deleted
  session) is intentional and consistent with the user's expectation
  ("removed session must not count").
