# Design v1 — 2026-05-21_1308_set-check-button

## Goal (1 sentence)

Add a per-set check button to the live workout screen that gates which sets are persisted on Finish (unchecked sets are either discarded or auto-checked via a 3-option dialog), implemented by repurposing `sets.completed_at` as a nullable "checked-at" flag and shipping a new cross-platform 3-option modal.

## Approach

The state must survive app reloads, so it lives on the row. We pick **option (a) — repurpose `completed_at`**: drop `NOT NULL`, treat `completed_at IS NULL` as "unchecked draft" and any timestamp as "checked at that moment". `logSet` flips from `completed_at = now()` to `completed_at = null` (newly added sets are unchecked by default, matching Strong). All existing rows already have non-null timestamps, so no backfill is needed; only one `ALTER COLUMN ... DROP NOT NULL` statement is required. Two per-row helpers (`checkSet`/`uncheckSet`) and two session-scope helpers (`bulkCheckAllInSession`/`bulkSoftDeleteUncheckedInSession`) cover the new flows, with `bulkSoftDelete` also cascading to any chained dropset children to keep referential integrity. The Finish handler grows into a 3-option flow rendered through a new `<ChooseActionModal>` (real React Native `<Modal>` cross-platform, since `window.confirm` is binary). `<ExerciseBlock>` and `<SetInput>` gain a `showCheckable` prop so history detail (read-only sessions) stays visually unchanged. Cache buster bumps to `schema-2026-05-21-set-check`.

