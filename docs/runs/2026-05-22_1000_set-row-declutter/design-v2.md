# Design v2 — 2026-05-22_1000_set-row-declutter

> Tight delta from v1. Sections tagged `[v1-carryover]`, `[changed-v2]`, or `[new-v2]`. Read v1 first for full context; only changes are spelled out below.

## Goal (1 sentence) [v1-carryover]

Move the per-set RPE input and notes input off the live set row and behind a single `MoreHorizontal` trigger that opens a hand-rolled bottom-sheet menu, leaving the row visually clean (set-number badge · set type · weight · reps · check · menu) while preserving full editability on both the live workout and history detail screens.

## Approach [v1-carryover, with two clarifications]

v1 strategy stands: strip RPE/notes from `<SetInput>`, replace with `MoreHorizontal` trigger that opens a hand-rolled `<Modal>` bottom-sheet (`<SetRowMenu>`) modeled on `plate-calculator.tsx:69-153`. RPE chip taps commit immediately; notes commits on dismiss. New `updateSetMeta(id, {rpe?, notes?})` API isolates partial-field writes from the existing `updateSet` clobber path.

Two correctness clarifications surfaced in validation v1:

1. **`updateSetMeta` payload semantics** [changed-v2]: the spread guard distinguishes `undefined` (absent — do not touch column) from `null` (explicit clear — write `null` to the column). v1's `hasOwnProperty + ?? null` collapsed both into clear; v2 uses `if (patch.rpe !== undefined) payload.rpe = patch.rpe`. Empty patches short-circuit before any network call.

2. **`<SetRowMenu>` mount lifecycle** [changed-v2]: the menu JSX is gated by `menuOpen` (`{menuOpen ? <SetRowMenu .../> : null}`) inside `<SetInput>`, not always-mounted with `visible` toggling. This guarantees a fresh mount on every open so draft state seeds from current row data (no stale chip selection after cache invalidations); it also eliminates the 20+ idle JSX trees per session that v1's always-mounted approach would have created.

## Decisions on unknowns [v1-carryover]

Table unchanged from v1. The Conductor's calls (a)–(m) remain in force: bottom-sheet, `MoreHorizontal`, icon-tint indicator, "—" clear chip, full `5 → 10` range, `updateSetMeta` (option c), `"Open set details"` label, editable in history, trash on row, chip-tap-immediate / notes-on-dismiss commit, header-row drop "RPE" label, previous-set chip hint, no cache buster.

## Mudanças por arquivo [mostly v1-carryover]

| File | Type | Change | Tag |
|---|---|---|---|
| `src/api/sets.ts` | edited | Add `UpdateSetMetaInput` and `updateSetMeta(id, patch)`. **v2 payload semantics**: `if (patch.rpe !== undefined) payload.rpe = patch.rpe;` (same for `notes`). Short-circuit `if (Object.keys(payload).length === 0)` returns the current cached row without hitting the network. See contract below. | [changed-v2] |
| `src/hooks/use-sets.ts` | edited | Add `useUpdateSetMeta(sessionId)`. **v2**: invalidates only `["sets", sessionId]`; **drops the `["stats"]` invalidation**. RPE/notes are not inputs to any stat query (verified — stats consume volume = weight × reps and PR signals; no RPE/notes consumer). Documented in JSDoc that this intentionally diverges from `useUpdateSet`. | [changed-v2] |
| `src/components/set-row-menu.tsx` | new | New `<SetRowMenu>` bottom-sheet. Owns draft state for RPE chip + notes text, seeded from `initialRpe` / `initialNotes` on mount. Because the parent gates mount via `{menuOpen ? ... : null}`, draft state is implicitly fresh on every open. **v2**: clear chip dispatches `onSubmit({ rpe: null })` (explicit clear). `KeyboardAvoidingView` wraps the card with `behavior={Platform.OS === "ios" ? "padding" : "height"}`. RPE chip equality uses `parseFloat(row.rpe ?? "").toFixed(1)` to normalize legacy `"9"` → `"9.0"`. | [changed-v2] |
| `src/components/set-input.tsx` | edited | v1 list of edits stands. **v2 addition**: render the menu as `{menuOpen ? <SetRowMenu .../> : null}` — not as `<SetRowMenu visible={menuOpen} .../>`. The conditional JSX is what guarantees a fresh mount, not the Modal's `visible` prop. | [changed-v2] |
| `src/components/exercise-block.tsx` | edited | Unchanged from v1. Drop `RPE` label + trailing spacers, add `onUpdateSetMeta` prop, pass through to `<SetInput>`. | [v1-carryover] |
| `app/(app)/workout/[sessionId].tsx` | edited | Unchanged from v1. Wire `useUpdateSetMeta(sessionId)` and pass `onUpdateSetMeta` to `<ExerciseBlock>`. | [v1-carryover] |
| `app/(app)/history/[id].tsx` | edited | Unchanged from v1. Same wiring as workout screen. | [v1-carryover] |
| `tests/unit/api-sets.updateSetMeta.test.ts` | new | **v2 expanded coverage** — see Test plan. | [changed-v2] |
| `tests/unit/use-sets.useUpdateSetMeta.test.ts` | new | **v2**: assert only `["sets", sessionId]` invalidated, **not** `["stats"]`. | [changed-v2] |
| `tests/e2e/set-row-menu.spec.ts` | new | Unchanged from v1 plan. | [v1-carryover] |

