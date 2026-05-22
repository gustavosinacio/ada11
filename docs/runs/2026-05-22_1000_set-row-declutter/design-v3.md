# Design v3 — 2026-05-22_1000_set-row-declutter

> Final D↔V round (3 of 3). Tight delta from v2. Sections tagged `[v2-carryover]`, `[changed-v3]`, or `[new-v3]`. Read v2 first; only the BLK-1 fix and two MIN polish items are spelled out below.

## Goal (1 sentence) [v2-carryover]

Move the per-set RPE input and notes input off the live set row and behind a single `MoreHorizontal` trigger that opens a hand-rolled bottom-sheet menu, leaving the row visually clean (set-number badge · set type · weight · reps · check · menu) while preserving full editability on both the live workout and history detail screens.

## Approach [v2-carryover, with one correctness fix]

v2 strategy stands: strip RPE/notes from `<SetInput>`, replace with `MoreHorizontal` trigger that opens a hand-rolled `<Modal>` bottom-sheet (`<SetRowMenu>`). RPE chip taps commit immediately; notes commits on dismiss. `updateSetMeta(id, {rpe?, notes?})` isolates RPE/notes writes from the existing reps/weight write path.

**One v3 correctness fix** [changed-v3]: `updateSet` (`src/api/sets.ts:77-94`) currently does `.update({reps: patch.reps ?? null, weight: patch.weight ?? null, rpe: patch.rpe ?? null, notes: patch.notes ?? null})`. With v2's narrowing of `<SetInput>.onCommit` to `{reps, weight}`, every reps/weight blur sends `patch.rpe === undefined` and `patch.notes === undefined`, which the `?? null` collapses to literal `null` in the UPDATE payload — **erasing the user's saved RPE and notes**. v3 switches `updateSet` to the same partial-spread pattern as `updateSetMeta`. Both API writers now share one contract (`undefined`=absent, `null`=clear, value=write). The footgun framed in v2 as "still exists, out of scope" is **fixed in v3** at the root.

The Validator's "option a" was right: blast radius is small (one mutation hook, two callers, both already pass only the fields they want written), and the partial-spread pattern strictly preserves correctness for every current call site.

## Decisions on unknowns [v2-carryover]

Table unchanged from v1/v2. Conductor's calls (a)–(m) remain. The v3 additions are pure code/contract changes, not new product decisions.

## Mudanças por arquivo

| File | Type | Change | Tag |
|---|---|---|---|
| `src/api/sets.ts` | edited | **v3**: `updateSet` switched to partial-spread (`if (patch.X !== undefined) payload.X = patch.X`) for `reps`, `weight`, `rpe`, `notes`. Empty-patch short-circuit returns `null`. Return type widened to `SetRow \| null`. One-line JSDoc documents the tri-state contract. **v2**: `updateSetMeta` already uses this pattern. | [changed-v3] |
| `src/hooks/use-sets.ts` | edited | **v3**: `useUpdateSet` tolerates `null` from `updateSet` (empty-patch case) by skipping invalidation on null. Patch type narrowed to `Partial<{reps: number \| null; weight: string \| null; rpe: string \| null; notes: string \| null}>` to make "key present or absent" the idiomatic shape (MIN-9-v2). **v2**: `useUpdateSetMeta` already does this. | [changed-v3] |
| `src/components/set-row-menu.tsx` | new | **v2 design stands**. **v3 polish (MIN-9-v2)**: `Props.onSubmit` retyped to `(patch: UpdateSetMetaInput) => void` where `UpdateSetMetaInput` keys are `key?: string \| null` (no explicit `undefined` in callers — omit the key instead). Documented in JSDoc. | [changed-v3] |
| `src/components/set-input.tsx` | edited | **v2 design stands**: `{menuOpen ? <SetRowMenu .../> : null}` mount-gating; `onCommit` narrowed to `{reps, weight}`; menu trigger added. **v3**: confirmed `onCommit` call sites in this file only pass `reps` and `weight` (no stale `rpe`/`notes` keys carried forward). | [v2-carryover, audit-confirmed-v3] |
| `src/components/exercise-block.tsx` | edited | Unchanged. Drop `RPE` label + trailing spacers, add `onUpdateSetMeta` prop, pass through. | [v2-carryover] |
| `app/(app)/workout/[sessionId].tsx` | edited | Unchanged from v2. `onUpdateSet={async (id, patch) => await updateSet.mutateAsync({id, patch})}` at `:379-385` forwards the (now-narrowed) `{reps, weight}` patch verbatim — **safe under v3's partial-spread `updateSet`**. Wire `useUpdateSetMeta(sessionId)` and pass `onUpdateSetMeta` to `<ExerciseBlock>`. | [v2-carryover, audit-confirmed-v3] |
| `app/(app)/history/[id].tsx` | edited | Unchanged from v2. `onUpdateSet={async (setId, patch) => await updateSet.mutateAsync({id: setId, patch})}` at `:261-267` forwards verbatim — same shape, same safety. | [v2-carryover, audit-confirmed-v3] |
| `tests/unit/api-sets.updateSet.test.ts` | new | **v3**: unit tests for the partial-spread `updateSet`. Six cases covering reps-only, weight-only, rpe-only, rpe-clear (`null`), full patch, empty patch. See Test plan. | [new-v3] |
| `tests/unit/api-sets.updateSetMeta.test.ts` | new | Unchanged from v2. | [v2-carryover] |
| `tests/unit/use-sets.useUpdateSetMeta.test.ts` | new | Unchanged from v2. | [v2-carryover] |
| `tests/e2e/set-row-menu.spec.ts` | new | Unchanged from v1/v2 plan. | [v2-carryover] |

