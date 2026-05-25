# Fix plan — 2026-05-25_0933_soft-deleted-session-volume-leak

## Scope

**In scope (4 changes across 4 files)**:

1. `src/api/stats.ts:53-60` and `:75-83` — add `.is("sessions.deleted_at", null)` to BOTH branches of `listWeeklyVolumeRows` (`sinceUtc`-bound and paginated lifetime). Single behavioural source for the weekly volume strip, Progress hero, History header, week drill-down, verdict PR list, Exercises-this-week list, and per-session totals in `SessionSummaryRow`.
2. `src/api/progress.ts:10-21` — add `.is("sessions.deleted_at", null)` to `listSetsForExercise`. Source for per-exercise progress chart and `<VolumeTargetSlot>`.
3. `src/api/sets.ts:182-203` — add `.is("sessions.deleted_at", null)` to `getLastWorkingSetForExercise`. Source for the auto-fill placeholder in `<ExerciseBlock>`.
4. `src/hooks/use-sessions.ts:114-124` — add `qc.invalidateQueries({ queryKey: ["progress"] })` to `useSoftDeleteSession.onSuccess`, mirroring the sibling pattern in `useFinishSession.onSuccess` (`:54-66`) and `useUpdateSessionTimes.onSuccess` (`:92-112`).

**Explicitly NOT in scope** (deferred — see Out of scope section):

- `useDeleteSet` / `useUpdateSet` / `useRemoveExerciseFromSession` missing `["progress"]` invalidation (Defect B from repro).
- Schema-level cascade of `deleted_at` from `sessions` to child `sets`.
- Any change to `softDeleteSession` itself (the canonical pattern stays "flip parent timestamp only").
- Undelete / restore flow (none exists; out of bug surface).

## Approach

Surgical 4-call-site fix. Three PostgREST embedded-resource filters and one TanStack invalidation. No schema change, no migration, no RLS change, no behavioural change to `softDeleteSession`. The root cause is that three `from("sets").select(..., sessions!inner(...))` queries forget to constrain the joined `sessions` row by `deleted_at IS NULL` — PostgREST's `!inner` join hint only requires the parent ROW to exist, not that it be non-deleted, and `softDeleteSession` only flips the parent timestamp. The chosen fix matches the established pattern already used at every direct `from("sessions")` SELECT in the codebase (`sessions.ts:6, :16, :28, :64, :78, :92, :106`, `progress-page.ts:21`), so the change is invisible to consumers and stays in the same shape the codebase uses everywhere else. Soft-delete remains canonical: parent flag only, no cascade to children, every read path is responsible for filtering joined deleted parents on its own. The fourth change (warm-cache invalidation) is the established sibling pattern from `useFinishSession` / `useUpdateSessionTimes` — one line, no new abstraction.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/api/stats.ts` | edited | After `.is("deleted_at", null)` on `sets` (lines 55 and 78), insert `.is("sessions.deleted_at", null)` on BOTH branches so the embedded `sessions!inner` join is constrained to non-deleted parents. The `SELECT` constant at `:29` does NOT change — the filter is applied on the query builder, not in the projection list. |
| `src/api/progress.ts` | edited | In `listSetsForExercise`, after the existing `.is("deleted_at", null)` on `sets` (line 16), add `.is("sessions.deleted_at", null)` so the `sessions!inner(id, started_at, ended_at)` join skips soft-deleted parents. |
| `src/api/sets.ts` | edited | In `getLastWorkingSetForExercise`, after the existing `.is("deleted_at", null)` on `sets` (line 192) and BEFORE the `.not("sessions.ended_at", "is", null)` (line 193), add `.is("sessions.deleted_at", null)` so the auto-fill placeholder skips working sets whose parent session has been soft-deleted. |
| `src/hooks/use-sessions.ts` | edited | In `useSoftDeleteSession.onSuccess` (lines 118-122), add `qc.invalidateQueries({ queryKey: ["progress"] });` immediately after the existing `["stats"]` invalidation, mirroring `useFinishSession.onSuccess` (`:63`) and `useUpdateSessionTimes.onSuccess` (`:109`). |

One responsibility per file change. No combinations.

## Contratos de I/O