## Decisions on unknowns (Discovery → this design)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Data model | **(a)** Repurpose `completed_at`, drop `NOT NULL` | Cheapest, no backfill, semantics already align (`logSet` set `completed_at = now()` meaning "I just did this set"). The shift to "after I tap check" is < a minute in practice. Validator should pin `NULLS LAST` in list-order. |
| 2 | Check icon position | **Left** of each set row, before the type badge | Strong-like priority: status-before-content. Also lets the type badge + #set# label and the input cluster stay untouched (no row repacking). |
| 3 | Visual state | Unchecked = outlined `Square` (gray); Checked = filled `CheckSquare` (primary blue); checked row gets `bg-blue-50 dark:bg-blue-950/30` tint | Calm contrast; tint adds instant visual scan. Inputs stay editable when checked (the user may correct a number after checking). |
| 4 | Auto-advance on check | **No** | Out of scope per prompt. |
| 5 | Auto-check on input commit | **No** | Filling and confirming are decoupled. Editing weight/reps does not flip the state in either direction. |
| 6 | Default state of new set | **Unchecked** | This is the point of the feature. |
| 7 | Removing exercise w/ mixed sets | No change | `bulkSoftDeleteSetsForExerciseInSession` already discards both checked and unchecked (filters on `deleted_at IS NULL` only). Correct behavior. |
| 8 | "Finish without saving" flow | Order: `bulkSoftDeleteUncheckedInSession(sid)` → invalidate `["sets", sid]` → `finish.mutateAsync(sid)`. If bulk-delete fails, do not finish; surface error. | Atomicity: no finished session ever contains rows with `completed_at IS NULL`. |
| 9 | "Auto-check all" flow | Order: `bulkCheckAllInSession(sid)` → invalidate `["sets", sid]` → `finish.mutateAsync(sid)`. Same failure semantics. | Same invariant. |
| 10 | 3-button dialog | New `<ChooseActionModal>` component using React Native `<Modal>` (works on web + native). 3 buttons: Cancel (top right X also closes), Finish without saving (destructive red), Auto-check all and finish (primary). | `window.confirm` is binary; sequential confirms is bad UX. Reusable for future N-way dialogs. |
| 11 | Cache buster | Bump `src/lib/query-client.ts:27` from `"schema-2026-05-19-muscles"` to `"schema-2026-05-21-set-check"` | Persisted caches from before this run carry `completed_at: string` (non-null). New cache rows may include `null`. Force one refetch. |
| 12 | Dropset orphan edge | `bulkSoftDeleteUncheckedInSession` cascades: also soft-delete any non-deleted dropset whose `parent_set_id` references an unchecked working set being discarded | Avoids `parent_set_id` referencing a soft-deleted row that's invisible to read filters. Single round-trip via `.in("parent_set_id", [...uncheckedIds])`. |
| 13 | Resume-after-reload | Free (state is in DB) | Verified by Discovery; flag in test plan only. |
| — | Cache invalidation on check/uncheck | Invalidate `["sets", sessionId]` only — **NOT** `["stats"]` | Stats queries filter `sessions.ended_at IS NOT NULL`; per-set state of in-progress sessions doesn't reach them. The finish-flow already invalidates `["stats"]` via `useFinishSession`. |
| — | Set-list order | Add explicit `nullsFirst: false` to `listSetsForSession`'s `order` call | Today relies on Postgres default; pinning it makes the "unchecked drafts at the bottom" rule load-bearing. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `supabase/migrations/0007_set_completed_at_nullable.sql` | new | `ALTER TABLE public.sets ALTER COLUMN completed_at DROP NOT NULL;` plus header comment explaining semantic shift; no backfill (existing rows are non-null already); no RLS impact note. |
| `src/db/schema.ts` | edited | Line 149: drop `.notNull()` on `completedAt`. One responsibility: keep Drizzle source-of-truth synced with the SQL migration. |
| `src/db/types.ts` | edited | `SetRow.completed_at: string` → `string \| null`. Widens the consumer type to match the now-nullable column. |
| `src/api/sets.ts` | edited | (a) `logSet` (line 63): change `completed_at: new Date().toISOString()` → `completed_at: null`. (b) `listSetsForSession`: add `nullsFirst: false` to the `.order` call. (c) Add `checkSet(id)`, `uncheckSet(id)`, `bulkCheckAllInSession(sessionId)`, `bulkSoftDeleteUncheckedInSession(sessionId)` exports. Single responsibility (per call) — each is one PostgREST round-trip. |
| `src/hooks/use-sets.ts` | edited | Add `useCheckSet(sessionId)`, `useUncheckSet(sessionId)`, `useBulkCheckAllInSession(sessionId)`, `useBulkSoftDeleteUncheckedInSession(sessionId)`. Per-row hooks invalidate `["sets", sessionId]` only. Bulk hooks also invalidate `["sets", sessionId]` only (stats already invalidated by `useFinishSession` after the finish call). |
| `src/components/set-input.tsx` | edited | (a) Add `showCheckable?: boolean` prop (default `false`), `onToggleChecked?: () => void` prop. (b) When `showCheckable`, render a leading `<Pressable>` with `Square` (unchecked) or `CheckSquare` (checked) icon, `accessibilityLabel` per state. (c) When the row is checked (`row.completed_at != null`) AND `showCheckable`, apply tint class `bg-blue-50 dark:bg-blue-950/30` on the row's outer `<View>`. (d) `onDelete` icon stays — single responsibility per icon. |
| `src/components/exercise-block.tsx` | edited | Add `showCheckable?: boolean` prop, `onToggleSetChecked?: (setId: string, nextChecked: boolean) => void` prop. Pass both to `<SetInput>` (the inner mapping at lines 161-170). History detail does NOT pass these → defaults to non-toggleable, no tint, no leading icon. |
| `src/components/choose-action-modal.tsx` | new | Cross-platform 3-option modal. Promise-based API similar to `confirmDelete`. Uses React Native `<Modal>` (works on web via React Native Web). See contract below. |
| `app/(app)/workout/[sessionId].tsx` | edited | (a) Add `useCheckSet`, `useUncheckSet`, `useBulkCheckAllInSession`, `useBulkSoftDeleteUncheckedInSession`. (b) Compute `uncheckedCount = (setsQ.data ?? []).filter(s => s.completed_at == null).length`. (c) `onFinish` becomes: if `uncheckedCount === 0`, keep current 2-button confirm; else open `<ChooseActionModal>` with `{checkedCount, uncheckedCount}` and branch on the user's pick (cancel / discard / auto-check). (d) Pass `showCheckable` + `onToggleSetChecked` to each `<ExerciseBlock>`. The `onToggleSetChecked` handler calls `checkSet.mutateAsync(id)` or `uncheckSet.mutateAsync(id)` based on `nextChecked`. |
| `app/(app)/history/[id].tsx` | edited | Line 204: `setsCompletedAt={(setsQ.data ?? []).map((s) => s.completed_at)}` — type widens to `(string \| null)[]`, but `countSetsOutsideRange` already accepts `readonly (string \| null)[]` per Discovery. Otherwise no functional change — `<ExerciseBlock>` calls do NOT add `showCheckable`. |
| `src/lib/query-client.ts` | edited | Line 27: bump `queryCacheBuster` to `"schema-2026-05-21-set-check"`. |
| `tests/e2e/crud.spec.ts` | edited | Lines 162-202 — after Quick start, when the auto-injected first working set lands, tap its check button before tapping Finish. Avoids hitting the 3-option dialog. |
| `tests/e2e/remove-exercise.spec.ts` | edited | Lines 122-171 and 189-217 — tap check on each logged working set before Finish. |
| `tests/e2e/soft-deleted-exercises-in-history.spec.ts` | edited | Lines 150-163 — tap check on the 2 logged sets before Finish. |
| `tests/e2e/exercise-progress-ia.spec.ts` | edited | Line 186 — tap check before Finish. |