Single-responsibility note from v1 still applies: `set-input.tsx` carries three logical edits (remove RPE input, remove notes UI, add menu trigger) all serving the same goal of collapsing the row.

## Page composition [v1-carryover]

Unchanged from v1. Row layouts (before/after, live/history), header row, bottom-sheet ASCII art all stand. The sheet is now conditionally rendered (`{menuOpen ? ... : null}`) instead of always-mounted; visually identical.

## Contratos de I/O

### `src/api/sets.ts` [changed-v2]

```ts
export type UpdateSetMetaInput = {
  /** undefined = leave column alone; null = explicit clear; string = write value. */
  rpe?: string | null;
  /** Same tri-state semantics as rpe. */
  notes?: string | null;
};

export async function updateSetMeta(
  id: string,
  patch: UpdateSetMetaInput,
): Promise<SetRow | null> {
  // Build payload from *only* keys with defined values. undefined = absent
  // (do not touch column); null = explicit clear (write null).
  const payload: { rpe?: string | null; notes?: string | null } = {};
  if (patch.rpe !== undefined) payload.rpe = patch.rpe;
  if (patch.notes !== undefined) payload.notes = patch.notes;

  // Empty-patch short-circuit. PostgREST .update({}) is likely 400; even if
  // it weren't, a no-op write should not invalidate caches or round-trip.
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

Notes:
- **Semantics contract** (binding on all callers):
  - `updateSetMeta(id, { rpe: "9.0" })` → writes `rpe = "9.0"`, leaves `notes` untouched.
  - `updateSetMeta(id, { rpe: null })` → writes `rpe = NULL`, leaves `notes` untouched. **This is the "—" clear-chip path.**
  - `updateSetMeta(id, { rpe: undefined })` → no-op (short-circuited as empty patch).
  - `updateSetMeta(id, { rpe: "9.0", notes: "x" })` → writes both columns in one round-trip.
  - `updateSetMeta(id, {})` → returns `null`, no network call.
- The `"—"` RPE chip in `<SetRowMenu>` **must** pass `{ rpe: null }` (not `{ rpe: undefined }`). This is the only way to clear RPE; chip handler:
  ```ts
  onPress={() => onSubmit({ rpe: chip === null ? null : chip })}
  ```
- Return type widened to `SetRow | null` because of the short-circuit. Callers (`useUpdateSetMeta`) tolerate `null` by skipping cache writes.
- RLS unchanged. No DDL change. No new index.

### `src/hooks/use-sets.ts` [changed-v2]

```ts
/**
 * Partial-update hook for RPE and/or notes only. Diverges from useUpdateSet:
 *
 * - Uses updateSetMeta (true partial spread, not clobber).
 * - Invalidates ONLY ["sets", sessionId]. Does NOT invalidate ["stats"]
 *   because RPE and notes are not inputs to any stat query (volume = weight
 *   × reps; PR signals do not read rpe/notes). Skipping the stats
 *   invalidation avoids needless refetches on every chip tap.
 */
export function useUpdateSetMeta(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSetMetaInput }) =>
      updateSetMeta(id, patch),
    onSuccess: (result) => {
      // result is null when the patch was empty. No invalidation needed.
      if (result === null) return;
      qc.invalidateQueries({ queryKey: ["sets", sessionId] });
    },
  });
}
```

### `src/components/set-row-menu.tsx` [changed-v2]

Props shape unchanged from v1. Internals updated:

```ts
type Props = {
  // visible removed — parent gates JSX with {menuOpen ? ... : null}.
  // Component is always "visible" when mounted; closing == unmounting.
  onClose: () => void;
  setNumber: number;
  exerciseName: string;
  /** Current persisted value (one-decimal string like "9.0", or null). */
  initialRpe: string | null;
  /** Current persisted value, or null. */
  initialNotes: string | null;
  /** Previous-set RPE shown as a placeholder hint on the chip strip. */
  previousRpe: string | null;
  /**
   * Patch contract (mirrors updateSetMeta):
   * - { rpe: "9.0" } → set RPE to 9.0, leave notes alone.
   * - { rpe: null }   → CLEAR RPE (the "—" chip). Notes unchanged.
   * - { notes: "x" }  → set notes, leave rpe alone.
   * - { notes: null } → clear notes (textarea emptied + dismiss).
   * Never pass `undefined` — that's the "absent" sentinel, handled by simply
   * not including the key in the patch object.
   */
  onSubmit: (patch: UpdateSetMetaInput) => void;
};

