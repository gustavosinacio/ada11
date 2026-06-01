# Reproduction — 2026-06-01_0941_session-finish-exercise-order

## Initial report
"When I finish my sessions, the order of the exercises gets messed up." (Owner added to docs/features.md "## Open" — "Let's investigate".)

Conductor framing: during a live workout the exercises appear in a specific order (routine-seeded or ad-hoc add order). After tapping Finish, when the session is viewed in History (`app/(app)/history/[id].tsx`) and/or the end-of-session verdict screen, exercises render in a DIFFERENT order than during the live workout. Leading hypothesis to confirm/refute: exercise display order is derived from set rows ordered by `completed_at`, so checking sets out of list order reshuffles exercises.

## Refinement (Reproducer-mode work)

The bug is real and I reproduced the reordering deterministically against the live Supabase project using the service-role admin seed pattern (data-level probe — see "Visual / data evidence"). Three refinements to the framing:

1. **The leading `completed_at` hypothesis is REFUTED.** `listSetsForSession` (`src/api/sets.ts:43-56`) no longer orders by `completed_at` — it was changed to `.order("set_number", { ascending: true })` (sets.ts:49-53, with an in-code comment describing the *previous* completed_at bug that was fixed). My discriminator probe (variant V1: insert physical order A,B,C but complete in order B,C,A) rendered history as **A,B,C** — i.e. completion order did NOT drive the display. So the Diagnostician should NOT chase a `completed_at` sort; that path is already gone.

2. **The actual mechanism is an unspecified `set_number` tie-break.** `listSetsForSession` orders by `set_number` ONLY, and `set_number` is monotonic **per `(session_id, exercise_id)`** (`logSet` scopes the max by both session AND exercise — sets.ts:64-73; schema has no session-global ordering column — `src/db/schema.ts:142-188`). So the first set of every exercise is `set_number = 1`: a multi-way tie. There is NO secondary sort key. Postgres breaks the tie by physical row order (insertion / ctid sequence). The History/verdict surfaces then derive exercise order by *first-occurrence* over this tie-broken list, so **exercise order == physical set-insertion order**, which is unspecified by SQL and not guaranteed stable.

3. **Which surfaces diverge — only History (and the live screen during edit). The verdict screen does NOT visibly reorder.** The verdict screen renders only the *PR list* (exercises that beat a prior best), sorted by `overflowKg DESC` (`session-verdict-math.ts:142-145`) — it never renders the full ordered exercise list, so it cannot exhibit a "full-list reorder". The full ordered list appears on the **live screen** (routine-position order — `workout/[sessionId].tsx:215-279`) and on **History detail** (set-row first-occurrence — `history/[id].tsx:91-117`). The divergence is between those two.

The root divergence: the **live screen has access to routine position order** (`useRoutineExercises` → `.order("position")`, sorted FIRST in its `orderedExercises`), but **History detail does not consult routine position at all** — it orders purely by the set query. When the physical set-insertion order differs from routine position order, the two screens disagree. And the pre-seed that creates the sets inserts them interleaved by `set_number` across exercises, NOT grouped by routine position (`routine-exercise-sets.ts:233-243, 340-351`) — so the insertion order is itself not the routine order.

## Environment that triggers the bug
- Device / browser / build: ada11 Expo Router app (web build, `npm run web` @ `localhost:8081`; same code path on native). Reproduced at the data layer against the project's live Supabase backend (`ykrbgpctbfvndxjnpzrg.supabase.co`).
- OS / version: macOS dev host (irrelevant — the reorder is backend-query-derived, device-independent).
- System theme: irrelevant (ordering bug, not a rendering/contrast bug).
- Auth state: signed-in confirmed user; the session + sets belong to that user (RLS-scoped).
- Network: online.
- Data state: a **multi-exercise** session (≥2 exercises) where the order in which sets were *physically inserted* differs from the order the live screen displays. The most reliable triggers:
  - **Routine-started session** (`source = routine`): the pre-seed inserts sets interleaved by `set_number` (all set#1 across exercises, then all set#2…), so a routine with ≥2 exercises each having ≥1 set already has an insertion order that does not match routine position. (PRIMARY real-world trigger.)
  - **Ad-hoc session** where the user logs the first set of exercise B before exercise A, or uses the manual reorder chevrons on the live screen (`exerciseOrderOverride`, workout/[sessionId].tsx:129-131 — client-only, NOT persisted), then finishes. History ignores both.

## Affected screens (confirmed)
- `app/(app)/history/[id].tsx:91-117` — History detail. Derives `orderedExercises` from `setsQ.data` first-occurrence ONLY. No routine-position input. **Exhibits the reorder.**
- `app/(app)/workout/[sessionId].tsx:215-279` — Live workout. Orders routine exercises by `position` FIRST, then set-first-occurrence, then ad-hoc, then an optional client-only `exerciseOrderOverride`. This is the "order the user saw". The divergence is measured against this.
- `app/(app)/workout/verdict/[sessionId].tsx` — verdict screen. **Does NOT exhibit a full-list reorder**: it renders only the PR list sorted by `overflowKg DESC` (`session-verdict-math.ts:142-145`), not the session's full exercise list. Scoped OUT as a reorder surface (but the Diagnostician should confirm the owner didn't mean the PR list when they said "verdict").