- **Function signatures / types added or changed**: Nenhum. `WeeklyVolumeRow`, `SessionSets`, `SetRow` shapes are unchanged. `listWeeklyVolumeRows({ sinceUtc? })`, `listSetsForExercise(exerciseId)`, `getLastWorkingSetForExercise(exerciseId)`, `useSoftDeleteSession()` all keep identical signatures and return types.
- **DB columns / queries**: No schema change. The three SELECT queries gain ONE additional WHERE filter each (`sessions.deleted_at IS NULL`), expressed in PostgREST as `.is("sessions.deleted_at", null)`. This is the PostgREST embedded-resource filter syntax — the dotted reference `"sessions.deleted_at"` resolves against the `sessions!inner` embed alias and is sent to the server as `?sessions.deleted_at=is.null` over the wire, which PostgREST translates into a WHERE clause that runs as part of the inner join's matching condition.
- **UI props / state**: Nenhum. No component prop, no hook return shape, no query key, no cache entry shape changes. Visible numbers shift on the surfaces enumerated below — that is the intended user-visible effect, not a contract change.

## Riscos

- **Regressões em fluxos adjacentes**: The four call sites are read by a wide consumer surface. Every one of the following must be sanity-checked because the same SELECTs (or the same `["progress"]` cache key) back them:
  - Progress hero `Max · Now · To PR` (`useCurrentWeekVolume` / `useLifetimeBestWeek` / `usePrsThisWeek` → `listWeeklyVolumeRows`).
  - Weekly Volume Strip (`<WeeklyVolumeStrip>` mounted on Progress AND History — `src/components/weekly-volume-strip.tsx:82`).
  - Exercises-this-week list (`useExercisesThisWeek` → `<ExercisesThisWeekList>`; per-row `Max · Now · To PR`).
  - End-of-session verdict PR detection (`app/(app)/workout/verdict/[sessionId].tsx:46` — `computePrsForSession({ rows: lifetimeQ.data })`). After fix, the next PR celebrates against the next-highest non-deleted session, which is the correct semantic.
  - Per-exercise progress chart (`app/(app)/exercises/[id]/progress.tsx:45` — e1RM and Total volume series both flow through `listSetsForExercise`).
  - `<VolumeTargetSlot>` "chase your best session" target on live workout (`src/components/volume-target-slot.tsx:37`).
  - F8 sessions list on per-exercise progress (same `["progress", exerciseId]` cache).
  - History row total volume / F6 (`useLifetimeWeeklyVolume` + `groupSessionVolumes`).
  - Week drill-down (`app/(app)/history/week/[isoWeek].tsx:53`).
  - `<SetInput>` auto-fill placeholder (`<ExerciseBlock>` `:114` → `useLastWorkingSet` → `getLastWorkingSetForExercise`).
  None of these has an existing e2e that pins the buggy behaviour (Diagnostician verified — `grep softDelete tests/e2e/` empty). Risk of an unrelated test breaking is bounded because no test seeds a soft-deleted session as part of its setup.
- **PostgREST embedded-filter syntax**: The plan relies on `.is("sessions.deleted_at", null)` filtering through the `sessions!inner` embed. This is supported by `@supabase/supabase-js`'s query builder: the dot path is rewritten into `sessions.deleted_at=is.null` in the URL and PostgREST applies it inside the JOIN ON clause. Confirmed by precedent: the existing chain already uses `.not("sessions.ended_at", "is", null)` on the same three queries, so dotted embed filters are already exercised on this exact query shape — adding one more in the same form is mechanically the same operation. **Mitigating risk explicitly**: if the Implementer's local `@supabase/supabase-js` types reject the string literal (TS strictness on overloaded query builder), they should not invent a different API — they should mirror the cast/shape used by the existing `.not("sessions.ended_at", "is", null)` line on the same query and document the deviation in `implementation.md`. TODO: Implementer to verify the `.is()` overload accepts the dotted embed key with the project's pinned `@supabase/supabase-js` version.
- **Data integrity (RLS, migrations, denormalized columns)**: No migration. No RLS change. No denormalized column to refresh. The fix only constrains a read — RLS still gates by `user_id`, and the new filter sits on top of RLS, not in its place.
- **Platform divergence (iOS / Android / web)**: None. All four files are platform-agnostic (`grep -n Platform.OS src/api/{stats,progress,sets}.ts src/hooks/use-sessions.ts` empty). The Supabase client is the same on every platform. iOS/Android were not exercised in repro but the data path is identical, so the fix applies uniformly across the universal app.
- **Cache invalidation cascade**: Adding `["progress"]` to `useSoftDeleteSession.onSuccess` triggers a refetch of every mounted `useExerciseProgress(exerciseId)`. No infinite loop risk: the refetch reads the SELECT (now corrected), populates the cache, and stops. The pattern is already exercised by `useFinishSession.onSuccess` and `useUpdateSessionTimes.onSuccess` with no reported runaway invalidations. The mounted-consumer count is small (one chart, one `<VolumeTargetSlot>` at any given time), so the refetch cost is bounded.
- **Performance**: Negligible. Each new `.is("sessions.deleted_at", null)` is an indexed-column IS NULL predicate inside an `!inner` join PostgREST already runs. No new round-trip, no new pagination, no row-count amplification (the filter only removes rows). The `["progress"]` invalidation refetches a query a user just triggered themselves by deleting a session — latency is hidden by the screens that consume it.
- **Soft-deleted session restore (forward-looking)**: No "undelete" surface exists in the app today (`grep -rn 'restoreSession\|undelete' src/` empty). If one is ever added, it must invalidate the same three caches (`["sessions"]`, `["stats"]`, `["progress"]`) to bring restored volume back into the strip — flagged as a forward-looking note, not a current risk.