Single-responsibility note: `src/api/sets.ts` carries two coordinated edits in this run (new `updateSetMeta`, partial-spread `updateSet`). Both share one purpose — making the `sets` UPDATE surface honor `undefined`=absent. Acceptable single responsibility per the playbook (one purpose, one file).

## Page composition [v2-carryover]

Unchanged from v2. No visual delta. The v3 fix is invisible to the user — they simply stop losing their saved RPE/notes on every reps/weight commit.

## Contratos de I/O

### `src/api/sets.ts` — `updateSet` [changed-v3]

```ts
/**
 * Partial-update for one set's reps / weight / rpe / notes columns.
 *
 * Tri-state semantics per key (binding on all callers):
 *   - key omitted (or value `undefined`) → column NOT touched.
 *   - key present with value `null`      → column EXPLICITLY cleared.
 *   - key present with a value           → column written.
 *
 * Empty patch (`{}` or all-undefined) short-circuits before any network call
 * and returns `null`. Callers (useUpdateSet) MUST tolerate a `null` result
 * by skipping cache writes.
 *
 * Mirrors updateSetMeta's payload semantics so the two API writers behave
 * identically on the shared sets UPDATE surface.
 */
export async function updateSet(
  id: string,
  patch: UpdateSetInput,
): Promise<SetRow | null> {
  const payload: {
    reps?: number | null;
    weight?: string | null;
    rpe?: string | null;
    notes?: string | null;
  } = {};
  if (patch.reps !== undefined) payload.reps = patch.reps;
  if (patch.weight !== undefined) payload.weight = patch.weight;
  if (patch.rpe !== undefined) payload.rpe = patch.rpe;
  if (patch.notes !== undefined) payload.notes = patch.notes;

  if (Object.keys(payload).length === 0) return null;

  const { data, error } = await supabase
    .from("sets")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as SetRow;
}
```

**Caller behavior under the new contract** (audited):

- `<SetInput>.onCommit` (v2-narrowed) emits `{reps: number | null, weight: string | null}`. The history and workout screen wrappers forward this verbatim into `updateSet.mutateAsync({id, patch})`. Both keys are always present (reps and weight are always part of the row state), so reps/weight columns are written on every blur — exact same persistence behavior as today. `rpe` and `notes` keys are now absent from the payload → **left untouched in the DB → no more data loss**. This is the BLK-1 fix.
- `<SetRowMenu>.onSubmit` flows through `useUpdateSetMeta` → `updateSetMeta`, not through `updateSet`. Unchanged from v2.
- No call site exists today that intentionally passes `{rpe: null}` through `updateSet` to clear RPE. Clearing now flows through `<SetRowMenu>`'s "—" chip → `updateSetMeta({rpe: null})`. So we are not breaking any existing clear path.

