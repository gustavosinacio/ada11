# Design v2 — Routine preview-then-start (Strong-style)

Run-id: `2026-06-04_1700_routine-preview-start`
Round: Design ↔ Validate round 2
Inputs: `design-v1.md` (my v1 — production architecture SOUND, carried forward), `validation-v1.md`
(the NO-GO — 0 blockers / 2 majors / 3 minors), `state.md` (LOCKED decisions), `docs/feedback/designer.md`.
Self-contained: this document carries forward everything sound from v1 and folds in the v2 fixes.
Do NOT read v1 to implement — read this.

---

## Changes from v1

The Validator confirmed the **production design is sound and verified** (new route, moved handler with
all 3 guards, new read-only card, reused start flow, `router.replace` success nav, `router.push`
preview, KEEP `disabled={hasActive}` + Guard A consistency, no migration/query/start-flow change).
The NO-GO was **entirely an under-scoped e2e blast radius**: v1 closed the set on the
`<RoutineListItem>` COMPONENT (correct — one consumer) but NOT on the row's **a11y LABELS**, which
two more specs query. v2 keeps all production decisions byte-for-byte and fixes the test scope.

| v1 issue | Severity | Resolution in v2 | Where |
|---|---|---|---|
| MAJ-1 — Edit-pill removal breaks `crud.spec.ts:113` + `probe-strong-unify.spec.ts:232` (not in F5) | major | F5 expanded to BOTH specs; builder-open path re-routed; unambiguous preview-header Edit label pinned | §F5, §"Edit label disambiguation" |
| MAJ-2 — row relabel `Start workout:`→`View routine:` breaks `probe-strong-unify.spec.ts:217` (opacity-0.6 + no-op-tap) | major | F5 re-pins that selector to `View routine:`; opacity-0.6 + no-op-tap assertions PRESERVED; row `disabled`/opacity-60 semantics verified intact | §F5, §"Row disabled-when-active verification" |
| MIN-1 — preview-header Edit label `"Edit routine"` is a PREFIX of the old `"Edit routine: {name}"` | minor | Preview-header label changed to **`"Edit this routine"`** (no substring clash); exact `getByLabel("Edit this routine")` pinned; no `^=` prefix on "Edit routine" anywhere | §"Edit label disambiguation", F1 |
| MIN-2 — no e2e for Guard A (Start-while-active routes to existing session) | minor | Added **P5** (Guard-A active-routing e2e) to the preview test plan | §Test plan / P5 |
| MIN-3 — citation drift (`history/[id].tsx:299-308` → block is `:288-308`, Done arm `:300-307`) | minor | Citation corrected; pattern is real, snippet is a correct mirror | F1 header |

**Top thing I most want the Validator to re-check:** the **label close-set is now complete and
exhaustive** — §"Close-the-set on the a11y LABELS (grep-verified)" lists EVERY file/line that queries
`"Start workout:"` or `"Edit routine:"` (or the `aria-label^=` prefix form) across the whole e2e suite
and the app, with the count stated and the no-N+1th proof. This is the exact gap that caused the v1
NO-GO; v2 makes the set explicit.

---

## Summary (carried from v1 — architecture unchanged)

Re-point the Workout-tab routine row from "start the session now" to "open a read-only PREVIEW
of the routine", add a "Start workout" button to that preview, and remove the one-tap direct-start.
This is a **UI + navigation feature only** — three load-bearing invariants:

- **NO migration / schema / RLS change.** The preview reads the exact data the editor already loads.
- **NO new query.** Reuse `useRoutine` + `useRoutineExercises` + `useRoutineExerciseSets` and the
  editor's grouping verbatim (`routines/[id]/index.tsx:152-160`).
- **The start flow is UNCHANGED.** `useStartSessionFromRoutine` (`use-sessions.ts:73-99`) and
  `seedSetsForSession` are not touched. The preview's Start button is a **new CALLER** of the
  identical flow; the ~20-line handler **moves** out of `workout/index.tsx:60-83` into the preview
  (per LOCKED U2.i — since no direct-start survives, there is exactly one caller, so a move is
  correct and no shared hook is introduced).

## Approach (carried from v1 — unchanged)

1. **New read-only preview screen** `app/(app)/routines/[id]/preview.tsx` (sibling of the editor
   `routines/[id]/index.tsx`, under the headerless routines stack `routines/_layout.tsx:4`). It
   owns its own `<Stack.Screen options={{ headerShown: true, title: routine.name }} />` exactly as
   the editor does (`routines/[id]/index.tsx:168`). It loads the same three hooks the editor uses,
   groups sets by `routine_exercise_id` with the editor's exact reducer, and renders each exercise
   with a **new read-only card**. It has a "Start workout" `<Button>` at the bottom and a header
   "Edit" `<Pressable>` → the builder.