## Alternativas descartadas

1. **Cascade `deleted_at` to child `sets` rows inside `softDeleteSession`** — descartada. The codebase's canonical pattern is "soft-delete the parent only; reads filter joins by parent.deleted_at". Cascading would (a) write hundreds of rows per delete, (b) make a future restore strictly harder (need to remember which child rows were already deleted before the parent was), (c) diverge from every other `.is("deleted_at", null)` filter site in `src/api/`. The pure-read fix matches every existing precedent.
2. **Post-fetch JS filter on the client** (drop rows whose `sessions.deleted_at` is non-null after the query returns) — descartada. Forces the SELECT to project `sessions.deleted_at`, ships deleted rows over the wire only to discard them, and leaves the React Query cache shape bloated with rows that will never render. Server-side filter is strictly cheaper and matches the codebase's existing data-shaping discipline.
3. **Introduce a Postgres view (`active_sets`) that pre-filters by `sessions.deleted_at IS NULL`** — descartada. Migration cost + RLS re-wiring + indirection in `src/api/` for a problem solved by a one-line PostgREST filter at three call sites. The view would be the right call only if the same join started repeating in 6+ queries; today the inventory shows exactly three.

## Out of scope (follow-up)

The Reproducer flagged these adjacencies; the Diagnostician explicitly classified them as `minor` or `not-this-run`. Capturing here so they enter `retro.md`:

- **Defect B — `useDeleteSet` / `useUpdateSet` / `useRemoveExerciseFromSession` missing `["progress"]` invalidation** (`src/hooks/use-sets.ts:65-77, 105-110, 112-125`). Different user journey (editing sets on a finished session via History detail), different defect class (warm-cache invalidation gap, not SELECT shape). Folding it in inflates the regression surface and dilutes the test plan. Belongs in its own ticket: "Set-level edits on finished sessions don't refresh per-exercise progress chart".
- **No `softDeleteSession` confirmation telemetry**. The current implementation is fire-and-forget; if the fourth fix below were ever to mis-invalidate, the user wouldn't see an obvious symptom. Out of scope.
- **`groupSessionVolumes` per-session breakdown** behaviour around a deleted session being momentarily present in `useSessions` data and absent in `useLifetimeWeeklyVolume`: today there's a sub-second window during invalidation; the fix doesn't worsen it but doesn't fix it either. Out of scope.
- **Markdown / rich-text rendering** in any surface affected by this fix — none touched.
- **Postgres view for active sets** — see Alternative 3.
- **Restore / undelete sessions** — not in the app, not in scope.

## Regression test plan (preview — Regression Tester will execute)