**Why the previous `?? null` was wrong, restated for the record**: in `Partial<{rpe: string | null}>`, `patch.rpe === undefined` means "the caller didn't say anything about RPE — leave it alone". The old `patch.rpe ?? null` collapsed that to "clear RPE". With v1's old `<SetInput>` that always populated `rpe` and `notes` from its own state on every commit, this was hidden (every blur wrote the same persisted values back, a no-op rewrite). v2's narrowing exposed the bug by removing the always-included keys.

### `src/api/sets.ts` — `updateSetMeta` [v2-carryover]

Unchanged from v2. The contract documented at design-v2:46-92 stands verbatim.

### `src/hooks/use-sets.ts` — `useUpdateSet` [changed-v3]

```ts
/**
 * Partial-update mutation for a set's reps / weight / rpe / notes.
 *
 * Type intent: pass only the keys you want to write. `patch.X = undefined`
 * is tolerated but discouraged — omit the key instead. `patch.X = null`
 * explicitly clears the column.
 *
 * Returns null when the patch was empty (no keys with defined values); the
 * onSuccess handler then skips invalidation since nothing changed.
 */
export function useUpdateSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSetInput }) =>
      updateSet(id, patch),
    onSuccess: (result) => {
      if (result === null) return;
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
```

Two changes from v2's no-op-carryover:

1. `onSuccess` now receives the `result` (`SetRow | null`) and skips invalidation on `null`. Matches `useUpdateSetMeta`'s pattern.
2. The `["stats"]` invalidation is **retained** here (reps and weight ARE inputs to volume / PR signals — diverges from `useUpdateSetMeta` for exactly that reason, as documented in v2).

### `src/components/set-row-menu.tsx` props [changed-v3 — MIN-9-v2]

```ts
// UpdateSetMetaInput already uses `key?: string | null` — explicit undefined
// is permitted by the type but discouraged. Document in props JSDoc.
type Props = {
  onClose: () => void;
  setNumber: number;
  exerciseName: string;
  initialRpe: string | null;
  initialNotes: string | null;
  previousRpe: string | null;
  /**
   * Patch contract: omit keys you don't want to write. `null` explicitly
   * clears the column. Do NOT pass `undefined` — omit instead. See
   * UpdateSetMetaInput JSDoc in src/api/sets.ts.
   */
  onSubmit: (patch: UpdateSetMetaInput) => void;
};
```

`UpdateSetMetaInput` from v2 stands: `{ rpe?: string | null; notes?: string | null }`. The MIN-9-v2 polish is purely documentary — no runtime change. We don't switch to a more exotic "key-present-or-absent" branded type because the cost (custom utility type, callers fight ergonomics) exceeds the benefit (the JSDoc + unit tests already pin the contract).

### Other contracts [v2-carryover]

- `<SetInput>` props, `<ExerciseBlock>` prop additions, DB columns/queries, RLS — all unchanged from v2.

## Test plan

### Unit [changed-v3 — added BLK-1 coverage]

1. **`tests/unit/api-sets.updateSet.test.ts`** (new in v3) — Vitest with `supabase` mocked. Tests the partial-spread `updateSet`:
   - `updateSet(id, { reps: 5 })` → `.update({ reps: 5 })` exactly. **No `weight`, `rpe`, or `notes` keys in payload.** This is the regression test for BLK-1.
   - `updateSet(id, { weight: "100" })` → `.update({ weight: "100" })`. Other keys absent.
   - `updateSet(id, { rpe: "9.0" })` → `.update({ rpe: "9.0" })`. Other keys absent.
   - `updateSet(id, { rpe: null })` → `.update({ rpe: null })` (explicit clear). Other keys absent.
   - `updateSet(id, { reps: 5, weight: "100", rpe: "9.0", notes: "x" })` → all four keys present in one call.
   - `updateSet(id, {})` → no `.update(...)` call. Returns `null`. No network.
   - `updateSet(id, { reps: undefined, weight: undefined })` → no `.update(...)` call. Returns `null`. No network.
   - `.eq("id", id).select().single()` chain invoked exactly once on non-short-circuit paths.