(No changes to `src/api/stats.ts`, `src/api/progress.ts`, `src/components/weekly-volume-strip.tsx`, `src/components/active-session-banner.tsx`, `src/api/sessions.ts`, `scripts/import-strong.ts`. All already correct under the nullable-`completed_at` model, per Discovery analysis.)

## Contratos de I/O

### Migration `0007_set_completed_at_nullable.sql`

```sql
-- =============================================================================
-- 0007_set_completed_at_nullable.sql
-- Hand-written. Drops NOT NULL on sets.completed_at so the column can encode
-- per-set "checked" state in the live-workout screen:
--   completed_at IS NULL      → unchecked draft (live session only)
--   completed_at IS NOT NULL  → checked / persisted
--
-- All existing rows have non-null completed_at and remain "checked" — no
-- backfill needed. No RLS policy changes (gate on auth.uid() = user_id).
-- Index sets_exercise_completed_idx remains valid; btree indexes nulls.
-- =============================================================================

alter table public.sets alter column completed_at drop not null;
```

### `src/api/sets.ts`

```ts
// Existing — body change only (completed_at value):
export async function logSet(input: LogSetInput): Promise<SetRow> {
  // ...same set_number computation...
  const { data, error } = await supabase
    .from("sets")
    .insert({
      // ...same fields...
      completed_at: null, // was: new Date().toISOString()
    })
    .select()
    .single();
  // ...
}

// Existing — pin null ordering:
export async function listSetsForSession(sessionId: string): Promise<SetRow[]> {
  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("completed_at", { ascending: true, nullsFirst: false });
  // ...
}

// New:
export async function checkSet(id: string): Promise<SetRow> {
  const { data, error } = await supabase
    .from("sets")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as SetRow;
}

export async function uncheckSet(id: string): Promise<SetRow> {
  const { data, error } = await supabase
    .from("sets")
    .update({ completed_at: null })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as SetRow;
}

// New — bulk check every unchecked set in this session, single round-trip.
export async function bulkCheckAllInSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("sets")
    .update({ completed_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .is("completed_at", null)
    .is("deleted_at", null);
  if (error) throw error;
}

// New — bulk soft-delete every unchecked set in this session AND any
// non-deleted dropset whose parent is one of those unchecked rows.
// Two round-trips on purpose: must read parent ids before cascading.
export async function bulkSoftDeleteUncheckedInSession(
  sessionId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();

  // 1) Collect ids of the unchecked rows we're about to discard.
  const { data: unchecked, error: readErr } = await supabase
    .from("sets")
    .select("id")
    .eq("session_id", sessionId)
    .is("completed_at", null)
    .is("deleted_at", null);
  if (readErr) throw readErr;
  const uncheckedIds = (unchecked ?? []).map((r) => r.id as string);
  if (uncheckedIds.length === 0) return;

  // 2) Soft-delete the unchecked rows themselves.
  const { error: delErr } = await supabase
    .from("sets")
    .update({ deleted_at: nowIso })
    .in("id", uncheckedIds);
  if (delErr) throw delErr;

  // 3) Cascade: soft-delete any non-deleted dropset whose parent we just
  //    discarded (avoids orphan parent_set_id pointing at a soft-deleted row).
  const { error: cascadeErr } = await supabase
    .from("sets")
    .update({ deleted_at: nowIso })
    .in("parent_set_id", uncheckedIds)
    .is("deleted_at", null);
  if (cascadeErr) throw cascadeErr;
}
```

RLS: every `update` matches the JWT user via the existing `auth.uid() = user_id` policy on `sets`. No service role needed. The `.in("id", uncheckedIds)` filter only contains ids we just read under RLS, so any forged id substitution is impossible.

### `src/hooks/use-sets.ts`

