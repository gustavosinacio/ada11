# Diagnosis — 2026-06-01_0941_session-finish-exercise-order

## Hypothesis (stated BEFORE searching)

Given the repro (History reorders exercises vs the order the user saw on the live screen), I suspect the cause is that **there is no stable, persisted, session-scoped EXERCISE ordering**. The live screen reconstructs an order at render time (routine `position` first, then set-first-occurrence, then a client-only manual override) while History derives its order purely from `listSetsForSession`, whose rows tie on `set_number = 1` across every exercise's first set with no secondary sort key — so History's order is whatever unspecified physical insertion order Postgres returns. The two derivations diverge because they consume different inputs, and the live screen's authoritative inputs (routine position + manual reorder) are never written anywhere History can read them.

**Verdict after reading the code: CONFIRMED as fact.** Every link in the chain is verified at file:line below. The mechanism the Reproducer established holds, and I extend it with three findings: (1) the divergence is structural, not just a fragile tie-break; (2) the live order's authoritative source is provably non-persisted; (3) within a routine's pre-seed, even the per-`set_number` band ordering across exercises is itself unspecified, so a `created_at`/`id` tie-break does NOT recover routine order.

## Evidence

### Source-of-truth files (verified by reading)

- **`src/api/sets.ts:43-56`** — `listSetsForSession` does `.order("set_number", { ascending: true })` and nothing else. **No secondary key.** Verified. The in-code comment (`:49-53`) correctly documents that a previous `completed_at`-first ordering was removed; the `completed_at` hypothesis is dead, as the Reproducer established.
- **`src/api/sets.ts:64-73`** — `logSet` computes `set_number` as `max(set_number)+1` scoped to `(session_id, exercise_id)`. Verified. ⇒ every exercise's FIRST set is `set_number = 1`. With N exercises, the sorted result has an N-way tie at `set_number = 1`, broken only by physical row order (insertion / ctid).
- **`src/db/schema.ts:142-188`** — the `sets` table has `set_number`, `completed_at`, `created_at` (via `...timestamps`), but **no session-scoped exercise `position`/sequence column**. Index `sets_session_idx` is on `session_id` only (`:168`) — no ordering guarantee. Verified. There is no DB-level home for a session exercise order today.
- **`app/(app)/history/[id].tsx:89-117`** — History detail builds `orderedExercises` by first-occurrence over `setsQ.data` ONLY (`:96-104`), then appends edit-mode-added exercises (`:106-114`). It does **not** import or call `useRoutineExercises` (verified: imports at `:22-41` contain no routine-exercises hook). ⇒ History exercise order == `listSetsForSession` row order == unspecified physical insertion order. **This is the surface the owner noticed.**
- **`app/(app)/workout/[sessionId].tsx:215-279`** — live `orderedExercises`: (1) routine exercises in `position` order (`:221-227`, via `useRoutineExercises` at `:117`), (2) then set-first-occurrence (`:230-238`), (3) then ad-hoc (`:241-249`), (4) then a client-only `exerciseOrderOverride` (`:257-269`). This IS "the order the user saw." Verified.
- **`app/(app)/workout/[sessionId].tsx:124-131, 281-290`** — `exerciseOrderOverride` is `useState`, set only by `moveExercise` (`:289`), explicitly documented "**Not persisted across reloads**" (`:128`). `adHocExerciseIds` and `removedExerciseIds` are the same — pure client state. Verified. **This is the load-bearing finding (see "Is the user's order persisted?" below).**
- **`src/api/routine-exercises.ts:50-61`** — `listRoutineExercises` orders by `position` ASC. This is the routine-position source the live screen consults and History does not. Verified.
- **`src/api/routine-exercise-sets.ts:233-243, 288-351`** — `seedSetsForSession` reads routine sets ordered by `set_number` ASC (`:242`), builds `nonDropsetRows` in that same loop order (`:288-330`), and bulk-inserts in that order (`:341-344`). ⇒ session sets are inserted **interleaved by `set_number` across exercises** (all set#1 rows, then all set#2…), NOT grouped by routine position. Verified. **Sharper sub-finding:** within a single `set_number` band the cross-exercise order is itself unspecified — `:242` orders ONLY by `set_number`, so the tie-break across exercises (which set#1 row comes first) rides the physical order of `routine_exercise_sets`. So even an untouched routine session's insertion order is not deterministically routine-position order; it is doubly unspecified.

### Candidate locations affected by the same root cause

| File:Line | Token / pattern | Context | Severity |
|---|---|---|---|
| `app/(app)/history/[id].tsx:91-117` | `orderedExercises` first-occurrence over `setsQ.data` | History detail derives exercise sequence from the tie-broken set query, no routine-position input | **blocker** |
| `src/api/sets.ts:43-56` | `.order("set_number", …)` no secondary key | The query whose unspecified tie-break is the proximate driver; any fix at the query layer or above must address this | **blocker** |
| `app/(app)/workout/[sessionId].tsx:124-131, 281-290` | `exerciseOrderOverride` / `moveExercise` client-only | The live order's authoritative reorder is never persisted; the divergence cannot be closed for manually-reordered (or ad-hoc) sessions without a persistence change | **major** |
| `src/api/routine-exercise-sets.ts:233-243, 288-351` | seed inserts interleaved by `set_number` | Why even an untouched routine session's insertion order ≠ routine position; rules out the cheap `created_at` tie-break as a full fix | **major** |
| `src/utils/volume-target.ts:183, 258` | comments claiming `listSetsForSession` "orders by completion timestamp" | **Stale documentation** — the order is now `set_number`. Not a bug (kernels are order-independent), but the Fix Designer must not trust these comments when reasoning about ordering | **minor** |

### Surfaces checked and found NOT affected (scope guard)

| Surface | File | Affected? | Why |
|---|---|---|---|
| Verdict screen (PR list) | `app/(app)/workout/verdict/[sessionId].tsx:97-122`; `src/utils/session-verdict-math.ts:141-143` | **No** | Renders only PR-beating exercises, sorted by `overflowKg DESC` then `exerciseId ASC` — a deterministic, intentional sort independent of `listSetsForSession` row order. Does not render the full session list. Confirms the Reproducer; the owner's "verdict" mention was almost certainly History. |
| History week drill-down | `app/(app)/history/week/[isoWeek].tsx:218-234` | **No** | Renders only `SessionSummaryRow` (name, date, total volume). Does not consume `useSetsForSession`, does not list per-session exercises. |
| History list (tab root) | `app/(app)/history/index.tsx:28-35` | **No** | Renders `SessionSummaryRow` + volume strip only. No per-session exercise sequence. |
| Read-only / edit exercise blocks | `components/read-only-exercise-block.tsx`, `components/exercise-block.tsx` | **No (consequence, not cause)** | They render whatever ordered list History/live passes them; SETS *within* a block are ordered by `set_number` per exercise (correct — monotonic per exercise, no tie). Only the cross-exercise sequence is wrong, and that's decided upstream in `orderedExercises`. |
| Volume kernels | `src/utils/volume-target.ts:192-264` | **No** | Sum/reduce over sets; pick "current weight" by `max(set_number)`. Order-independent. |
| e1RM + per-muscle / progress charts | `src/utils/e1rm-strength.ts:98`, `src/utils/progress-page-math.ts:228-237` | **No** | Group by `exercise_id` into Maps, then sort by their own keys. Order-independent. |

### Cross-environment confirmation

The bug is **backend-query-derived and environment-independent** — it manifests identically on web and native because the divergence is in the data the Supabase query returns, not in any rendering path. The Reproducer confirmed this at the data layer (repro.md Step A.4). There is no "manifests in X but not Y" environment split to explain.

The *surface* split (History reorders, live does not) is fully explained and is the heart of the diagnosis: the live screen and History consume **different inputs** to build the same conceptual list. Live = routine position + client override (authoritative, in-memory). History = `listSetsForSession` row order (tie-broken physical insertion order). They agree only by accident — when physical insertion order happens to match routine position, which the interleaved pre-seed (`routine-exercise-sets.ts:242`) generally guarantees it does NOT. This is a complete causal account, not a "happens to" observation.

## Root cause

**There is no persisted, session-scoped exercise ordering.** The exercise sequence is reconstructed independently on each screen: the live screen builds an authoritative order from routine `position` plus client-only ad-hoc/override state (`workout/[sessionId].tsx:215-279`), none of which is persisted; History rebuilds the order from `listSetsForSession` (`sets.ts:43-56`), which has no session-scoped ordering column to sort by and so ties N-way on `set_number = 1` and falls back to unspecified physical insertion order (`history/[id].tsx:91-117`). Because the routine pre-seed inserts sets interleaved by `set_number` across exercises (`routine-exercise-sets.ts:242, 341-344`), the physical insertion order is not the routine-position order, so History systematically diverges from the live screen. The instability the user perceives as "the order gets messed up" is the absence of a single source of truth, not a bug in any one sort call.

### Symptom-vs-cause statement
- **Symptom:** after Finish, History shows exercises in a different (and run-to-run unstable) order than the live workout.
- **Proximate mechanism:** `listSetsForSession`'s `set_number`-only sort produces an N-way tie that Postgres breaks by physical insertion order, and History maps that directly to exercise order.
- **Root cause:** no persisted session-scoped exercise order exists; two screens reconstruct order from divergent, partly-non-persisted inputs.

## Is the user's order persisted anywhere? (load-bearing for the fix shape)

**No — and this is the single most important constraint for the Fix Designer.** Decompose the live order's four inputs:

1. **Routine position** (`routine_exercises.position`) — persisted, but only exists for routine-sourced sessions (`sessions.routine_id != null`; verified `sessions.ts:39, 51`). Ad-hoc sessions (`routine_id = null`) have no routine and therefore no position source at all.
2. **Set first-occurrence order** — derivable from the set rows, but it rides the same unspecified physical order (it IS the tie-break).
3. **Ad-hoc additions** (`adHocExerciseIds`) — client-only state, never persisted (`workout/[sessionId].tsx:123`).
4. **Manual reorder** (`exerciseOrderOverride`) — client-only state, never persisted (`workout/[sessionId].tsx:124-131`, set only by `moveExercise` at `:289`).

So for three of the four contributors, **no persisted source of truth for the displayed exercise order exists once the live screen unmounts.** A pure query-ordering fix can at best recover a *deterministic* order; it cannot recover the *order the user actually saw* whenever the session was ad-hoc or manually reordered, because that information was never written to the database. This is what separates a "make it stable" fix from a "make it match what the user saw" fix.

## Fix-direction assessment (for the Fix Designer — NOT a fix design)

Coverage matrix for the three session shapes: **R** = routine-sourced untouched, **A** = ad-hoc, **M** = manually reordered (override used).

| Direction | What it does | R | A | M | Cost / risk |
|---|---|---|---|---|---|
| **(a)** Add deterministic secondary key (`created_at`/`id`) to `listSetsForSession` | Makes the tie STABLE | Stable but ≠ live order (insertion interleaved, `:242`) | Stable; matches live ONLY if user logged sets in display order | Does not capture override at all | Lowest cost, zero schema. **Stability ≠ correctness.** |
| **(b)** Make History order exercises by routine `position` (consult `useRoutineExercises`) | History mirrors live's step-1 | Matches live | **No routine ⇒ no signal**, falls back to today's tie | Ignores override | Medium; adds a query dep to History. Partial. |
| **(c)** Persist explicit per-session exercise order (column/junction or derivation written at Finish) | Single source of truth both screens read | Matches | Matches | Matches | Highest cost: schema + migration + write path at Finish (and on live reorder). Only direction covering all three. |

Framing for the Fix Designer (their call, with the human approval gate):

- **(a) alone is a symptom fix.** It converts "unstable" into "stably wrong" for R and M. Right call ONLY if the team accepts that History need not match the live order, just be deterministic. Cheap, low-risk, but does not satisfy the repro's "Expected" (History == live).
- **(b)** fixes the **primary real-world trigger** (routine sessions — the Reproducer's PRIMARY trigger) at moderate cost, but leaves ad-hoc and manual-reorder broken and silently regresses to the tie for those. Reasonable interim if routine sessions dominate; incomplete.
- **(c)** is the only direction that satisfies the repro for all three shapes. It is a **schema/data-integrity change** — in-scope per triage (the playbook permits a data-integrity fix touching schema, gated by Fix Designer + human approval), but the Conductor should weigh the migration. **A lighter variant of (c):** derive-and-persist the order **at Finish** (e.g. a `sets.session_exercise_order` int stamped per exercise, or a small `session_exercise_order` table) snapshotting exactly what the live screen showed. This captures override AND ad-hoc because the live screen's `orderedExercises` is computed in-memory at Finish time and can be persisted then — lower write-frequency than syncing override on every reorder.

**A persistence/schema change is likely required to fully fix this** (direction c or its at-Finish variant). A query-only fix (a or b) cannot recover an order that was never written for ad-hoc/reordered sessions. Stated plainly per the playbook — the decision belongs to the Fix Designer and the human.

## Severity classification

- **Blocker** — user-facing, the headline complaint.
  - `app/(app)/history/[id].tsx:91-117` — the surface that visibly reorders.
  - `src/api/sets.ts:43-56` — the unspecified tie-break feeding it.
- **Major** — must be addressed for a complete fix; determines whether the chosen direction works.
  - `app/(app)/workout/[sessionId].tsx:124-131, 281-290` — non-persistence of the authoritative order; without a persistence decision, ad-hoc + manual-reorder stay broken.
  - `src/api/routine-exercise-sets.ts:233-243, 288-351` — interleaved seed; rules out the cheapest fix as sufficient on its own.
- **Minor (out of scope by default)** — follow-up.
  - `src/utils/volume-target.ts:183, 258` — stale "completion timestamp" comments; correct while nearby, do not let them mislead the fix.

## Regression-risk surface (what a fix must not break)

- **`listSetsForSession` consumers** (verified — exactly three via `useSetsForSession`): `history/[id].tsx`, `workout/[sessionId].tsx`, `workout/verdict/[sessionId].tsx`. If direction (a) changes the `.order`, all three see the new row order:
  - Live screen: its `orderedExercises` puts routine position FIRST, so a set-order change only affects step-2 (exercises with sets but not in the routine) — low impact, but verify the live order doesn't shift.
  - **Sets WITHIN an exercise block** render from `setsByExercise` (`history/[id].tsx:119-127`, `workout/[sessionId].tsx:292-298`) which pushes in `setsQ.data` order. Sets are monotonic by `set_number` per exercise (no tie within an exercise), so a secondary key like `(set_number, created_at)` keeps within-exercise order correct. **A fix MUST preserve `set_number` as the primary sort** — do not reorder sets within an exercise (the comment at `sets.ts:49-53` documents the UX bug that caused: a checked set bubbling above unchecked ones). This is the one constraint a query-layer fix must respect.
  - Verdict: order-independent (deterministic own sort) — safe.
- **Volume kernels** (`volume-target.ts`), **e1RM** (`e1rm-strength.ts`), **per-muscle / progress** (`progress-page-math.ts`): all group by `exercise_id` and reduce/sort by their own keys. Order-independent — safe. Confirmed by reading.
- **`seedSetsForSession`** idempotency (`routine-exercise-sets.ts:261-275`) keys on `(exercise_id, set_number)` natural key. If a fix adds a new ordering column to sets, the seed's insert payload (`:301-313`) and natural-key re-keying (`:332-351`) must populate it — do not break the idempotency guard.
- **Finish flow** (`bulkCheckAllInSession` `sets.ts:290-298`; `bulkSoftDeleteUncheckedInSession` `:312-348`): discarding unchecked sets at Finish can remove an exercise entirely (all sets unchecked ⇒ exercise vanishes from the persisted list). If direction (c) writes order at Finish, it must derive from the SURVIVING (checked) sets, matching what History will actually render, and be sequenced AFTER the discard.
- **History edit mode** (`history/[id].tsx:326-368`): editing a finished session can `logSet` new sets and add exercises via `addedExerciseIds`. Any persisted-order fix must define behavior when History adds an exercise to a finished session.

## Symptom-only fix risk

Direction (a) — adding a secondary `.order` key to `listSetsForSession` — is a **legitimate symptom-level fix, NOT a root-cause fix.** It makes the tie-break *deterministic* (eliminating run-to-run instability) but does not make History match the *order the user saw* for routine-interleaved, ad-hoc, or manually-reordered sessions, because those orders were never persisted. The root cause (no single source of truth for session exercise order) survives. This is flagged explicitly so the Fix Designer and human choose (a) consciously if "deterministic, not necessarily matching" is the accepted product behavior — it is not an accidental half-fix. The repro's stated "Expected" (History == live order) is only met by direction (c)/its at-Finish variant.

## security_relevant: no

The root cause and every candidate location are read/ordering of the user's own session and set rows. No authentication, session-token handling, credential storage/transmission, or untrusted-input surface is touched. All affected queries are already RLS-scoped to the authed user (`logSet` reads `auth.user.id`, `sets.ts:59-61`; `listSetsForSession` filters by `session_id` under RLS). A persistence fix (direction c) would add a column/table that inherits the same `user_id` RLS posture as `sets` — the Fix Designer/Regression Tester should confirm any new table's RLS policy matches `sets`, but the bug itself exposes no access-control gap. Surfaces: none beyond standard RLS-scoped self-data.

## Confidence + remaining unknowns

- **Confidence: HIGH** that the root cause is "no persisted session-scoped exercise order; two screens reconstruct from divergent partly-non-persisted inputs." Every link verified at file:line; the Reproducer's data-level probe (repro.md Step A.4-A.5) empirically confirms the tie-break direction. **Risk of acting on this diagnosis: LOW** for directions (a)/(b) (reversible, local); **MEDIUM** for (c) (schema/migration, reversible but with data-shape effect).
- **Remaining unknowns (do not block diagnosis; inform the fix decision):**
  1. **Product intent:** should History match the *live order the user saw* (requires persistence, direction c) or merely be *deterministic* (direction a)? A product call, not a code fact — Fix Designer/human decide. The repro's "Expected" implies the former.
  2. **Usage mix:** how often are sessions ad-hoc or manually reordered vs untouched-routine? If ~all routine and reorder is rare, (b) covers the bulk cheaply; if ad-hoc/reorder is common, only (c) suffices. No telemetry read this run.
  3. Whether the team prefers the lighter "snapshot order at Finish" variant of (c) over a live-synced persisted order — both satisfy the repro; the at-Finish variant is lower write-frequency.