2. **`tests/unit/api-sets.updateSetMeta.test.ts`** (v2, unchanged) — 7 cases per v2 plan.

3. **`tests/unit/use-sets.useUpdateSetMeta.test.ts`** (v2, unchanged) — `["sets", sessionId]` invalidated; `["stats"]` not invalidated; empty-patch short-circuit triggers no invalidation.

4. **New optional smoke test** for `useUpdateSet`'s null tolerance: confirm that when `mutationFn` returns `null` (empty patch), neither `["sets", sessionId]` nor `["stats"]` is invalidated. Low priority — can fold into the existing `useUpdateSetMeta` test file.

### Component / E2E [v2-carryover]

5. `<SetRowMenu>` component test per v2 plan: chip selection, clear chip dispatches `{rpe: null}`, notes commit on close, backdrop dismiss, previous-set hint, legacy `"9"` chip equality.

6. E2E specs per v1/v2 plan. **One additional E2E assertion** that directly verifies BLK-1 is closed: in the existing RPE-persistence spec, after the user sets RPE via the menu, blur a reps input on the same row → re-open the menu → assert RPE chip still highlighted to the value the user picked (not cleared). Trivial extension to an existing spec, not a new spec file.

### Regression [v2-carryover]

7. Existing suite continues to pass unchanged. Discovery verified zero specs touch the inline RPE input or `Toggle set notes` label.

## Riscos

### Data integrity (RLS, migrations) [changed-v3]

- No migration, no schema change, no RLS policy change.
- **`updateSet` clobber footgun is now fixed**, not "still exists". Both API writers (`updateSet`, `updateSetMeta`) share the same tri-state contract (`undefined`=absent, `null`=clear, value=write). The v2-design's framing that the footgun was "out of scope" is **superseded by v3**.
- Partial-update concurrency: a reps/weight blur and a near-simultaneous RPE chip tap now write disjoint columns (reps/weight via `updateSet`, rpe via `updateSetMeta`), eliminating the last-write-wins race v1 noted. Concurrent writes to the **same** column (two RPE chip taps in flight) still last-write-wins — acceptable, no change from today.
- **Behavior change for any hypothetical caller that used to rely on `updateSet` clearing rpe/notes when the keys were absent**: there is no such caller in the codebase today (confirmed by audit at `app/(app)/workout/[sessionId].tsx:379-385` and `app/(app)/history/[id].tsx:261-267`). All current `useUpdateSet` invocations pass exactly the fields they want written. So this is a strict bug fix, not a behavior change with risk.

### UX regressions [v2-carryover]

- Shared `<SetInput>` editable on both live workout and history detail — verified.
- Existing e2e specs unaffected — verified.
- First-time-user discoverability of the gray `MoreHorizontal` icon — accepted; spec calls for "subtle".
- Keyboard avoidance: KAV with `behavior="padding"` on iOS, `"height"` on Android. v2-carryover.
- Trash tap-target debt: still out of scope, logged as follow-up.

### Platform-specific (iOS / Android / web) [v2-carryover]

- React Native `<Modal animationType="slide" transparent>` works cross-platform.
- Chip strip uses horizontal `<ScrollView>` with content-sized chips.
- `MoreHorizontal` lucide icon — same on all three platforms.

### Performance [v2-carryover + one v3 note]

- One PostgREST round-trip per chip tap or reps/weight blur. Same as today.
- No idle `<SetRowMenu>` JSX trees thanks to mount-gating (v2).
- `["stats"]` invalidation kept on `useUpdateSet` (reps/weight feed stats), dropped on `useUpdateSetMeta` (RPE/notes don't).
- **v3 note**: the partial-spread payload is occasionally smaller than today's 4-key clobber (e.g., a reps-only blur now sends `{reps: 5}` instead of `{reps: 5, weight, rpe, notes}`). Negligible wire-size delta; mentioned only for completeness.

## Alternativas descartadas

All v1/v2 alternatives stand. **New v3-only alternatives considered for the BLK-1 fix**:

1. **(BLK-1 alt b)** Re-broaden `<SetInput>.onCommit` to emit `{reps, weight, rpe, notes}` again, seeding `rpe`/`notes` from `row` via `useEffect`. Descartada porque it puts two writers on the same columns (`<SetInput>` row state + `<SetRowMenu>` draft state), reintroduces the race v2 eliminated, and forces a `useEffect` sync that fights React's render model (the same anti-pattern v1's spec explicitly avoided).