```ts
export function useCheckSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => checkSet(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
      // NOT invalidating ["stats"] — in-progress sessions never reach stats queries.
    },
  });
}

export function useUncheckSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => uncheckSet(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
    },
  });
}

export function useBulkCheckAllInSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => bulkCheckAllInSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
    },
  });
}

export function useBulkSoftDeleteUncheckedInSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => bulkSoftDeleteUncheckedInSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
    },
  });
}
```

### `src/components/choose-action-modal.tsx`

```ts
export type ChooseActionButton = {
  /** Display label. */
  label: string;
  /** Returned value when the user picks this button. */
  value: string;
  /** Visual treatment. */
  variant?: "default" | "primary" | "destructive";
};

export type ChooseActionOptions = {
  title: string;
  message?: string;
  buttons: ChooseActionButton[]; // 2 or 3 entries
  cancelValue?: string; // Returned when the user dismisses without picking. Default: "cancel"
};

/**
 * Cross-platform N-option modal. Resolves with the picked button's `value`,
 * or `cancelValue` if the user dismisses (X / backdrop / hardware back).
 *
 * Implementation note: this is a function returning a Promise, like
 * confirmDelete. Internally it mounts a top-level <Modal> via a singleton
 * provider mounted at the root. The first invocation registers; subsequent
 * invocations queue (or reject if one is already open — TBD by Implementer,
 * default: reject the prior with cancelValue).
 */
export function chooseAction(opts: ChooseActionOptions): Promise<string>;
```

Implementation approach (for the Implementer, non-binding sketch):

- Singleton state in module scope (`let openResolver: ((v: string) => void) | null = null; let openOpts: ChooseActionOptions | null = null;`) plus a React subscription primitive (`useSyncExternalStore` or a tiny event emitter).
- Mount `<ChooseActionModalHost />` once at the root layout (`app/_layout.tsx` already exists for global providers).
- `chooseAction(opts)` returns `new Promise((resolve) => { openResolver = resolve; openOpts = opts; notify(); })`.
- `<ChooseActionModalHost />` renders a React Native `<Modal transparent animationType="fade">` with a centered card, the title/message, and the buttons.
- Tapping any button calls `openResolver(value)` and clears state.
- Backdrop / X / hardware back → `openResolver(cancelValue ?? "cancel")`.

This pattern works identically on iOS, Android, and web (React Native Web renders `<Modal>` as a portal-style overlay).

### `src/components/set-input.tsx` — prop additions

```ts
type Props = {
  row: SetRow;
  unit: WeightUnit;
  previousSet?: SetRow | null;
  /** Live-session only. When true, render the check icon and apply tint. */
  showCheckable?: boolean;
  /** Called when the leading check icon is tapped. nextChecked reflects the
   *  state the row will be in after this action completes. */
  onToggleChecked?: (nextChecked: boolean) => void;
  onCommit: (patch: { reps: number | null; weight: string | null; rpe: string | null; notes: string | null }) => void;
  onDelete: () => void;
};
```

The check icon is rendered at the start of the row (before the type badge) when `showCheckable` is true. Layout:

```
[Check] [Badge] [#]  [Weight] [Reps] [RPE]  [Notes] [Trash]
   28w     28w   24w   flex     flex    56w   28w     28w
```

The tint class is applied to the outer `<View>` only when `showCheckable && row.completed_at != null`.

### `src/components/exercise-block.tsx` — prop additions

```ts
type Props = {
  // ...existing props...
  /** Live-session only. Forwarded to <SetInput>. Default: false. */
  showCheckable?: boolean;
  /** Forwarded handler. Required when showCheckable === true. */
  onToggleSetChecked?: (setId: string, nextChecked: boolean) => void;
};
```

History detail (`app/(app)/history/[id].tsx`) does not pass `showCheckable`, so the icon and tint never render there. Visual parity preserved.

### Finish-flow handler in `app/(app)/workout/[sessionId].tsx`

Pseudo-code for the new `onFinish`:

