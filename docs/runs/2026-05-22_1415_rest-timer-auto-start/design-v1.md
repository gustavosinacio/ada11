# Design v1 — 2026-05-22_1415_rest-timer-auto-start

## Goal (1 sentence)

When the user checks a working set on the live workout screen, auto-start (or reset) the rest timer using the routine's `target_rest_seconds` for that exercise — mirroring the existing post-add-set auto-start, gated on working sets only, and silent when no rest target is configured.

## Approach

Plug a single new call into `onToggleSetChecked` on `app/(app)/workout/[sessionId].tsx`: when `nextChecked === true` AND the toggled set is a `working` set AND `restByExercise.get(ex.id)` returns a positive number, fire `restTimer.start(rest)` **optimistically** — before awaiting `checkSetM.mutateAsync(id)` — so the rest UI feels instant. The existing `useRestTimer.start(seconds)` already overwrites any in-flight timer (manual or auto), giving us "reset on next check" for free. No hook change, no new prop, no DB change, no schema change. The handler reads the set's `set_type` from `setsByExercise.get(ex.id)` (already in scope on the same render) so warmup and dropset sets do **not** trigger the timer. Uncheck remains a no-op for the timer — it only calls `uncheckSetM`. The implementation is structurally a twin of the existing add-set auto-start at `[sessionId].tsx:373-376`; the only behavioral divergence is the `dropset` exclusion (rationale below).

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/workout/[sessionId].tsx` | edited | Extend the inline `onToggleSetChecked` handler (lines 411-421) to fire `restTimer.start(rest)` optimistically when the toggle is `nextChecked === true`, the set's `set_type === "working"`, and `restByExercise.get(ex.id)` returns a positive number. No other edits to the file; no signature change to `<ExerciseBlock>`. |

That is the single change. One responsibility per file (the file already owns the live-screen orchestration; this adds one more rule to the same handler).

## Contratos de I/O

### Function signatures / types added or changed

None. All types are reused as-is.

- `onToggleSetChecked: (id: string, nextChecked: boolean) => Promise<void>` — prop on `<ExerciseBlock>`, **unchanged**.
- `useRestTimer().start: (seconds: number) => void` — **unchanged**. Guards internally on `Number.isFinite(seconds) && seconds > 0` (`src/hooks/use-rest-timer.ts:78`). Overwrites any in-flight `endsAt` / `totalSeconds`. Persists to AsyncStorage. No new method needed.
- `restByExercise: Map<string, number>` — already built once via `useMemo` from `routineExercisesQ.data` filtering to entries where `target_rest_seconds > 0` (`[sessionId].tsx:91-99`). The new call reuses the existing map verbatim.
- `setsByExercise: Map<string, SetRow[]>` — already built via `useMemo` from `setsQ.data` (`[sessionId].tsx:183-191`). New handler does a `.find((s) => s.id === id)` against this map to look up the toggled set's `set_type`. Pure read.
- `SetRow.set_type: "warmup" | "working" | "dropset"` (from `src/db/types.ts:121`). Already on every row of `setsQ.data`. No type widening.

### Exact handler shape (after edit)

```ts
onToggleSetChecked={async (id, nextChecked) => {
  // Optimistic auto-start of rest timer on transition to checked.
  // Mirrors the post-add-set trigger at line 373-376: gated on a
  // positive routine rest target for this exercise, silent no-op
  // otherwise. Working sets only — warmups and dropsets do not
  // start a rest. Fires BEFORE the mutation so the overlay flips
  // to "Resting" with no perceptible delay.
  if (nextChecked) {
    const toggled = (setsByExercise.get(ex.id) ?? []).find(
      (s) => s.id === id,
    );
    if (toggled?.set_type === "working") {
      const rest = restByExercise.get(ex.id);
      if (rest && rest > 0) restTimer.start(rest);
    }
  }

  try {
    if (nextChecked) {
      await checkSetM.mutateAsync(id);
    } else {
      await uncheckSetM.mutateAsync(id);
    }
  } catch (err) {
    console.warn("Toggle set check failed", err);
  }
}}
```

### DB columns / queries

None added or changed.

- Reads: `routine_exercises.target_rest_seconds` (already fetched by `useRoutineExercises`), `sets.set_type` (already fetched by `useSets`). Both columns exist and are typed (`docs/data-model.md`).
- Writes: only the unchanged `sets.completed_at = now()` via `checkSet(id)`.
- RLS: untouched. No new query, no policy change.

### UI props / state

None added. The screen-level `restTimer` instance at `[sessionId].tsx:69` and the always-mounted `<RestTimerOverlay>` at line 479 already subscribe to the same hook; flipping `endsAt` re-renders the overlay from idle → running automatically. No change to `<ExerciseBlock>`, `<SetInput>`, or `<RestTimerOverlay>`.

## Riscos

### Data integrity (RLS / migrations)

- **None.** Feature is pure client-side wiring on top of values already loaded. No write to `sets`, `routine_exercises`, or any other table beyond the pre-existing `checkSet` UPDATE. RLS policies unaffected. No migration. No cache-buster bump.

### UX regressions

- **Optimistic phantom-start on mutation failure.** If `checkSetM.mutateAsync(id)` rejects (network drop, RLS denial, transient PostgREST 5xx), the timer is already running but the row's `completed_at` stays null and the green tint never appears. The user sees "Resting 90s…" without a visible check. Mitigation: rare in practice; the user can tap **Skip** on the overlay (already wired to `stop`) to dismiss. The existing `console.warn` keeps a trail. **Trade-off accepted**: instant timer start is the dominant UX win on the highest-frequency action in the session. Documented here so Validator and Reviewer can weigh.
- **Manual quick-start gets preempted by auto-start.** If the user manually taps "120s" on the overlay quick-start buttons and then checks a working set on an exercise with `target_rest_seconds = 60`, the auto-start replaces the 120s timer with a 60s one. This matches the spec ("If another set is checked, timer needs to reset") and the user's lean (Q3). Documented for Validator.
- **Cross-exercise check with no target leaves a stale timer running.** If exercise A has `target_rest_seconds = 120` (timer running with 60s left) and the user checks a working set on exercise B which has no target, the no-op path leaves exercise A's timer running. Visually consistent (the overlay doesn't suddenly disappear), but semantically the timer is no longer tied to a fresh rest. Acceptable per the silent no-op rule (Q2/Q5 lean) — but worth flagging.
- **Dropset divergence from add-set precedent.** The add-set auto-start fires on dropsets (`set_type !== "warmup"`). The new check trigger does NOT fire on dropsets. Users may notice the asymmetry: "tap +Drop set → timer starts; tap check on the drop → timer doesn't". The Conductor lean (Q7) is intentional — dropsets chain to a working set with no rest between drops. Acceptable; documented for Reviewer.
- **Warmup re-check edge case.** The user checks a warmup (no timer), then later unchecks/re-checks it — no timer, by design. Consistent across both paths.
- **Bulk "Check all and finish" still bypasses this handler** (uses `bulkCheckAll` directly, `[sessionId].tsx:259-269`). No auto-start fires on the bulk path. Desired — user is finishing, not training. No regression risk.

### Platform-specific

- **None.** Web + iOS share the `useRestTimer` hook with the same AsyncStorage persistence. The trigger fires inside a JS handler that runs identically on both. No native API, no platform fork.

### Performance

- **Negligible.** Each working-set check incurs:
  - 1 `Map.get` (O(1)) against `setsByExercise`,
  - 1 `Array.find` (O(n) where n = sets on the exercise, typically <10) to locate the toggled set by id,
  - 1 `Map.get` (O(1)) against `restByExercise`,
  - 1 conditional `restTimer.start(rest)` call (two `useState` setters + one `AsyncStorage.setItem`).
- No TanStack invalidation. No new render path. The `<RestTimerOverlay>` re-render is already happening today on manual starts; not new.
- The `Array.find` can be swapped for a `setById` map if profiling shows it matters — out of scope for v1.

## Alternativas descartadas

1. **Post-success placement (await mutation, then start)** — call `restTimer.start(rest)` only after `await checkSetM.mutateAsync(id)` resolves. Descartada porque the added latency (~50-150ms typical PostgREST round-trip; worse on poor connections) is perceptible on the session's most frequent action. The phantom-start failure mode is rare and recoverable via Skip; the latency cost is paid on **every** check. The Conductor explicitly leaned optimistic.

2. **Discriminate the toggled set's `set_type` by threading a new prop through `<ExerciseBlock>` / `<SetInput>`** — extend `onToggleChecked` to pass `setType` as a third arg. Descartada porque the screen already has `setsByExercise` in scope; reading `set_type` there avoids a cross-component prop change and keeps `<ExerciseBlock>` / `<SetInput>` unchanged. Smaller blast radius, no signature churn.

3. **Always overwrite on cross-exercise check, even when the new exercise has no target** — when checking a set on an exercise without `target_rest_seconds`, call `restTimer.stop()` to kill any running timer. Descartada porque it would punish a between-exercises check by yanking the user's current rest, with no UX gain (the user can hit Skip if they actually want to stop). The Conductor's lean (Q5) is "silent no-op" — leave running timers alone when there's no positive target on the new exercise. Matches the established precedent for add-set.

4. **Default to 90s when no `target_rest_seconds` is configured** — match the overlay's first quick-start option. Descartada porque the user's implicit signal (per Conductor lean Q2) is "only auto-start when the user has set up rest". Imposing a default would surprise users on routines that intentionally omit rest, and on ad-hoc sessions with no routine at all. Existing add-set precedent also silent-no-ops; consistency wins.

5. **Fire on dropset check (mirror add-set precedent exactly)** — drop the `set_type === "working"` filter and use `set_type !== "warmup"` like the add-set handler. Descartada because a dropset is by definition the chained tail of a working set with no rest between drops; firing a rest timer on each drop check would force the user to Skip repeatedly. The Conductor's lean (Q7) is explicit: working sets only.

6. **Add a `useRestTimer.reset()` method distinct from `start()`** — to make the "reset on next check" semantic explicit at the call site. Descartada because `start(seconds)` already replaces `endsAt` / `totalSeconds` / AsyncStorage unconditionally (`src/hooks/use-rest-timer.ts:77-86`). Adding `reset()` would just alias `start()` — zero behavioral gain, more surface area to maintain.

## Out of scope

- Native push / haptic / sound when the rest timer ends (tracked in `docs/iphone-shakedown.md` and `docs/roadmap.md`).
- Per-exercise opt-out affordance ("no rest after this exercise's sets") — current model already lets a routine set `target_rest_seconds = null` or omit the entry to achieve this.
- Per-set-type rest seconds (e.g., longer rest after the last drop). Single `target_rest_seconds` per `(routine, exercise)` remains the contract.
- Backfilling unit tests for the existing add-set auto-start (no coverage today; tempting but separate work).
- Visual changes to `<RestTimerOverlay>` (quick-start buttons, Skip behavior).
- A "stale timer" visual cue distinguishing manually-started vs. auto-started rests (no UX ask).
- Recording rest duration to the DB / analytics (Decision 9 says timer is client-side only).

## Test plan (Tester input)

### Unit

- **None required.** The change is a 6-line wiring tweak in a JSX-embedded handler. The branching it adds (`nextChecked && set_type === "working" && rest > 0`) is straight-line boolean logic — covered by the e2e checks below. The downstream `useRestTimer.start` already has implicit coverage via the existing add-set auto-start (no formal tests, but exercised in the same screen). No new pure function or module to unit-test in isolation.

### End-to-end (Playwright web flow)

1. **Auto-start fires on working-set check.**
   - Setup: session linked to a routine with `target_rest_seconds = 60` for exercise A; one logged working set on A with `completed_at = null`.
   - Action: tap the check button on that working set.
   - Assert: rest timer overlay flips from idle to "Resting" within ~250ms; remaining time starts at ~60s.

2. **Auto-start does NOT fire on warmup-set check.**
   - Setup: same routine; one logged warmup set on A.
   - Action: tap check on the warmup.
   - Assert: overlay remains idle. Check succeeds (row shows green tint after mutation).

3. **Auto-start does NOT fire on dropset check.**
   - Setup: a working set with a chained dropset on A.
   - Action: tap check on the dropset.
   - Assert: overlay remains idle.

4. **Reset on subsequent working-set check.**
   - Setup: routine with `target_rest_seconds = 60` on A.
   - Action: tap check on working set #1 (timer starts at 60s); wait ~5s; tap check on working set #2 (also working).
   - Assert: overlay shows a fresh 60s countdown (not 55s). Confirms `start` overwrites.

5. **Uncheck does NOT touch the timer.**
   - Setup: timer running from step 1 with ~50s remaining.
   - Action: tap check (now uncheck) on the same set.
   - Assert: overlay still shows ~50s. Row's green tint is removed (DB UPDATE succeeded).

6. **Re-check after uncheck fires fresh timer.**
   - Setup: continue from step 5.
   - Action: tap check on the same set again.
   - Assert: overlay resets to ~60s.

7. **No target → silent no-op.**
   - Setup: ad-hoc session with no routine (or routine has no `target_rest_seconds` for A).
   - Action: tap check on a working set on A.
   - Assert: overlay remains idle. Check succeeds.

8. **Cross-exercise check with no target leaves prior timer running.**
   - Setup: routine with rest=120 on A and no rest entry for B; timer running from A (e.g., 100s remaining); ad-hoc working set on B.
   - Action: tap check on the working set on B.
   - Assert: overlay still shows A's countdown (decremented by the elapsed time). No reset.

9. **Cross-exercise check with new target replaces timer.**
   - Setup: routine with rest=120 on A and rest=60 on B; timer running from A.
   - Action: tap check on a working set on B.
   - Assert: overlay shows ~60s (B's target), not whatever was left of A's 120s.

10. **Bulk "Check all and finish" does NOT auto-start.**
    - Setup: multiple unchecked working sets across exercises; routine has rest targets.
    - Action: open Finish modal, tap "Check all and finish".
    - Assert: overlay never flips to running during the bulk update. Navigation proceeds to verdict screen.

### Manual / iOS smoke

- On iOS, repeat scenario 1 and confirm the overlay flips. Confirm AsyncStorage persists by hot-reloading the screen mid-rest.

## Open risks (for Validator)

1. **Optimistic vs. post-success trade-off** — flagged in Riscos. Validator should confirm the team is comfortable with the phantom-start edge case in exchange for instant feedback, or flag a switch to post-success.
2. **Dropset asymmetry with add-set** — Validator should confirm the working-only filter is the right call. The Conductor's lean is clear; just calling it out so it's not silently inconsistent later.
3. **Stale timer on cross-exercise check without target** — same UX consideration as above. Validator should confirm "leave it running" is preferred over "stop it".
4. **No new tests for `useRestTimer.start` overwrite semantics** — the feature relies on `start` resetting in-flight state. That behavior is unit-test-free today. Acceptable for v1 (e2e step 4 covers it), but Validator may want a follow-up.
5. **Handler complexity creep** — the inline `onToggleSetChecked` now has two responsibilities: orchestrate the toggle mutation, and trigger the timer. Still small (~12 lines). If a third concern lands later (logging, analytics), refactor into a named callback. Not now.