2. **(BLK-1 alt c)** New `updateSetCore(id, {reps, weight})` partial API, leaving `updateSet` for "full-patch" callers (which don't exist today). Descartada porque it adds a third API writer alongside `updateSet` and `updateSetMeta`, splits the sets UPDATE surface across three functions, and gives the legacy `updateSet` clobber a hall pass to outlive the run. Fixing `updateSet` directly is the strictly smaller surface.

3. **(MIN-9-v2 alt)** Custom branded "key-present-or-absent" utility type for `UpdateSetMetaInput`. Descartada porque the TS gymnastics required (`Omit` + conditional keys) outweigh the marginal safety win over a JSDoc-documented `key?: T | null` shape pinned by unit tests.

4. **(MIN-8-v2 alt)** Heavy migration-style JSDoc with `@deprecated` tag on the old `updateSet` clobber. Descartada porque there is no "old vs new" — `updateSet` is being fixed in place, not deprecated. A one-line JSDoc documenting the tri-state contract is the right scope.

## Out of scope [v2-carryover, with one item removed]

- ~~Fix `updateSet`'s clobber footgun.~~ **Done in v3.** Removed from out-of-scope.
- Move trash into the menu.
- Add a "previous set" visible column.
- Tap-target inflation on the trash icon. Logged as a follow-up.
- Inline rest-timer, plate-calculator integration.
- Schema / migrations / importer / cache buster.
- Active session banner, weekly-volume-strip, volume-target-slot.

## Resposta a issues do Validator (v2 → v3)

- **[BLK-1] `updateSet` clobber path NULLs saved RPE/notes on every reps/weight blur**: **fixed.** `src/api/sets.ts:77-94` `updateSet` switched to the partial-spread pattern (`if (patch.X !== undefined) payload.X = patch.X` for all four columns) with an empty-patch short-circuit that returns `null`. Return type widened to `SetRow | null`; `useUpdateSet.onSuccess` tolerates `null` by skipping invalidation. Audited both call sites (`app/(app)/workout/[sessionId].tsx:379-385` and `app/(app)/history/[id].tsx:261-267`): both forward the (v2-narrowed) `{reps, weight}` patch verbatim to `updateSet.mutateAsync`, so under v3's partial-spread the `rpe`/`notes` keys are simply absent from the UPDATE payload — left untouched in the DB. No caller passes a "full patch" with stale `rpe`/`notes` keys; no behavior change for any existing caller. New unit tests in `tests/unit/api-sets.updateSet.test.ts` cover the regression directly: `updateSet({reps: 5})` writes only `reps`. The v2 framing of the footgun as "still exists, out of scope" is dropped; this is now explicitly fixed (see Approach and Out of scope sections).

- **[MIN-8-v2] JSDoc on `updateSet` documenting the partial-spread contract**: addressed. The JSDoc block in the `updateSet` contract above documents the tri-state semantics (`undefined`=absent, `null`=clear, value=write), the empty-patch short-circuit, and the explicit alignment with `updateSetMeta`.

- **[MIN-9-v2] Tighten `<SetRowMenu>.onSubmit` and `useUpdateSetMeta` patch types to prefer "key present or absent"**: addressed via JSDoc on `<SetRowMenu>.onSubmit` and on `UpdateSetMetaInput` / `UpdateSetInput`. Runtime type stays `key?: T | null` (the idiomatic shape `Partial<>` produces); JSDoc explicitly tells callers to omit the key rather than pass `undefined`. Custom branded type considered and rejected in Alternativas descartadas #3 — TS cost exceeds safety win.