### Static gates

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npx expo export --platform web`

### New e2e: `tests/e2e/soft-deleted-session-volume-leak.spec.ts`

Pin the repro at the e2e level. Mirror the test #3 admin-seed + deep-link pattern from `tests/e2e/exercise-note.spec.ts` (admin `createUser` → admin INSERT into `sessions` + `sets` → sign in via UI → navigate to surface) to avoid React Query cache races. Tests:

1. **Variant A (single session)**: seed user + ONE finished session this ISO week (5×100×3 = 1,500 kg) → assert Progress hero reads `1,500 kg` and weekly volume strip shows a bar. Admin `UPDATE sessions SET deleted_at = now() WHERE id = ...`. Clear `localStorage.removeItem("ada11-query-cache")` + reload. Navigate `/progress` → assert hero shows `Max 0 kg · Now 0 kg · To PR 0 kg`, strip returns null (no bars rendered), Exercises-this-week list is empty.
2. **Variant B (survivor + deleted)**: seed user + TWO finished sessions today (survivor = 100 kg, doomed = 1,500 kg). Admin soft-delete doomed. Clear cache + reload. Navigate `/history` → assert `THIS WEEK = 100 kg`, session list has exactly ONE row, the survivor.
3. **Warm-cache path (no reload)**: mount `/progress`, observe `1,500 kg`. WITHOUT clearing localStorage, soft-delete via admin AND fire a `useSoftDeleteSession` mutate from the UI (whichever the test harness can drive). Assert the page repaints to the empty-state values within the React Query refetch window. Specifically guards the `["progress"]` invalidation fix.
4. **Per-exercise progress regression**: deep-link to `/exercises/<id>/progress` for the seeded exercise after Variant A's delete. Assert the chart's "Total volume" series is empty for the current week and `<VolumeTargetSlot>` does NOT propose 1,500 kg as the target to chase.
5. **Auto-fill placeholder regression** (`getLastWorkingSetForExercise`): with a deleted session as the ONLY history for the exercise, start a new live session, add the exercise, assert the `<SetInput>` placeholder is empty (no leaked 100 kg × 3 default).

### Unit-level pinning

The three SELECTs are not directly hook-mockable today (they hit the live Supabase client). The repro already proves the leak at the e2e level; adding a unit shim would require fabricating a Supabase mock that doesn't exist elsewhere in the suite. Recommendation: rely on e2e + the existing `tests/unit/lib/*` math tests (they assume input rows are correctly filtered upstream — the contract is now actually upheld).

### Replay original reproduction

Re-run Variant A and Variant B steps from `repro.md` manually via the Playwright spec; both must transition from "leak observed" to "leak absent". Diff the new run's screenshots against `03-progress-after-delete.png` and `06-history-survivor-after-delete.png` — values must drop to 0 / 100 kg respectively.

### Adjacent regression checks (full e2e sweep)

Diagnostician predicted LOW cascade risk, but the playbook requires a full matrix for shared-kernel bugs because the four touched call sites underpin most of the app's number rendering:

- `tests/e2e/weekly-volume-strip.spec.ts`
- `tests/e2e/progress-page.spec.ts`
- `tests/e2e/max-volume-window.spec.ts`
- `tests/e2e/week-drill-down.spec.ts`
- `tests/e2e/end-of-session-verdict.spec.ts`
- `tests/e2e/session-total-volume-header.spec.ts`
- `tests/e2e/volume-target.spec.ts`
- `tests/e2e/exercise-progress-ia.spec.ts`
- `tests/e2e/auto-fill-placeholder-on-check.spec.ts`
- `tests/e2e/crud.spec.ts` (exercises the soft-delete flow at UI level)
- All other `tests/e2e/*.spec.ts` (run the full matrix per playbook for shared-kernel bugs).

### Visible-number shift surfaces to watch on regression

For each, the value must drop to "as-if the deleted session never existed":

- Progress hero `Max · Now · To PR` (Progress index).
- Weekly Volume Strip current-week bar (both Progress mount and History mount).
- Exercises-this-week list per-row `Max · Now · To PR`.
- End-of-session verdict PR detection (next PR celebrates against next-highest non-deleted session — semantic shift, INTENDED).
- `<VolumeTargetSlot>` on live workout.
- Per-exercise progress chart e1RM series + Total volume series (`app/(app)/exercises/[id]/progress.tsx`).
- F8 sessions list on per-exercise progress.
- `<SetInput>` auto-fill placeholder on live workout when starting an exercise whose only prior history was in a now-deleted session.
- F6 history-row total volume.
- Week drill-down current-week total.

### Manual verification needed?

**Yes, light touch.** After the e2e suite passes, the human approver should:

1. On a real account, soft-delete one workout from History detail, then visit Progress and History. Spot-check that THIS WEEK matches the surviving-session sum.
2. Visit one exercise's progress chart; verify the chart and `<VolumeTargetSlot>` no longer reference the deleted session.

iOS / Android smoke check is optional — the fix is platform-agnostic and the repro was web-only by design, but the Tester or human approver may exercise an iOS Expo Go run if cycle time allows.

## Confidence / Risk

- **Confiança: ALTA** — root cause traced to four explicit lines; the fix pattern is mechanically identical to the one already used at every direct `from("sessions")` SELECT in `src/api/` (so the change matches established style and PostgREST semantics); the warm-cache invalidation has two existing sibling patterns in the same file (`useFinishSession`, `useUpdateSessionTimes`); the repro is 100% deterministic and the inventory (3 of 17 `from("sets")` SELECTs) leaves no ambiguity about where else the same defect could hide.
- **Risco: MÉDIO** — the fix changes visible numbers on the most-trafficked Progress and History surfaces for any user with a soft-deleted session. Reversible (one line per call site, no schema change) and bounded (no migration, no RLS, no API contract change), but the cascade surface is wide and the PR-semantics shift (next PR celebrates against next-highest non-deleted session) is intentional and per-affected-user irreversible. Regression Tester MUST run the full e2e suite, not just the new repro spec.

## Awaiting

Human approval before Implement phase.