## Ordering-mechanism evidence (file:line)
- `src/api/sets.ts:43-56` — `listSetsForSession`: `.order("set_number", { ascending: true })`, **no secondary key**. Comment at :49-53 confirms the previous `completed_at`-first order was removed.
- `src/api/sets.ts:64-73` — `logSet` computes `set_number` as `max(set_number)+1` scoped to `(session_id, exercise_id)` → every exercise's first set is `set_number = 1` (multi-way tie).
- `src/db/schema.ts:142-188` — `sets` table: columns are `set_number`, `completed_at`, `created_at` (via `timestamps`). **No session-global `position`/sequence column.** Index `sets_session_idx` on `session_id` only — no ordering guarantee.
- `app/(app)/history/[id].tsx:91-117` — `orderedExercises` = first-occurrence over `setsQ.data`. No `useRoutineExercises`.
- `app/(app)/workout/[sessionId].tsx:215-279` — live `orderedExercises`: routine `position` order first (via `useRoutineExercises` → `routine-exercises.ts:50-61` `.order("position")`), then set-first-occurrence, then ad-hoc, then `exerciseOrderOverride`.
- `src/api/routine-exercise-sets.ts:233-243` and `:340-351` — `seedSetsForSession` reads routine sets ordered by `set_number` ASC and bulk-inserts in that order → session sets are inserted **interleaved by set_number across exercises**, not grouped by routine position. This is why even an untouched routine session's insertion order ≠ routine order.

## Steps to reproduce

### A. Deterministic data-level repro (the one I ran — fastest, no UI needed)
Harness pattern: `tests/e2e/read-only-history.spec.ts:38-155` (service-role admin seed). Standalone probes written to this run folder: `repro-probe.ts` (divergence) and `repro-probe2.ts` (tie-break discriminator). Both self-clean the throwaway user in a `finally`.

1. `set -a && . ./.env.local && set +a`
2. Seed: create a confirmed user; create a routine with 3 exercises at positions A=0, B=1, C=2; start a finished session (`routine_id` set); insert one `working` set per exercise, all `set_number = 1`, inserting them physically in order **B, C, A** (mimics the user logging B's set first).
3. Run the exact `listSetsForSession` query, then apply the History first-occurrence rule and the live (routine-position) rule.
4. **Observed** (verbatim probe output, run 2026-06-01):
   - `LIVE order    : Arnold Press (Dumbbell) -> Back Extension -> Bench Press`  (A,B,C — routine position)
   - `HISTORY order : Back Extension -> Bench Press -> Arnold Press (Dumbbell)`  (B,C,A — insertion order)
   - `DIVERGENCE (history reorders vs live)`
5. **Discriminator** (`repro-probe2.ts`, same run): insert A,B,C but complete B,C,A → History rendered **A,B,C** (NOT completion order). Insert C,A,B all completed at the same instant → History rendered **C,A,B**. ⇒ tie-break = physical insertion order, NOT `completed_at`.
6. **Expected**: History order should equal the live order the user saw (A,B,C). It does not.

### B. Manual UI repro (for human/visual confirmation)
1. Sign in. Create a routine "Repro" with exercises in order: **Squat, Bench Press, Deadlift** (use the routine builder; positions 0,1,2).
2. Start a workout from that routine (`workout/index.tsx` → `useStartSessionFromRoutine`). The live screen shows **Squat, Bench Press, Deadlift** (routine position order).
3. Log + check at least one working set for each exercise (any order). Tap **Finish** → confirm.
4. Go to the **History** tab → open the just-finished session (`history/[id]`).
5. **Observed**: exercises render in a different order than the live screen (driven by the interleaved-insertion tie-break, not routine position).
6. **Expected**: History shows **Squat, Bench Press, Deadlift** — the same order as the live workout.

Note: because the manual repro depends on the unspecified physical tie-break, the *exact* permutation is not guaranteed run-to-run; the *divergence* is. The data-level repro (A) is the deterministic one and is the recommended evidence base for the Diagnostician.

## Visual / data evidence
- Data evidence captured: yes — verbatim probe output quoted in Steps A.4–A.5 above, produced against the live Supabase project on 2026-06-01. Probe scripts saved at `docs/runs/2026-06-01_0941_session-finish-exercise-order/repro-probe.ts` and `repro-probe2.ts`.
- Screenshot: not captured. This is an ordering bug whose ground truth is the backend query result; the data-level probe is stronger and more deterministic evidence than a screenshot of one fragile permutation. A UI screenshot can be added during human verification (Step B) if the owner wants pixels, but it is not load-bearing for diagnosis.

## Status
- Repro determinístico: yes (data-level — Step A reproduces the divergence every run; the tie-break direction is confirmed). The *specific permutation* a real UI run shows is the one variable I could not fully pin, because it rides an unspecified SQL tie-break — but that fragility IS the bug, not a gap in the repro.
- Visual evidence obtained: not-applicable for diagnosis (data evidence captured instead); UI screenshot deferred to human verification.

## Open questions (for Diagnostician / user)
- Confirm the owner's "verdict screen" mention: the verdict screen only renders the PR list (sorted by overflow), not the full exercise list — so it does not exhibit a full-list reorder. If the owner saw a reorder "on the summary", it was almost certainly the History detail. Worth a one-line confirm but does not block diagnosis.
- The fix shape (Diagnostician/Fix Designer): History needs a stable, session-scoped exercise ordering that matches what the live screen showed. Options to weigh — (a) add a secondary `.order` key to `listSetsForSession` (e.g. `created_at`/`id`) to at least make the tie-break deterministic; (b) give History the same routine-position-first ordering the live screen uses (consult `useRoutineExercises`); (c) persist an explicit per-session exercise order/position column (covers ad-hoc + manual reorder, which neither (a) nor (b) preserve since `exerciseOrderOverride` is client-only and never written). NOT the Reproducer's call — flagged for the Diagnostician.