```ts
const checkSetM = useCheckSet(sessionId ?? "");
const uncheckSetM = useUncheckSet(sessionId ?? "");
const bulkCheckAll = useBulkCheckAllInSession(sessionId ?? "");
const bulkDiscardUnchecked = useBulkSoftDeleteUncheckedInSession(sessionId ?? "");

const uncheckedCount = (setsQ.data ?? []).filter((s) => s.completed_at == null).length;

const onFinish = async () => {
  if (!sessionId) return;

  if (uncheckedCount === 0) {
    // Same as today.
    const ok = await confirmDelete({
      title: "Finish workout?",
      message: "You can review it later from History.",
      confirmLabel: "Finish",
      cancelLabel: "Keep going",
    });
    if (!ok) return;
    try {
      await finish.mutateAsync(sessionId);
      router.replace("/(app)/workout");
    } catch (err) {
      console.warn("Finish failed", err);
    }
    return;
  }

  const picked = await chooseAction({
    title: "Some sets are unchecked",
    message: `You have ${uncheckedCount} unchecked set${uncheckedCount === 1 ? "" : "s"}. What should we do with them?`,
    buttons: [
      { label: "Keep editing", value: "cancel", variant: "default" },
      { label: "Finish without saving", value: "discard", variant: "destructive" },
      { label: "Check all and finish", value: "check-all", variant: "primary" },
    ],
    cancelValue: "cancel",
  });

  if (picked === "cancel") return;

  try {
    if (picked === "discard") {
      await bulkDiscardUnchecked.mutateAsync();
    } else if (picked === "check-all") {
      await bulkCheckAll.mutateAsync();
    }
    await finish.mutateAsync(sessionId);
    router.replace("/(app)/workout");
  } catch (err) {
    console.warn("Finish failed", err);
  }
};
```

The `onToggleSetChecked` handler passed to each `<ExerciseBlock>`:

```ts
onToggleSetChecked={async (id, nextChecked) => {
  try {
    if (nextChecked) await checkSetM.mutateAsync(id);
    else await uncheckSetM.mutateAsync(id);
  } catch (err) {
    console.warn("Toggle set check failed", err);
  }
}}
showCheckable
```

## UI spec