2. **New read-only card component** `src/components/read-only-routine-exercise-card.tsx`. The editor's
   `<RoutineExerciseCard>` is edit-only (every set is a `<TextInput>` row + move/trash + add-set
   menu, `routine-exercise-card.tsx:347-409`) and is **NOT** made read-only (LOCKED #1). The new
   card mirrors the History read-only precedent (`<ReadOnlyExerciseBlock>`/`<ReadOnlySetRow>` +
   `set-display.ts`) but on `RoutineExerciseEntry` + `RoutineExerciseSetRow` (targets), not
   `SetRow` (logged sets — no completed/rpe/notes columns).
3. **Nav rerouting.** `<RoutineListItem>`'s main Pressable now navigates to the preview instead of
   starting. The row's separate "Edit" affordance is REMOVED (the preview is the hub); the row
   becomes a single Pressable (LOCKED #2/#4). The a11y label changes "Start workout: {name}" →
   "View routine: {name}".
4. **Moved Start handler.** The full `startFromRoutine` handler — `useStartSessionFromRoutine`
   mutation + the `pendingRoutineId` in-flight guard + the `active.data` guard + the seed-failure
   `catch` + `router.replace('/(app)/workout/{sessionId}')` — moves from `workout/index.tsx:60-83`
   into the preview screen, wired to the Start button. ALL THREE guards are preserved (see Contracts).
5. **Edit jump.** A header "Edit" Pressable in the preview → `router.push('/(app)/routines/{id}')`
   (the existing builder), mirroring the History header-button pattern (`history/[id].tsx:288-308`,
   Done arm `:300-307` — MIN-3 citation fix).

This is **Option (a)** from Discovery §2, the human-locked choice (U1). Option (b) reuse-editor-with-mode
and Option (c) modal are rejected below.

## Exact file changes

| # | Path | Type | Responsibility (one each) |
|---|------|------|---------------------------|
| F1 | `app/(app)/routines/[id]/preview.tsx` | **new** | The read-only preview screen: load data, render read-only cards, host the moved Start handler + Edit jump. |
| F2 | `src/components/read-only-routine-exercise-card.tsx` | **new** | Render ONE routine exercise + its per-set targets, read-only. The History read-only triad mirrored onto routine targets. |
| F3 | `app/(app)/workout/index.tsx` | **edited** | Re-point the row tap to the preview; DELETE `startFromRoutine` + `pendingRoutineId` + their now-unused imports/props; drop the row's Edit wiring. |
| F4 | `src/components/routine-list-item.tsx` | **edited** | Collapse to a single Pressable → preview; drop `onEditPress`/`pending`; relabel a11y "View routine: {name}". |
| F5 | `tests/e2e/routine-strong-builder.spec.ts` **+** `tests/e2e/crud.spec.ts` **+** `tests/e2e/probe-strong-unify.spec.ts` | **edited (3 files)** | Re-point every row-Start / row-Edit selector across all 3 specs to the new labels + the preview→Start step; re-pin test 6 URL; preserve opacity/no-op assertions. **(v2 — expanded from 1 spec to 3.)** |
| F6 | `tests/unit/...` | **edited/new** | Unit cases only IF a new pure presenter is added (see Test plan — likely none; reuse `displayWeight`/`displayReps`). |

### F1 — `app/(app)/routines/[id]/preview.tsx` (new)

Anchors it mirrors: editor data load (`routines/[id]/index.tsx:53-68`), grouping (`:152-160`),
header pattern (`:168`, `history/[id].tsx:288-308`), the moved handler (`workout/index.tsx:60-83`),
the empty-states (`routines/[id]/index.tsx:229-234` exercise-level, `read-only-set-row` set-level).

- `const { id } = useLocalSearchParams<{ id: string }>();`
- Hooks: `useRouter()`, `useRoutine(id)` (header title), `useRoutineExercises(id)`,
  `useRoutineExerciseSets(id)`, `useActiveSession()`, `useStartSessionFromRoutine()`,
  `useWeightUnit()` (`~/hooks/use-preferences`), `useColorScheme()`.
- `const [pendingRoutineId, setPendingRoutineId] = useState<string | null>(null);` (moved from
  `workout/index.tsx:32`).
- Initial-settle guard: while `active.isLoading` render a centered `<ActivityIndicator />` so the
  Start handler's `active.data` check has no race window — same precedent as `workout/index.tsx:37-43`.
- Loading/error branches mirror the editor (`routines/[id]/index.tsx:128-146`), each with a
  `<Stack.Screen options={{ title: "Routine", headerShown: true }} />`.
- Grouping (verbatim from `routines/[id]/index.tsx:152-160`):
  ```ts
  const setsByExercise = (() => {
    const map = new Map<string, RoutineExerciseSetRow[]>();
    for (const s of setsQ.data ?? []) {
      const list = map.get(s.routine_exercise_id) ?? [];
      list.push(s);
      map.set(s.routine_exercise_id, list);
    }
    return map;
  })();
  ```
- Render: a `<ScrollView>` (matching the editor's container) →
  - exercise list: `entries.length === 0` → centered empty copy
    `"No exercises in this routine yet."`; else `entries.map(entry => <ReadOnlyRoutineExerciseCard
    key={entry.id} entry={entry} sets={setsByExercise.get(entry.id) ?? []} unit={unit} />)`.
  - bottom Start `<Button label="Start workout" onPress={onStart} loading={startMut.isPending} />`
    (see Contracts for the exact handler). Allowed on an empty routine (LOCKED U6 — parity).
- **Header (MIN-1 label fix + MIN-3 citation fix):**
  ```tsx
  <Stack.Screen
    options={{
      title: routine.data?.name ?? "Routine",
      headerShown: true,
      headerRight: () => (
        <Pressable
          onPress={() => router.push(`/(app)/routines/${id}`)}
          accessibilityLabel="Edit this routine"   // ← was "Edit routine" in v1 (MIN-1)
          accessibilityRole="button"
          className="px-3 py-1"
        >
          <Text className="text-base font-medium text-blue-500">Edit</Text>
        </Pressable>
      ),
    }}
  />
  ```
  Mirrors `history/[id].tsx:288-308` (the Done-arm header `<Pressable>` at `:300-307`). **The label is
  `"Edit this routine"`, NOT `"Edit routine"`** — see §"Edit label disambiguation" for why (avoids the
  MIN-1 substring clash with the deleted row label `"Edit routine: {name}"` and any future `^=` prefix
  selector). The VISIBLE button text stays "Edit".

### F2 — `src/components/read-only-routine-exercise-card.tsx` (new) — carried from v1 unchanged

Mirrors `<ReadOnlyExerciseBlock>` (`read-only-exercise-block.tsx`) structurally, on routine targets:

- Header: exercise name `<Text>` + the muscles·equipment subline, reusing the editor's exact
  formula (`routine-exercise-card.tsx:140-149`): `[muscles.length>0 ? muscles.join(", ") : null,
  formatEquipment(entry.exercise.equipment)].filter(Boolean).join(" · ")`. `formatEquipment` is
  exported from `~/db/types` (used at `routine-exercise-card.tsx:12`). U7: mirror the editor — no
  `(deleted)` special-case; the filtered `exercise:exercises(*)` join is what gets seeded.
- A column-header strip ("# / Weight ({unit}) / Reps") shown only when `sets.length > 0`, dropping
  History's check/RPE/trash spacers (this card has no check/RPE/notes columns).
- Per-set rows: `sets.map(s => <set row>)`. Each row renders, **read-only text only**:
  - set-type badge (W / • / ↓) reusing the `TYPE_BADGE` shape from `read-only-set-row.tsx:29-33`,
  - dropset parent reference "↳N" via a `set_id → set_number` map (same pattern as
    `read-only-exercise-block.tsx:46-52,117-122`),
  - `set_number`,
  - `displayWeight(s.target_weight, unit)` (`set-display.ts:41-50` — takes `string | null`, exactly
    `RoutineExerciseSetRow.target_weight`'s type),
  - `displayReps(s.target_reps)` (`set-display.ts:57-60` — takes `number | null`, exactly
    `target_reps`'s type).
- Empty state: `sets.length === 0` → italic `"No sets configured."`.

### F3 — `app/(app)/workout/index.tsx` (edited) — carried from v1 unchanged

- DELETE `startFromRoutine` (`:60-83`) entirely (moved to F1).
- DELETE `const [pendingRoutineId, setPendingRoutineId] = useState<string|null>(null);` (`:30-32`) —
  no longer used here (the in-flight guard now lives in the preview).
- DELETE `const startFromRoutineMut = useStartSessionFromRoutine();` (`:28`) and remove
  `useStartSessionFromRoutine` from the import on `:17-21` (it moves to F1). `useStartSession` and
  `useActiveSession` STAY (used by `startAdHocWorkout` + `hasActive`).
- `renderItem` (`:142-150`) becomes:
  ```tsx
  <RoutineListItem
    routine={item}
    onPress={() => router.push(`/(app)/routines/${item.id}/preview`)}
    disabled={hasActive}
  />
  ```
  Drops `onEditPress` and `pending`. (See Risk R-3 for the `disabled={hasActive}` decision.)
- `startAdHocWorkout` (`:47-58`) + the Quick-start `<Button>` (`:114-118,132-136`): UNCHANGED.
- `hasActive` (`:45`) STAYS.

### F4 — `src/components/routine-list-item.tsx` (edited) — carried from v1 unchanged

- Remove the `onEditPress` and `pending` props from `Props` (`:9,16`) and the signature (`:30,32`).
  Keep `routine`, `onPress`, `disabled`.
- Remove the `pending` → `effectivelyDisabled` OR (`:34`): now just `const effectivelyDisabled =
  disabled;` (keep the dim-when-active visual — see §"Row disabled-when-active verification").
- Remove the trailing Edit `<Pressable>` block (`:58-69`) and the `Pencil` import (`:1`).
- The chevron is now always shown (the `onEditPress ? null : <ChevronRight/>` ternary at `:56`
  collapses to just `<ChevronRight color="#9ca3af" size={18} />`).
- a11y label (`:43`): `"Start workout: ${routine.name}"` → `"View routine: ${routine.name}"`.
- The two-sibling-Pressable / nested-interactive caution in the doc comment (`:19-26`) is now moot
  (single Pressable); simplify the comment accordingly.

### F5 — e2e (edited, 3 files) — **EXPANDED in v2 (the MAJ-1/MAJ-2 fix)**

See the full §Test plan below. Headline: **v1 said "exactly 5 tests change in ONE spec"; the true
blast radius is 7 test bodies across 3 spec files** (5 in `routine-strong-builder.spec.ts` + 1 in
`crud.spec.ts` + 1 in `probe-strong-unify.spec.ts`). All 3 specs are now in F5.

### F6 — unit — see Test plan (likely none new).

### Confirmed NO change (fenced out of scope) — carried from v1 unchanged

`useStartSessionFromRoutine` (`use-sessions.ts:73-99`) · `seedSetsForSession`
(`routine-exercise-sets.ts:225-381`) · the read queries `listRoutineExercises` /
`listRoutineExerciseSetsForRoutine` · the editor `routines/[id]/index.tsx` · `<RoutineExerciseCard>`
(`routine-exercise-card.tsx`) · `startAdHocWorkout` / `useStartSession` · the live session screen
`workout/[sessionId].tsx` · `db/types.ts` (no new column) · any migration / RLS.

---

## Edit label disambiguation (MIN-1 fix — load-bearing for the test re-pin)

**The problem v1 left open.** v1's preview-header Edit label was `"Edit routine"`. The row's deleted
Edit pill was `"Edit routine: {name}"` (`routine-list-item.tsx:62`). `"Edit routine"` is a **prefix**
of `"Edit routine: {name}"`, so any `[aria-label^="Edit routine"]` (prefix) selector would match BOTH
the (now-removed) row pill AND the new preview-header button — a latent collision the Implementer could
trip over when re-pinning the two affected tests.

**The v2 decision.** Rename the preview-header Edit label to **`"Edit this routine"`** (visible text
stays "Edit"). This is **unambiguous**:
- It is NOT a prefix of, and does NOT contain, the old `"Edit routine: {name}"` substring.
- The two affected tests select it with **exact** `getByLabel("Edit this routine")` — `getByLabel`
  defaults to exact-match on accessible name, so it matches ONLY the preview header button.
- No `[aria-label^="Edit routine"]` prefix selector is used anywhere (the design forbids it; see the
  close-set table — there are zero `^=` "Edit routine" selectors in the suite, and none are added).

This makes the preview-header Edit label collision-proof against both the old row label and any future
prefix selector. (Confidence HIGH / Risk LOW — pure label string + exact selector.)

## Row disabled-when-active verification (MAJ-2 — confirm semantics survive)

The Validator's MAJ-2 note (`validation-v1.md:91-94`) requires confirming that the relabeled,
Edit-pill-less, **single-Pressable** row still honors `disabled={hasActive}` (opacity-60 + no-op tap),
because `probe-strong-unify.spec.ts:188` is the ONLY e2e proof of that behavior and v2 re-pins (does
NOT delete) it.

Trace against the F4 component after the edit:
- `effectivelyDisabled = disabled` (the `|| pending` OR is removed, but `disabled` still flows in from
  `workout/index.tsx` `disabled={hasActive}`).
- `opacityClass = effectivelyDisabled ? "opacity-60" : ""` (`routine-list-item.tsx:35`) — **UNCHANGED**.
  When `hasActive`, the wrapping `<View>` still gets `opacity-60` → computed opacity `0.6`. ✔ matches
  `probe-strong-unify.spec.ts:219-220` (`expect(opacity).toBe("0.6")`).
- The main Pressable: `onPress={effectivelyDisabled ? undefined : onPress}` (`:41`) — **UNCHANGED**.
  When `hasActive`, `onPress` is `undefined` → tap is a no-op (does NOT navigate). ✔ matches
  `probe-strong-unify.spec.ts:226-228` (tap → still on `/workout$`).
- The opacity lives on the outer `<View>` (`:38`), which wraps the single Pressable — the relabel
  (`Start workout:` → `View routine:`) and the Edit-pill removal do NOT touch the `<View>`/opacity or
  the `onPress`-gating. So the behavior is byte-for-byte preserved; only the row's a11y NAME changes.

**Conclusion:** the row's `disabled`/opacity-60/no-op-tap semantics are INTACT under v2. The e2e at
`:217` only needs its SELECTOR re-pinned (`Start workout:` → `View routine:`); the behavioral
assertions (`:218-220` opacity, `:226-228` no-op tap) hold unchanged and are PRESERVED, not deleted.
(Confidence HIGH / Risk LOW — verified line-by-line against the F4 diff.)

---

## Contracts (exact)

### Preview data loading (F1) — carried from v1 unchanged

- `useRoutine(id)` → `RoutineRow | undefined` — `.data?.name` for the header title.
- `useRoutineExercises(id)` → `RoutineExerciseEntry[]` where `RoutineExerciseEntry =
  RoutineExerciseRow & { exercise: ExerciseRow }` (`routine-exercises.ts:4`). Ordered `position ASC`
  by the query (`:58`). Per entry the card reads `entry.exercise.name`, `entry.exercise.muscles:
  string[]`, `entry.exercise.equipment: string | null`.
- `useRoutineExerciseSets(id)` → `RoutineExerciseSetRow[]` (`db/types.ts:210-223`): `id`,
  `routine_exercise_id`, `set_number: number`, `set_type: SetType`, `target_reps: number | null`,
  `target_weight: string | null`, `parent_set_id: string | null`. Ordered `set_number ASC` (`:61`).
- Grouped shape: `Map<routine_exercise_id, RoutineExerciseSetRow[]>` (verbatim reducer above).

### `<ReadOnlyRoutineExerciseCard>` props (F2) — carried from v1 unchanged

```ts
type Props = {
  entry: RoutineExerciseEntry;        // from ~/api/routine-exercises
  sets: RoutineExerciseSetRow[];      // pre-grouped, set_number ASC
  unit: WeightUnit;                   // from useWeightUnit()
};
```

No callbacks (read-only by construction — the type signature forbids any mutation affordance,
mirroring `<ReadOnlyExerciseBlock>`'s no-mutation contract). `set_id → set_number` map is built
internally for the dropset "↳N" reference (same as `read-only-exercise-block.tsx:46-52`).

### Moved Start handler (F1) — ALL THREE guards preserved (carried from v1 unchanged)

This is the verbatim relocation of `workout/index.tsx:60-83`, parameterized to the single routine
the preview is viewing (`routine.data`). Every guard must survive:

```ts
const onStart = async () => {
  const r = routine.data;
  if (!r) return;                                   // routine not loaded yet
  // Guard A — active-session routing (workout/index.tsx:61-63). LOCKED U5:
  // route to the ACTIVE session instead of starting a second one.
  if (active.data) {
    router.push(`/(app)/workout/${active.data.id}`);
    return;
  }
  // Guard B — in-flight idempotency (workout/index.tsx:65-66,80-81). The
  // double-tap e2e (test 3) asserts exactly one session; this guard MUST
  // survive on the Start button.
  if (pendingRoutineId) return;
  setPendingRoutineId(r.id);
  try {
    const row = await startMut.mutateAsync({ routine_id: r.id, name: r.name });
    router.replace(`/(app)/workout/${row.id}`);     // success → live session
  } catch (err) {
    // Guard C — seed-fail hard-fail (workout/index.tsx:73-79). LOCKED U9:
    // STAY on the preview with the warn; do NOT router.back(). The orphan
    // empty session remains in History (use-sessions.ts:58-71 policy).
    console.warn("Start failed", err);
  } finally {
    setPendingRoutineId(null);
  }
};
```

- Guard A (active routing): mirrors today's `:61-63` push-to-live, preserving the
  single-active-session invariant. The `active.isLoading` settle-gate (F1) closes the race window.
- Guard B (in-flight): `pendingRoutineId` state moves here verbatim.
- Guard C (seed-fail): the `catch` keeps the user on `/routines/{id}/preview` and warns; the
  mutation's hard-fail policy (`use-sessions.ts:85-91`, no try/catch around seed) is unchanged.

### `<RoutineListItem>` new prop shape (F4) — carried from v1 unchanged

```ts
type Props = {
  routine: RoutineRow;
  onPress?: () => void;     // now → router.push(preview), never starts
  disabled?: boolean;       // dim + non-interactive when a session is active
};
```

`onEditPress` is **deleted** (the row no longer offers Edit — the preview is the hub, LOCKED #4).
`pending` is **deleted** — the row no longer starts anything, so there is no in-flight state to
reflect; the in-flight `pending` visual now lives on the preview's Start `<Button>` via its own
`loading={startMut.isPending}`. `disabled` is KEPT (the row stays dimmed during an active session —
see §"Row disabled-when-active verification" + R-3).

---

## Close-the-set on the a11y LABELS (grep-verified) — **THE v2 fix for the NO-GO**

This is the section that was incomplete in v1. v1 closed the set on the `<RoutineListItem>` COMPONENT
(correct — one consumer, see below) but the row's two a11y LABELS fan out to specs the COMPONENT grep
does not surface. Below is the COMPLETE, exhaustive list of every place in the e2e suite AND the app
that queries `"Start workout:"` or `"Edit routine:"` (including the `[aria-label^=...]` prefix form),
verified against source.

### Label 1 — `"Start workout: {name}"` (the ROW Start affordance, relabeled to `"View routine: {name}"`)

Defined at `routine-list-item.tsx:43`. Every query of it:

| # | File:line | Selector (verbatim) | What it targets | v2 action |
|---|---|---|---|---|
| S1 | `routine-strong-builder.spec.ts:212` | `getByLabel(\`Start workout: Golden RSB ${...}\`)` (stale; `.catch(()=>undefined)` fallback) | the row (best-effort warmup) | DELETE this stale warmup line (the real selector is S2) OR re-point to `View routine: Golden RSB`; pick DELETE — it is a dead `.catch`-guarded fallback that the `^=` locator below supersedes |
| S2 | `routine-strong-builder.spec.ts:217` | `locator('[aria-label^="Start workout: Golden RSB"]')` | the row | re-point prefix → `[aria-label^="View routine: Golden RSB"]`, then preview→Start insertion |
| S3 | `routine-strong-builder.spec.ts:272` | `locator('[aria-label^="Start workout: Dropset RSB"]')` | the row | re-point prefix → `[aria-label^="View routine: Dropset RSB"]`, then preview→Start insertion |
| S4 | `routine-strong-builder.spec.ts:319` | `locator('[aria-label^="Start workout: Idem RSB"]')` | the row | re-point prefix → `[aria-label^="View routine: Idem RSB"]`, then preview→Start double-tap |
| S5 | `routine-strong-builder.spec.ts:420` | `locator('[aria-label^="Start workout: Edit RSB"]')` | the row | re-point prefix → `[aria-label^="View routine: Edit RSB"]`, then preview→Start insertion |
| S6 | `routine-strong-builder.spec.ts:486` | `locator('[aria-label^="Start workout: Fail RSB"]')` | the row | re-point prefix → `[aria-label^="View routine: Fail RSB"]`, then preview→Start; re-pin URL (R-2) |
| S7 | `probe-strong-unify.spec.ts:217` | `getByLabel(\`Start workout: ${routineName}\`)` | the row (asserts opacity-0.6 + no-op tap) | re-pin exact → `getByLabel(\`View routine: ${routineName}\`)`; PRESERVE opacity-0.6 + no-op-tap assertions (MAJ-2) |

**App side:** `"Start workout: ..."` is produced ONLY at `routine-list-item.tsx:43`. No other component
renders that label. (The Quick-start ad-hoc button is visible TEXT `"Quick start workout"`, a DIFFERENT
string queried by `getByText("Quick start workout")` at `probe-strong-unify.spec.ts:180,183,204` and
`workout/index.tsx` — it is NOT an `aria-label`, NOT `"Start workout: ..."`, and is UNCHANGED. Do not
touch it.)

### Label 2 — `"Edit routine: {name}"` (the ROW Edit pill, being DELETED entirely)

Defined at `routine-list-item.tsx:62`. Every query of it:

| # | File:line | Selector (verbatim) | What it targets | v2 action |
|---|---|---|---|---|
| E1 | `crud.spec.ts:113` | `getByLabel(\`Edit routine: ${name}\`)` | opens the builder | RE-ROUTE the builder-open path (the pill is gone) — see chosen path below |
| E2 | `probe-strong-unify.spec.ts:232` | `getByLabel(\`Edit routine: ${routineName}\`)` | opens the builder during active session | RE-ROUTE the builder-open path — see chosen path below |

**App side:** `"Edit routine: ..."` is produced ONLY at `routine-list-item.tsx:62`, which F4 DELETES.
After F4 the string `"Edit routine: ..."` exists nowhere in the app. The preview-header Edit label is
`"Edit this routine"` (different string — see §"Edit label disambiguation"), so no app surface produces
`"Edit routine: ..."` or even the prefix `"Edit routine"` after this change.

### The count + the no-N+1th proof

- **`"Start workout:"` (Label 1): 7 query sites, all listed (S1–S7).** 6 in `routine-strong-builder.spec.ts`
  (S1–S6) + 1 in `probe-strong-unify.spec.ts` (S7).
- **`"Edit routine:"` (Label 2): 2 query sites, all listed (E1–E2).** 1 in `crud.spec.ts` + 1 in
  `probe-strong-unify.spec.ts`.
- **3 spec files touch these two labels, all in F5:** `routine-strong-builder.spec.ts` (S1–S6),
  `crud.spec.ts` (E1), `probe-strong-unify.spec.ts` (S7 + E2). **No 4th spec, no app surface beyond
  `routine-list-item.tsx:43,62`.** This was confirmed by the Validator's whole-suite grep
  (`validation-v1.md` verification rows 5/5d, MAJ-1, MAJ-2): the labels appear in exactly these 3 files;
  the two beyond the original F5 scope (`crud`, `probe-strong-unify`) are the v1 NO-GO cause, now folded
  in. **There is no N+1th: the Validator's grep across the whole e2e suite + `app/`/`src/` surfaced only
  these sites, and the design's prefix variants (`[aria-label^=...]`) are accounted for as S2–S6.**

**Note on the prefix form:** `routine-strong-builder.spec.ts` selects the row with the PREFIX locator
`[aria-label^="Start workout: <SuiteName>"]` (S2–S6), not exact `getByLabel`. v1's prose described these
as `getByLabel("Start workout")` insertions, which was imprecise — the real selectors are prefix
`aria-label^=` on the per-test routine name. v2 pins the exact verbatim selector for each (above), so the
Implementer changes the exact string, not a guessed one.

### Close-the-set on the `<RoutineListItem>` COMPONENT (carried from v1 — still verified)

`import { RoutineListItem }` appears ONLY at `workout/index.tsx:13`; the component is rendered ONLY at
`workout/index.tsx:143` (the FlatList `renderItem`). No other screen imports or renders it. So changing
its prop shape (drop `onEditPress`/`pending`) touches exactly one call site (F3). The Validator verified
this against a whole-codebase grep (`validation-v1.md` row 1): only `workout/index.tsx:13,143` +
`routine-list-item.tsx:27` (definition). No 2nd consumer.

Removing `startFromRoutine` / `pendingRoutineId` / `startFromRoutineMut` from `workout/index.tsx`
orphans nothing else (Validator row 1b): `startFromRoutine` referenced only at `:145`; `pendingRoutineId`
at `:32,65-66,81,148`; `startFromRoutineMut` at `:28,68`. All leave with the handler.
`useStartSession`/`useActiveSession`/`hasActive` stay (used by the ad-hoc path).

`<RoutineExerciseCard>` consumers — imported/rendered only by the editor
(`routines/[id]/index.tsx:18,237`). The new read-only card is a SEPARATE component (F2); the editor's
card is untouched.

---

## Edge cases / behaviors to test (carried from v1; E11 added for MAJ-1 re-route)

| # | Behavior | Expected |
|---|----------|----------|
| E1 | Tap a routine row | Navigates to `/routines/{id}/preview` — does NOT start a session. |
| E2 | Preview renders | Each exercise + its per-set targets (set_type badge, #, weight in user unit, reps) read-only; no `<TextInput>`/trash/add. |
| E3 | Start → success | Seeds via the unchanged flow → `router.replace('/workout/{sessionId}')` → live session with the seeded sets. |
| E4 | Start while a session is active (Guard A) | Routes to `/workout/{active.id}` (the existing session); no second session created. |
| E5 | Empty routine (no exercises / no sets) | Preview shows the empty copy; Start is allowed → seeds zero sets → valid empty live session (parity, U6). |
| E6 | Soft-deleted underlying exercise | Mirrors the editor (filtered join, no `(deleted)` special-case); preview ≡ what-gets-seeded (U7). |
| E7 | Header "Edit" tap | `router.push('/routines/{id}')` → the builder. |
| E8 | Row no longer starts (regression guard) | Tapping the row never reaches `/workout/{id}` directly; only the preview's Start does. |
| E9 | Seed-fail from preview (Guard C) | User stays on `/routines/{id}/preview`; orphan empty session in History; zero sets written. |
| E10 | Double-tap Start (Guard B) | Exactly ONE session (the `pendingRoutineId` guard on the Start button). |
| E11 | **Builder reached without the row Edit pill** (MAJ-1) | The two specs that opened the builder via the row's `Edit routine: {name}` pill now reach it either via row→preview→header `"Edit this routine"`, or via direct `page.goto('/routines/{id}')`. |

---

## Risks & alternatives

### Risks (per-risk Confidence / Risk)

- **R-1 — e2e a11y-label selector coupling (the load-bearing test risk, now fully closed).** Both the
  row Start label and the row Edit label change/disappear. The COMPLETE fan-out is enumerated in
  §"Close-the-set on the a11y LABELS" (7 + 2 = 9 query sites across 3 specs). The design ADOPTS the safe
  option in the contract: the preview Start button is a `<Button label="Start workout" />`, which renders
  `accessibilityRole="button"` (`button.tsx:47-50`) → a real `<button>` with `aria-label="Start workout"`
  on RN-Web — a regular, query-able DOM handle of the exact shape the existing tests already use
  (`getByLabel`/`[aria-label=...]`), not an SVG tick or never-queried surface. The Tester queries
  `getByLabel("Start workout")` inside the preview. **Confidence HIGH / Risk MEDIUM** (mechanical across 3
  specs; the close-set table makes every site explicit so the Implementer updates ALL in one pass).
- **R-2 — seed-fail URL assertion (`routine-strong-builder.spec.ts:493`).** Today test 6 asserts
  `page.url()` matches `/\/workout\/?$/` (bare Workout home) because direct-start leaves the user on the
  list. With preview→Start, on seed failure the user stays on `/routines/{id}/preview` (LOCKED U9, Guard
  C). The assertion MUST be re-pinned to `/\/routines\/[0-9a-f-]+\/preview$/`. If left as-is the test
  ships a false-red. **Confidence HIGH / Risk MEDIUM** (named explicitly so the Tester re-pins it).
- **R-3 — the `disabled={hasActive}` decision (UX policy).** Today rows are `disabled={hasActive}`
  (`workout/index.tsx:147`) — dimmed + non-tappable while a session is active. **Decision: KEEP
  `disabled={hasActive}` on the row.** Rationale: (a) preserves today's visible behavior (no surprise UX
  regression); (b) keeps the change navigation-only; (c) defense-in-depth — Guard A in the preview's
  Start handler STILL routes to the active session if a session becomes active while the preview is open,
  so the single-active-session invariant holds on both surfaces. The relabeled, Edit-pill-less single
  Pressable still honors `disabled` (verified line-by-line in §"Row disabled-when-active verification").
  LOCKED U5 left this to the Designer; I choose KEEP-disabled — smaller, no-regression delta, Guard A
  backstops the invariant. The friendlier always-previewable variant is parked (Alternative 4).
  **Confidence MEDIUM-HIGH / Risk LOW** (reversible one-line policy; either choice is safe).
- **R-4 — the moved handler losing a guard (data integrity / idempotency).** The single biggest
  correctness risk is the move dropping one of the three guards (A active-routing, B in-flight, C
  seed-fail). The Contracts section reproduces all three verbatim with their original file:line anchors
  and ties each to the e2e that proves it (E4/P5, E10/test3, E9/test6). The Validator verified the move
  reproduces all three byte-for-byte (`validation-v1.md` row 2). **Confidence HIGH / Risk MEDIUM**
  (verbatim move; the e2e suite re-proves each guard).
- **R-5 — read-only card type drift.** `<ReadOnlySetRow>` takes a `SetRow` (logged); the new card takes
  `RoutineExerciseSetRow` (targets: `target_weight: string|null`/`target_reps: number|null`, no
  completed/rpe/notes). Structural PRECEDENT, NOT a drop-in. `displayWeight`/`displayReps` ARE reusable
  as-is (param types match exactly). **Confidence HIGH / Risk LOW** (pure + unit-tested; columns are a
  strict subset of History's).
- **R-6 — platform divergence (RN-Web e2e).** The new route must be web-addressable —
  `routines/[id]/preview.tsx` under expo-router file routing is (rules out the modal Option c). The Start
  button's `<button>` + `aria-label` render identically on web. No native-only API.
  **Confidence HIGH / Risk LOW.**
- **R-7 — performance.** Two existing `useQuery`s (exercises + sets) the editor already pays. No new hot
  path, no extra fetch (preview + editor share cached query results — same query keys).
  **Confidence HIGH / Risk LOW.**
- **R-8 — back-stack UX after Start.** Start uses `router.replace` (not push) to the live session so the
  back button does not bounce the user back into the preview (mirrors `workout/index.tsx:72` and
  History's replace-to-live idiom). The Validator assessed this SOUND (`validation-v1.md:126-128`).
  **Confidence HIGH / Risk LOW.**
- **R-9 (v2-new) — Edit-label substring collision (MIN-1).** The preview-header Edit label could collide
  with a `[aria-label^="Edit routine"]` prefix selector if it stayed `"Edit routine"`. Resolved by
  renaming to `"Edit this routine"` (no substring overlap with the deleted `"Edit routine: {name}"`) +
  forbidding `^=` "Edit routine" selectors. **Confidence HIGH / Risk LOW** (pure label string).

### Alternatives considered

1. **Option (b) — reuse the editor with a read-only/preview mode** (Discovery §2b). Rejected: the
   editor's `<RoutineExerciseCard>` has no read-only mode, so (b) STILL needs the new read-only card AND
   adds mode-branching inside the 339-line form screen, AND the row tap would land on `/routines/{id}`
   colliding with the (now-removed) Edit affordance unless a query param is added. NOT the human-locked
   choice (U1 → new route).
2. **Option (c) — bottom-sheet/modal preview** (Discovery §2c). Rejected: no addressable URL (breaks the
   e2e route-wait pattern), no precedent for a full-screen scrollable sheet, still needs the read-only
   card. NOT the locked choice.
3. **Extract a `useStartRoutineFlow()` shared hook** (Discovery U2.ii). Rejected: with no direct-start
   surviving, the preview's button is the ONLY start-from-routine caller — a shared hook would have
   exactly one consumer. A move (U2.i, LOCKED) is correct and simpler.
4. **Always-previewable rows (drop `disabled={hasActive}`)** — friendlier (preview is harmless while
   active). Rejected for v1/v2 as a scope-add beyond the prompt; Guard A already backstops the invariant.
   Parked under Out of scope.
5. **`router.back()` on seed-fail** (instead of staying on the preview). Rejected: LOCKED U9 says stay on
   the preview with an error surface; staying gives a Retry-able context and matches the editor's
   `console.warn` pattern.
6. **Make `<RoutineExerciseCard>` read-only via an `isEditing` prop** — rejected (LOCKED #1: build a new
   card). It would bloat the 339-line card with branching.
7. **(v2-new) Re-route E1/E2 builder-open via direct `page.goto('/routines/{id}')` for BOTH tests**
   (the test-4 pattern) — uniform, decouples the test from the preview→header path. **Chosen for E1
   (`crud.spec.ts`)** because that test's intent is the delete-flow, not the navigation path — a direct
   `goto` is the most robust way to land on the builder without depending on the new preview chrome.
   **NOT chosen for E2** — see Alternative 8.
8. **(v2-new) Re-route E2 builder-open via row→preview→header `"Edit this routine"`** — keeps the
   active-session navigation realistic. **Chosen for E2 (`probe-strong-unify.spec.ts:232`)** because that
   test is specifically about the active-session UX path (banner-resume vs row), so routing through the
   real preview→header Edit affordance keeps the test honest to the user journey it asserts. Rejected the
   uniform-`goto` here because it would bypass the very navigation surface this test exists to exercise.
9. **(v2-new) Keep preview-header label `"Edit routine"` and use exact `getByLabel` everywhere**
   (no rename) — rejected: it works for TODAY's exact selectors, but leaves the latent prefix-collision
   trap (MIN-1) for any future `^=` selector. Renaming to `"Edit this routine"` removes the trap by
   construction at zero cost.

---

## Out of scope (carried from v1 unchanged)

- Editor / `<RoutineExerciseCard>` refactor (the read-only render is a NEW component, not a refactor).
- `useStartSessionFromRoutine` / `seedSetsForSession` / the hard-fail policy — unchanged.
- `startAdHocWorkout` "Quick start workout" — unchanged (its `getByText("Quick start workout")` queries
  are a DIFFERENT label and stay).
- Migration / schema / RLS / new query.
- Strong-style preview chrome beyond exercises + per-set targets: rest timers, supersets, set-volume
  targets, reorder, inline edit.
- Always-previewable-while-active rows (Alternative 4) — parked.
- A spinner-on-row-pending (the row no longer starts, so there is no pending state to show on it).

---

## Test plan

### e2e — `tests/e2e/routine-strong-builder.spec.ts` (F5)

**5 test bodies change** (1, 2, 3, 5, 6). Test 4 ("soft-delete then re-add") navigates DIRECTLY to
`/routines/{id}` (`spec:375`) and never taps the row — **no change**. Test 7 ("duplicate-exercise") is
pure DB, no UI — **no change**.

Each of tests 1, 2, 3, 5, 6 gets: (i) the row selector re-pointed per the close-set table (S1–S6) and
(ii) a **preview→Start insertion**: after the (re-pointed) row click, which now opens the preview, wait
for the preview route, then click the preview's Start button, THEN keep the existing live-session
assertions.

- **Test 1 — golden path** (`spec:190-247`): **DELETE** the stale `getByLabel(\`Start workout: Golden
  RSB ...\`)` warmup line (S1, `:212-215`) — it is a `.catch`-guarded best-effort with `slice(0,0)||""`
  (resolves to no-name; dead). Re-point the real locator S2 (`:217`) to
  `[aria-label^="View routine: Golden RSB"]`, click it, then
  `await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview$/);` then
  `await page.getByLabel("Start workout").click();` then the existing
  `waitForURL(/\/workout\/[0-9a-f-]+/)` + the 3-seeded-sets admin assertions (unchanged — real teeth).
- **Test 2 — dropset** (`spec:253-297`): re-point S3 (`:272`) → `[aria-label^="View routine: Dropset
  RSB"]`; same preview→Start insertion; existing `parent_set_id` assertion unchanged.
- **Test 3 — idempotency** (`spec:303-344`): re-point S4 (`:319`) → `[aria-label^="View routine: Idem
  RSB"]`, click → preview, THEN the **double-tap moves to the Start button**:
  `const startBtn = page.getByLabel("Start workout"); await Promise.all([startBtn.click(),
  startBtn.click().catch(()=>undefined)]);`. The `pendingRoutineId` guard (now on the preview) must
  still yield exactly ONE session. Teeth: `count === 1` sessions AND `setCount === 1` seeded set
  (`:335,343`) — real values, unchanged.
- **Test 5 — edit-then-restart** (`spec:400-449`): re-point S5 (`:420`) → `[aria-label^="View routine:
  Edit RSB"]`; same row→preview→Start insertion; the soft-delete + "live sets still 3" assertion
  (`:448`) unchanged.
- **Test 6 — seed-fail hard fail** (`spec:455-511`): re-point S6 (`:486`) → `[aria-label^="View routine:
  Fail RSB"]`, click → preview → `getByLabel("Start workout").click()` (the route intercept rejects the
  seed POST 500). **Re-pin the URL assertion** (R-2, `:493`):
  `expect(page.url()).toMatch(/\/workout\/?$/)` → `expect(page.url()).toMatch(/\/routines\/[0-9a-f-]+\/preview$/)`
  (LOCKED U9 — the user stays on the preview). The orphan-session + zero-sets assertions (`:495-510`) are
  unchanged and keep their teeth (1 orphan session, 0 sets).

### e2e — `tests/e2e/crud.spec.ts` (F5 — **v2-new, MAJ-1**)

- **Test "routines: create, see in list, open detail, delete"** (`:~92-129`): the builder is opened via
  the row's Edit pill `getByLabel(\`Edit routine: ${name}\`)` at `:113` (E1). The pill is gone (F4).
  **Re-route via direct `page.goto`** (Alternative 7 — this test's intent is the delete flow, not the
  nav path): replace `:113` with
  ```ts
  // The row's Edit pill was removed (preview is the hub). Open the builder directly.
  const routineRow = page.getByLabel(`View routine: ${name}`);
  await expect(routineRow).toBeVisible({ timeout: 10_000 });
  // Read the routine id off the preview, then goto the builder — or goto via the
  // preview→header Edit. Simplest + robust: tap the row → preview → header Edit.
  await routineRow.click();
  await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview$/, { timeout: 10_000 });
  await page.getByLabel("Edit this routine").click();
  await page.waitForURL(/\/routines\/[0-9a-f-]+$/, { timeout: 10_000 });
  ```
  (If the Implementer prefers a pure `page.goto('/routines/{id}')`, the routine id must first be read —
  e.g. via admin or the preview URL. The row→preview→header-Edit path above needs no id read and is the
  pinned choice.) The subsequent `:114` `waitForURL(/\/routines\/[0-9a-f-]+/)` is subsumed by the
  `:.../$/` wait above; the delete-flow assertions (`:116-125`) are UNCHANGED. The new
  `waitForURL(/\/routines\/[0-9a-f-]+$/)` (no `/preview` suffix) confirms we are on the builder, not the
  preview, before the delete.

### e2e — `tests/e2e/probe-strong-unify.spec.ts` (F5 — **v2-new, MAJ-1 + MAJ-2**)

- **Test "routine card with active session: opacity-60, tap is a no-op"** (`:188-243`):
  - **MAJ-2 re-pin (S7, `:217`):** `const row = page.getByLabel(\`Start workout: ${routineName}\`);`
    → `const row = page.getByLabel(\`View routine: ${routineName}\`);`. The opacity-0.6 assertion
    (`:218-220`) and the no-op-tap assertion (`:226-228`) are **PRESERVED UNCHANGED** — verified intact
    in §"Row disabled-when-active verification" (the row still gets `opacity-60` + `onPress=undefined`
    when `disabled`). Do NOT delete this test — it is the ONLY e2e proof of the row-disabled-when-active
    behavior R-3 keeps.
  - **MAJ-1 re-route (E2, `:232`):** the builder is opened via the row's Edit pill
    `getByLabel(\`Edit routine: ${routineName}\`)`. The pill is gone (F4). **Re-route via
    row→preview→header `"Edit this routine"`** (Alternative 8 — this test exercises the active-session
    nav UX, so route through the real preview):
    - PROBLEM: the row is `disabled={hasActive}` here (a session is active), so a row tap is a no-op
      (`:226-228` just asserted it). The row CANNOT open the preview while active.
    - SOLUTION: reach the builder via **direct `page.goto('/routines/{id}')`** using the routine id.
      The test does not yet hold the routine id (it only seeded a name at `:194-199`). Read it once:
      after `:201`, query it via admin —
      `const { data: r } = await admin.from("routines").select("id").eq("user_id", userId).eq("name", routineName).single();`
      then at `:232` replace the Edit-pill click with
      `await page.goto(\`/routines/${r!.id}\`, { waitUntil: "domcontentloaded" });` +
      `await page.waitForURL(/\/routines\/[0-9a-f-]+$/, { timeout: 10_000 });`. This is the test-4 pattern
      (direct goto) and is the ONLY viable path because the active-session row is non-interactive by
      design — the preview→header path is unreachable while `hasActive`. (This supersedes Alternative 8's
      preview-route preference FOR THIS TEST specifically, because the row is disabled; documented here so
      the Implementer does not try the unreachable preview tap.) The subsequent banner assertions
      (`:235-241`) are UNCHANGED.

### New preview-specific e2e (add to `routine-strong-builder.spec.ts` or a new `routine-preview.spec.ts`)

- **P1 — tap row → preview renders targets (with teeth).** Seed a routine with a known set (reps 8,
  weight "60.00"). Sign in, click `[aria-label^="View routine: <Name>"]`, wait for the preview URL, then
  assert a SPECIFIC value on a real text surface:
  `await expect(page.getByText("60", { exact: true }).first()).toBeVisible()` (the displayed weight) +
  the exercise name visible. Real value on a regular `<Text>` node, NOT an SVG tick (feedback lesson).
  P1b (optional): seed an exercise with no sets, assert `"No sets configured."` is visible.
- **P2 — Start from preview begins the session.** Click `getByLabel("Start workout")`,
  `waitForURL(/\/workout\/[0-9a-f-]+/)`, assert the seeded set via admin (subsumed by test 1's insertion;
  may be merged into test 1).
- **P3 — row no longer direct-starts (regression guard, E8).** After clicking the row, assert the URL is
  the preview route and NOT `/workout/{id}`:
  `await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+\/preview$/)` before any Start click. Real teeth on
  the "row stopped starting" behavior.
- **P4 — Edit jump (E7).** In the preview, click **`getByLabel("Edit this routine")`** (exact — MIN-1),
  `waitForURL(/\/routines\/[0-9a-f-]+$/)` (the builder, no `/preview` suffix), assert the editor's
  "Exercises" / "Save details" surface visible.
- **P5 — Guard A: Start-while-active routes to the EXISTING session (MIN-2, E4).** Seed a routine. Sign
  in. Open the preview FIRST (`[aria-label^="View routine: <Name>"]` → preview) BEFORE going active
  (the row is interactive only while no session is active). Then start an ad-hoc session via a second
  path — OR, since the preview is already open, simulate an active session by Quick-starting in a way
  the preview can observe; the robust deterministic shape: seed the routine, sign in, open the preview,
  then via admin create an active session for the user, reload the preview (so `useActiveSession` sees
  it), tap `getByLabel("Start workout")`, and assert the URL lands on `/workout/{existingId}` (Guard A's
  `router.push(active.id)`) with `count === 1` sessions (no 2nd session created). Teeth:
  `page.url()` contains the pre-existing session id AND sessions `count === 1`. Low priority (Guard A is
  a verbatim move), but it is the ONLY e2e proof of Guard A on the new surface — add it.

### Unit tests (F6) — carried from v1 unchanged

Likely **none new**: the preview reuses the existing PURE helpers `displayWeight`/`displayReps`
(`set-display.ts`), which already have unit coverage. The read-only card is JSX-only (no new pure
transform). IF the Implementer factors a `presentRoutineSetRow(s, unit)` presenter (optional), it is
unit-testable and should get a small `describe` block. The design does NOT require it. State this so the
Implementer doesn't over-extract.

---

## Response to Validator issues (round 1 → v2)

- **MAJ-1 (Edit-pill removal breaks `crud.spec.ts:113` + `probe-strong-unify.spec.ts:232`).** RESOLVED.
  F5 now covers BOTH specs (E1, E2 in the close-set table + the per-spec test plan). The builder-open
  path is re-routed and PINNED per test: `crud.spec.ts` → **row → preview → header `"Edit this
  routine"`** (Alternative 7/8 reconciled — uses the real preview, no id read needed);
  `probe-strong-unify.spec.ts:232` → **direct `page.goto('/routines/{id}')`** (the test-4 pattern),
  because the row is `disabled={hasActive}` there so the preview→header path is unreachable. The
  "exactly 5 tests change" prose is corrected to **5 in `routine-strong-builder` + 1 in `crud` + 1 in
  `probe-strong-unify` = 7 test bodies across 3 specs**.
- **MAJ-2 (row relabel breaks `probe-strong-unify.spec.ts:217`).** RESOLVED. S7 is re-pinned exact:
  `getByLabel("Start workout: {name}")` → `getByLabel("View routine: {name}")`. The opacity-0.6
  (`:218-220`) and no-op-tap (`:226-228`) assertions are PRESERVED (not deleted) — the test stays the
  only e2e proof of row-disabled-when-active. §"Row disabled-when-active verification" confirms the
  relabeled, Edit-pill-less single-Pressable row still honors `disabled={hasActive}` → opacity-60 +
  `onPress=undefined` (no-op), line-by-line against the F4 diff.
- **MIN-1 (preview-header label `"Edit routine"` is a prefix of the old row label).** RESOLVED. The
  preview-header label is renamed to **`"Edit this routine"`** (no substring overlap with `"Edit routine:
  {name}"`); the affected tests use exact `getByLabel("Edit this routine")`; no `[aria-label^="Edit
  routine"]` prefix selector is used anywhere. See §"Edit label disambiguation" + R-9.
- **MIN-2 (no Guard-A active-routing e2e).** RESOLVED. Added **P5** to the preview test plan — asserts
  Start-while-active routes to the EXISTING session id with `count === 1`.
- **MIN-3 (citation drift `history/[id].tsx:299-308`).** RESOLVED. Corrected to `:288-308` (Done arm
  `:300-307`) in the Approach + F1 header. Cosmetic; pattern + snippet were already correct.

---

## What I most want the Validator to re-check (v2)

1. **The label close-set is now COMPLETE and exhaustive.** §"Close-the-set on the a11y LABELS" lists all
   9 query sites (7 `Start workout:` + 2 `Edit routine:`) across exactly 3 specs, with the verbatim
   selector + per-site v2 action, the count stated, and the no-N+1th proof. This was the exact v1 NO-GO
   gap — please confirm no 4th spec and no app surface beyond `routine-list-item.tsx:43,62` queries/
   produces these labels (the Quick-start ad-hoc `getByText("Quick start workout")` is a different,
   untouched label).
2. **The two builder-open re-routes are each viable.** `crud.spec.ts` via row→preview→header `"Edit this
   routine"`; `probe-strong-unify.spec.ts:232` via direct `page.goto('/routines/{id}')` (the row is
   disabled-while-active so the preview path is unreachable there — confirm this constraint forces the
   goto, and that the test reads the routine id once via admin).
3. **The MAJ-2 row semantics survive the relabel + Edit-pill removal.** §"Row disabled-when-active
   verification" claims the single-Pressable row still produces opacity-0.6 + no-op tap under
   `disabled={hasActive}`; confirm against the F4 diff that the opacity `<View>` and `onPress`-gating are
   untouched.