export const RPE_CHIPS = [
  null, // "—" clear chip
  "5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0", "9.5", "10.0",
] as const;
```

**Chip equality** [changed-v2 — MIN-2]: when computing the selected chip, normalize the row's stored value:

```ts
const normalizedInitialRpe = initialRpe ? parseFloat(initialRpe).toFixed(1) : null;
// Then: chip === normalizedInitialRpe for highlight.
```

This mirrors `set-input.tsx:97`'s existing `parseFloat0(rpe)?.toFixed(1)` precedent and handles legacy rows persisted as `"9"` instead of `"9.0"`.

**Keyboard avoidance** [changed-v2 — MIN-4]:

```tsx
<Modal animationType="slide" transparent onRequestClose={onClose}>
  <View className="flex-1 justify-end bg-black/50">
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="w-full"
    >
      <View className="rounded-t-2xl bg-white px-6 pb-10 pt-6 dark:bg-gray-900">
        {/* chips + notes textarea + close button */}
      </View>
    </KeyboardAvoidingView>
  </View>
</Modal>
```

`behavior="height"` on Android keeps the card above the keyboard by shrinking the available view height — the appropriate Android default per RN docs. v1 spec'd `undefined` on Android (no avoidance), which would leave the multi-line textarea covered.

**Chip-tap-while-notes-focused race** [changed-v2 — MIN-5]: accept the two-write cost. When the user taps a chip while the notes `<TextInput>` is focused, `Keyboard.dismiss` triggers `onBlur` → notes commits via `onSubmit({ notes: ... })`, then the chip handler fires `onSubmit({ rpe: ... })`. Two round-trips, two invalidations. Acceptable because:
- Real-world frequency is low (chip-tap during notes typing is rare).
- The alternative (batch when notes dirty) requires a `notesDirty` flag and a single `onSubmit({ rpe, notes })` path that bypasses the textarea's own blur — meaningful state-management surface for a corner case.
- Both writes are idempotent and order-independent.

### `src/components/set-input.tsx` props [v1-carryover]

Props shape unchanged from v1:

```ts
type Props = {
  row: SetRow;
  unit: WeightUnit;
  previousSet?: SetRow | null;
  showCheckable?: boolean;
  onToggleChecked?: (nextChecked: boolean) => void;
  onCommit: (patch: { reps: number | null; weight: string | null }) => void;
  onUpdateMeta: (patch: UpdateSetMetaInput) => void;
  exerciseName: string;
  onDelete: () => void;
};
```

**Menu render site** [changed-v2 — MAJ-2]:

```tsx
{menuOpen ? (
  <SetRowMenu
    onClose={() => setMenuOpen(false)}
    setNumber={row.set_number}
    exerciseName={exerciseName}
    initialRpe={row.rpe}
    initialNotes={row.notes}
    previousRpe={previousSet?.rpe ?? null}
    onSubmit={(patch) => onUpdateMeta(patch)}
  />
) : null}
```

No `visible` prop. Mount-on-open, unmount-on-close. Each open seeds fresh draft state from the (now possibly-updated) `row` props.

### `src/components/exercise-block.tsx` prop additions [v1-carryover]

```ts
onUpdateSet: (
  id: string,
  patch: { reps: number | null; weight: string | null },
) => void;