### Set row anatomy (live session)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [☐]  [•] 1   [   80 kg   ] [   8 reps  ] [ 8 RPE ]  [💬]  [🗑]      │ ← unchecked, white bg
├──────────────────────────────────────────────────────────────────────┤
│ [☑]  [•] 2   [   80 kg   ] [   8 reps  ] [ 8 RPE ]  [💬]  [🗑]      │ ← checked, bg-blue-50
└──────────────────────────────────────────────────────────────────────┘
```

- **Unchecked icon**: `Square` (lucide-react-native), `color="#9ca3af"` (gray-400), `size={20}`.
- **Checked icon**: `CheckSquare`, `color="#3b82f6"` (blue-500), `size={20}`.
- Tap target: 44×44 minimum (per iPhone shakedown / Apple HIG). Wrap the icon in `<Pressable className="h-11 w-11 items-center justify-center">`.
- `accessibilityLabel`: `"Mark set as completed"` when unchecked, `"Mark set as not completed"` when checked. `accessibilityRole="button"`.
- Tinted row: outer `<View>` gets `bg-blue-50 dark:bg-blue-950/30` appended when `showCheckable && row.completed_at != null`.

### Header row alignment (ExerciseBlock lines 147-159)

The header row in `<ExerciseBlock>` needs a 1-column-wide spacer at the start so the column labels still align with the inputs below:

```
[spacer-check] [spacer-badge] [#] [Weight (kg)] [Reps] [RPE] [spacer-notes] [spacer-trash]
       28w           28w        24w     flex       flex   56w       28w           28w
```

In history detail, the leading spacer is zero-width (no check column). Implementer: gate the header spacer width on the same `showCheckable` prop.

### 3-option dialog

```
╭───────────────────────────────────────────╮
│                                           │
│        Some sets are unchecked            │
│                                           │
│  You have 3 unchecked sets. What should   │
│       we do with them?                    │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │           Keep editing              │  │
│  └─────────────────────────────────────┘  │
│  ┌─────────────────────────────────────┐  │
│  │     Finish without saving           │  │  ← red text
│  └─────────────────────────────────────┘  │
│  ┌─────────────────────────────────────┐  │
│  │      Check all and finish           │  │  ← blue bg, white text
│  └─────────────────────────────────────┘  │
│                                           │
╰───────────────────────────────────────────╯
```

Centered card on a semi-transparent backdrop (`bg-black/40`). Card: `bg-white dark:bg-gray-900`, rounded, max-width on web (`max-w-sm`). Buttons stack vertically full-width.

### Render-branch pseudo-code (where check icon shows)

In `<SetInput>`:

```tsx
return (
  <View
    className={`border-b border-gray-100 dark:border-gray-900 ${
      showCheckable && row.completed_at != null
        ? "bg-blue-50 dark:bg-blue-950/30"
        : ""
    }`}
  >
    <View className="flex-row items-center gap-2 px-4 py-2">
      {showCheckable ? (
        <Pressable
          onPress={() => onToggleChecked?.(row.completed_at == null)}
          accessibilityRole="button"
          accessibilityLabel={
            row.completed_at == null
              ? "Mark set as completed"
              : "Mark set as not completed"
          }
          className="h-11 w-11 items-center justify-center"
        >
          {row.completed_at == null ? (
            <Square color="#9ca3af" size={20} />
          ) : (
            <CheckSquare color="#3b82f6" size={20} />
          )}
        </Pressable>
      ) : null}
      {/* ...existing badge / # / inputs / icons unchanged... */}
    </View>
    {/* ...notes row unchanged... */}
  </View>
);
```

## Riscos

- **Data integrity — nullable `completed_at`**: any code reading `set.completed_at` and assuming `string` (non-null) now needs to handle `null`. Discovery audited all callers (`stats.ts`, `progress.ts`, `weekly-volume-strip.tsx`, `session-times-form.ts`, `getLastWorkingSetForExercise`, `history/[id].tsx`) and all are safe — `.gte(...)` filters drop nulls, `.not("sessions.ended_at", "is", null)` excludes in-progress sessions, and `session-times-form.ts:112-132` already declares `readonly (string | null)[]`. The TypeScript type widening in `db/types.ts` will surface any caller we missed at compile time. **Mitigation**: rely on `tsc` to catch.
- **Data integrity — orphaned dropset parent_set_id**: discarding an unchecked working set without cascading would leave dropset children with a `parent_set_id` pointing at a soft-deleted row. The CHECK constraint still holds (`parent_set_id IS NOT NULL`), but the chain semantics break. **Mitigation**: explicit cascade step (3) in `bulkSoftDeleteUncheckedInSession`.
- **Data integrity — RLS for the cascade**: the `.in("parent_set_id", uncheckedIds)` filter runs as the authed user. A malicious client could not pass arbitrary ids because the ids come from step 1 of the same call (also RLS-filtered). **Verdict**: safe.
- **UX regression — shared `<ExerciseBlock>` in history**: history detail passes neither `showCheckable` nor `onToggleSetChecked`. Default `showCheckable = false` means no check icon, no tint, no behavior change. **Mitigation**: prop default + explicit non-pass in history detail. Tester should verify history detail looks identical to before.
- **UX regression — header alignment**: adding a leading check column to set rows means the existing column-header row (`exercise-block.tsx:147-159`) must add a matching leading spacer when `showCheckable`. If not gated, history loses alignment. **Mitigation**: gate spacer width on the same `showCheckable`.
- **UX regression — e2e tests**: 4 specs currently tap Finish without checking sets; they'll hit the new dialog. Updating them to "check then Finish" is the better long-term pattern (represents real user behavior). **Mitigation**: spec edits listed under file changes.
- **Platform divergence — 3-option dialog**: `Alert.alert` supports 3 buttons natively but is iOS-styled; `window.confirm` is binary. We sidestep both by using React Native `<Modal>`, which is identical across iOS, Android, and web (via React Native Web). **Mitigation**: hand-rolled component, tested on all three.
- **Platform divergence — Pressable hitbox on web**: web requires explicit `h-11 w-11` for tap target (web doesn't have iOS's `hitSlop` auto-expand). **Mitigation**: explicit size class.
- **Performance — cascade adds a round-trip**: `bulkSoftDeleteUncheckedInSession` is 3 PostgREST calls (read ids → soft-delete unchecked → soft-delete dropset children). Typical session: 50 sets, ~5-10 unchecked. Sub-200ms total. **Verdict**: acceptable for an end-of-workout action.
- **Performance — every check tap is a network round-trip**: no optimistic update (no precedent in codebase). User may tap 30-50 checks per session. On weak networks, the icon feels laggy. **Mitigation**: deferred (out-of-scope for v1). Acceptable for v1 given session-internal staleTime + Supabase typical latency.
- **Cache buster bump**: forces one refetch for all users on next app open. Cost: one extra `listSetsForSession` round-trip per session-detail screen view. **Mitigation**: standard cost per Decision 9.
- **Strong importer**: `scripts/import-strong.ts:543` sets `completed_at: startedAt` for every imported set → all imported sets remain "checked". No change needed. **Verdict**: safe.
- **Active-session resume**: persistence is automatic (state is in DB column). User closes app mid-workout with unchecked drafts → reopens → unchecked drafts still present. **Mitigation**: explicit test in Tester's plan.

## Alternativas descartadas

1. **(b) New `checked_at` column alongside `completed_at`** — cleaner semantics (logged vs verified are distinct concepts). Descartada porque it doubles the columns we read everywhere, requires a backfill UPDATE for all existing rows, and every stats/progress query becomes a question of "which timestamp do you mean?". The marginal semantic clarity isn't worth the broader audit. `completed_at` semantics today is already "I just performed this set" — drifting it to "I just confirmed this set" is a hair's width.
2. **Boolean `checked` column with `confirmed_at` removed entirely** — would require a backfill (`checked = true` for existing rows) and still leaves `completed_at` ambiguous. Descartada porque it's the worst of both worlds: a new column AND the old one still around.
3. **3-button dialog via two sequential `confirmDelete` prompts on web** — descartada porque sequential modal stacks are confusing UX (the user can answer the wrong question first) and Tester would need to track 4 dialog states per spec.
4. **3-button dialog via `Alert.alert` on native + `confirmDelete` collapsing to 2 buttons on web** — descartada porque the on-web experience would only offer "discard" + "cancel" (the third option dropped), which is a silent UX divergence the user can't see across platforms. Either both have 3 or neither does.
5. **Auto-check the set on input commit (blur)** — Strong-deviation, removes one tap. Descartada per Discovery #5: filling and confirming are distinct moments; the user may backfill numbers from memory and not have actually done the set yet.
6. **Check button on the right of the row, full-row-height like Strong** — strong visual statement. Descartada because the right side is already crowded (notes + trash) and shrinking those icons hurts the existing-flow tap targets. Left placement is a cleaner integration; tint reinforces "done" visually without needing the icon to be huge.
7. **Skip the cascade — orphaned dropset parent_set_id is "no immediate user-visible bug"** — descartada because the data is semantically inconsistent and a future feature reading the chain (e.g. "show me the working set this dropset stacked onto") will silently break. Cascade is one extra PostgREST call.
8. **Optimistic check toggle via `onMutate`** — snappier UX. Descartada for v1 because there's no precedent in the codebase, adds complexity to four new hooks, and the felt-latency cost on Supabase typical-network is small. Re-evaluate if users complain.

## Out of scope

- Auto-advance to the next set on check.
- Per-exercise checked-set counter in the `<ExerciseBlock>` header.
- Rest timer triggered on check (currently triggered on add).
- Reordering sets based on check state.
- Locking the input fields of a checked set.
- Showing "N of M checked" in the active-session banner.
- Optimistic UI for check toggle.
- Renaming `completed_at` → `checked_at` in a future migration.
- A "Skip set" concept semantically distinct from "uncheck".

## Open questions for Validator

1. **Set ordering with nullsFirst pinned**: confirm `nullsFirst: false` semantics in PostgREST translate to `ORDER BY completed_at ASC NULLS LAST`. Discovery flagged this as relied-on-default; we're making it explicit. Verify the syntax in PostgREST docs.
2. **`chooseAction` singleton mount location**: the design assumes `<ChooseActionModalHost />` mounts at `app/_layout.tsx`. Validator should confirm that's the right root (and not, e.g., `app/(app)/_layout.tsx` which only covers authed screens — but the dialog is currently only invoked from authed screens, so either works).
3. **Cascade-discard scope**: should the cascade also apply when a single unchecked working set is deleted via per-row delete (`useDeleteSet`), or only on the bulk-discard path at Finish? Current design: only the bulk-discard path. Per-row delete keeps today's behavior (the user explicitly chose to delete one row; if it had checked dropset children, that's a pre-existing edge case unchanged by this run). Confirm acceptable.
4. **`logSet`-then-immediately-`onCommit` race**: today the user adds a set (`logSet` returns row with `completed_at = now()`), then types weight/reps (`updateSet` patches reps/weight/rpe/notes). After this run, the inserted row has `completed_at = null` and the same patch happens. The patch shape doesn't touch `completed_at`, so the row stays unchecked — desired. Confirm no implicit "log set → check it" coupling exists anywhere.

## Status

`done`