onUpdateSetMeta: (id: string, patch: UpdateSetMetaInput) => void;
```

### DB columns / queries [v1-carryover]

- No DDL change. `sets.rpe numeric(3,1)`, `sets.notes text` — both already nullable.
- No new index. Writes hit a single row by PK.
- No RLS change. Existing `auth.uid() = user_id` policy covers partial UPDATEs.

## Test plan

### Unit [changed-v2 — expanded for MAJ-1]

1. **`tests/unit/api-sets.updateSetMeta.test.ts`** (new) — Vitest with `supabase` mocked:
   - `updateSetMeta(id, { rpe: "9.0" })` → `.update({ rpe: "9.0" })` exactly. Notes column not in payload.
   - `updateSetMeta(id, { rpe: null })` → `.update({ rpe: null })` (explicit clear). Notes column not in payload.
   - `updateSetMeta(id, { rpe: undefined })` → no `.update(...)` call. Returns `null`. No network.
   - `updateSetMeta(id, { rpe: "9.0", notes: "x" })` → `.update({ rpe: "9.0", notes: "x" })` in one call.
   - `updateSetMeta(id, { notes: null })` → `.update({ notes: null })`. RPE not in payload.
   - `updateSetMeta(id, {})` → no `.update(...)` call. Returns `null`. No network.
   - `.eq("id", id).select().single()` chain invoked exactly once on the non-short-circuit paths.

2. **`tests/unit/use-sets.useUpdateSetMeta.test.ts`** (new) — `@tanstack/react-query` test harness:
   - On successful non-empty mutation, `["sets", sessionId]` invalidated.
   - `["stats"]` is **not** invalidated (assertion against the spy). This is the intentional divergence from `useUpdateSet`.
   - On empty-patch short-circuit (`mutationFn` returns `null`), neither query key invalidated.

### Component / E2E [v1-carryover with one note]

3. Component test for `<SetRowMenu>` per v1 plan (chip selection, clear chip dispatches `{rpe: null}`, notes commit on close, backdrop dismiss, previous-set hint rendering). **v2 addition**: mount the menu with `initialRpe="9"` (legacy unpadded value) and assert the `9.0` chip is highlighted — covers the `parseFloat().toFixed(1)` normalization.

4. E2E specs per v1 plan (RPE persistence, notes persistence, clear RPE, history detail editability). No changes.

### Regression [v1-carryover]

5. Existing suite (`crud.spec.ts`, etc.) continues to pass unchanged. Discovery verified zero specs touch the inline RPE input or `Toggle set notes` label.

## Riscos

### Data integrity (RLS, migrations) [v1-carryover with one strengthening]

- No migration, no schema change, no RLS policy change.
- **Footgun in `updateSet` still exists** — unchanged from v1. JSDoc warning recommended; `updateSetMeta` is the documented preferred path for partial RPE/notes writes. **v2 reinforces** the contract by making `updateSetMeta`'s `undefined`-vs-`null` semantics explicit in both JSDoc and unit tests, so the new API itself is no longer a footgun.
- Partial-update concurrency unchanged from v1.

### UX regressions [changed-v2 for MIN-4]

- Shared `<SetInput>` editable on both live workout and history detail — verified.
- Existing e2e specs unaffected — verified by Validator.
- First-time-user discoverability of the gray `MoreHorizontal` icon — accepted; spec calls for "subtle".
- **Keyboard avoidance** [changed-v2]: `KeyboardAvoidingView` now wraps the inner card with `behavior="padding"` on iOS and `behavior="height"` on Android. The notes textarea is the bottom-most element of the card, so on a 320pt iPhone-SE or short Android device the keyboard would otherwise overlap it. `"height"` shrinks the avoidance container so the card slides up; this is the documented Android-safe default per RN.
- **Trash tap-target debt** [changed-v2 — MIN-3]: this design no longer cites `docs/iphone-shakedown.md` (the file is a blank template). The pre-existing tap-target debt on the trash icon (`set-input.tsx:187`, `rounded p-1` ≈ 24pt) is real but out of scope here; tracked as a separate follow-up in the run's final summary.

### Platform-specific (iOS / Android / web) [v1-carryover]

- React Native `<Modal animationType="slide" transparent>` works cross-platform — verified.
- Chip strip uses horizontal `<ScrollView>` with content-sized chips — no fixed-width layout drift.
- `MoreHorizontal` lucide icon — same on all three platforms.

### Performance [changed-v2 — MIN-1 and MIN-7]

- One PostgREST round-trip per chip tap. Same order as today's inline RPE blur commit.
- One round-trip per menu dismiss with dirty notes. Same as today's notes blur.
- **No idle `<SetRowMenu>` JSX trees** [changed-v2]: the `{menuOpen ? ... : null}` gate means at most 1 menu is mounted at a time across the whole exercise list (the one the user is currently viewing). Previously v1's always-mounted-with-`visible` toggle would have placed 20+ idle trees in a typical session.
- **No `["stats"]` invalidation on RPE/notes change** [changed-v2]: drops one unnecessary cache invalidation per chip tap; stats query results unchanged (verified that RPE/notes are not consumed by any stat).
- Cache invalidation surface narrower than `useUpdateSet` (only `["sets", sessionId]`). Documented in JSDoc.

## Alternativas descartadas [v1-carryover]

All five v1 alternatives stand:

1. Inline expandable panel (descartada — chip strip + multi-line textarea don't fit on 320pt without nested horizontal scroll).
2. Option (a) — fix `updateSet` to spread-only (descartada — behavior change with broad blast radius; `updateSetMeta` is just as surgical).
3. Option (b) — menu re-commits all 4 fields from row state (descartada — over-coupled; two writers race on the same fields).
4. `@gorhom/bottom-sheet` library (descartada — no sheet library installed; hand-rolled Modal proves sufficient).
5. Put delete inside the menu (descartada — out of scope per spec).
6. Different RPE range, `6 → 10` (descartada — spec lists `5` as the floor).

**v2-only alternatives considered**:

7. **MIN-5 alternative: batch chip+notes write when notes is dirty** — descartada porque it requires lifting the notes-dirty flag into a sibling-aware state owner, hijacking the textarea's natural `onBlur` handler, and threading a "skip the next blur commit" signal through. Two-write cost is fine for a rare interaction.
8. **MIN-7 alternative: keep `["stats"]` invalidation for parity with `useUpdateSet`** — descartada porque the invalidation does nothing useful for RPE/notes-only writes (no stat consumes them), and the divergence is documented in the hook's JSDoc to prevent future copy-paste confusion.

## Out of scope [v1-carryover]

- Fix `updateSet`'s clobber footgun.
- Move trash into the menu.
- Add a "previous set" visible column.
- Tap-target inflation on the trash icon. **Logged as a follow-up item in this run's final summary** (was previously cited via a hollow reference to `docs/iphone-shakedown.md`).
- Inline rest-timer, plate-calculator integration, etc.
- Schema / migrations / importer / cache buster.
- Active session banner, weekly-volume-strip, volume-target-slot.

## Resposta a issues do Validator (v1 → v2)

- **[MAJ-1] `updateSetMeta` undefined-vs-absent semantic**: addressed. The new implementation uses `if (patch.rpe !== undefined) payload.rpe = patch.rpe;` (same for `notes`), preserving the tri-state contract — `undefined` = absent (no field touched), `null` = explicit clear, value = write. The "—" RPE chip in `<SetRowMenu>` dispatches `onSubmit({ rpe: null })` and this is now stated explicitly in the menu's prop JSDoc and in the `updateSetMeta` contract notes. Empty-patch short-circuit added (`if (Object.keys(payload).length === 0) return null`); `useUpdateSetMeta` tolerates the `null` result by skipping invalidation. Unit tests cover all five cases (`{rpe: "9.0"}`, `{rpe: null}`, `{rpe: undefined}`, both, `{}`).

- **[MAJ-2] `<SetRowMenu>` JSX gated by `menuOpen`**: addressed. The menu is rendered as `{menuOpen ? <SetRowMenu .../> : null}` inside `<SetInput>` — no `visible` prop on the menu, and the v1 risk-section claim "Modal unmounts children when `visible=false`" is dropped. Each open is a fresh mount with draft state seeded from the current `row` props. This also resolves MIN-1 (no idle trees) — see Performance section.

- **[MIN-1] 20+ idle `<SetRowMenu>` trees**: resolved by MAJ-2's mount gating.

- **[MIN-2] Legacy RPE strings (`"9"` vs `"9.0"`)**: addressed. `<SetRowMenu>` normalizes `initialRpe` via `parseFloat(initialRpe).toFixed(1)` before chip equality (mirrors `set-input.tsx:97`). Component test added with `initialRpe="9"`.

- **[MIN-3] Hollow `docs/iphone-shakedown.md` citation**: dropped. Trash tap-target debt is now logged as a separate follow-up in this run's final summary instead of cited as "pre-existing debt".

- **[MIN-4] `KeyboardAvoidingView` Android behavior**: addressed. v2 specs `behavior={Platform.OS === "ios" ? "padding" : "height"}`. `"height"` is the documented Android-safe default; `"padding"` on Android can leave the bottom textarea covered.

- **[MIN-5] Chip-tap-while-notes-focused race**: addressed by explicit choice (option b — accept the two-write cost). Documented in `<SetRowMenu>` contract notes. Alternative (batched write with `notesDirty` flag) explicitly considered and rejected in Alternativas descartadas #7.

- **[MIN-6] Empty-patch network call**: addressed by MAJ-1's short-circuit.

- **[MIN-7] `["stats"]` invalidation on RPE/notes change**: addressed. `useUpdateSetMeta` invalidates only `["sets", sessionId]`. JSDoc documents the intentional divergence from `useUpdateSet` (RPE/notes are not consumed by any stat query).
