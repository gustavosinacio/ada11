# Design v2 — 2026-05-21_1308_set-check-button

## Goal (1 sentence)

Add a per-set check button to the live workout screen that gates which sets are persisted on Finish (unchecked sets are either discarded or auto-checked via a 3-option dialog), implemented by repurposing `sets.completed_at` as a nullable "checked-at" flag and shipping a new cross-platform 3-option modal, with deterministic intra-session ordering and accessibility-label-driven e2e selectors.

## Approach

The state must survive app reloads, so it lives on the row. We pick **option (a) — repurpose `completed_at`**: drop `NOT NULL`, treat `completed_at IS NULL` as "unchecked draft" and any timestamp as "checked at that moment". `logSet` flips from `completed_at = now()` to `completed_at = null` (newly added sets are unchecked by default, matching Strong). All existing rows already have non-null timestamps, so no backfill is needed; only one `ALTER COLUMN ... DROP NOT NULL` statement is required.

Two per-row helpers (`checkSet`/`uncheckSet`) and two session-scope helpers (`bulkCheckAllInSession`/`bulkSoftDeleteUncheckedInSession`) cover the new flows. `bulkSoftDeleteUncheckedInSession` cascades soft-delete to **unchecked** dropset children only — checked children that the user explicitly opted in to keeping survive (their `parent_set_id` then references a soft-deleted row, which is the same pre-existing data-integrity nit that already exists for per-row delete via `useDeleteSet`, hidden by `deleted_at IS NULL` read filters).

`bulkCheckAllInSession` writes a single `now()` timestamp to every previously-unchecked row in one round-trip. To prevent the resulting intra-session timestamp tie from reshuffling render order, both list queries (`listSetsForSession`, `listSetsForExercise`) gain `set_number` as a secondary sort key. Same `completed_at`, fall back to `set_number` (which is unique per `(session_id, exercise_id)` and chronologically ordered by the existing `set_number` computation in `logSet`).

The Finish handler grows into a 3-option flow rendered through a new `<ChooseActionModal>` (real React Native `<Modal>` cross-platform, since `window.confirm` is binary). Button order follows iOS HIG vertical-stack convention: primary at top, destructive in the middle, cancel at the bottom. `<ExerciseBlock>` and `<SetInput>` gain a `showCheckable` prop so history detail (read-only sessions) stays visually unchanged.

All new interactive elements (check icon, modal buttons) carry stable `accessibilityLabel`s that double as Playwright `getByLabel` selectors. e2e specs tap the new check button before Finish to keep the happy-path test pattern simple while still exercising the real user behavior.

Cache buster bumps to `schema-2026-05-21-set-check`.

## Resposta a issues do Validator

| Issue | Resolution |
|---|---|
| **MAJ-1** — e2e selectors + test-id strategy | Pinned `accessibilityLabel` for check icon: **`"Mark set as completed"`** (unchecked) and **`"Unmark set as completed"`** (checked). Single label pair, no state-announcement reliance. Modal buttons: `"Cancel"`, `"Finish without saving unchecked"`, `"Check all and finish"`. e2e specs updated to `page.getByLabel("Mark set as completed")` before Finish. See §UI spec → Accessibility labels and §Mudanças por arquivo for the four spec edits. |
| **MAJ-2** — cascade-discard semantics | Picked **(a)**: cascade filters to **unchecked-only** children via `.is("completed_at", null)`. Checked dropset children of an unchecked parent survive Finish-discard; their `parent_set_id` points at a soft-deleted row, which is invisible to all read paths (every list filters `deleted_at IS NULL`). Documented in §Riscos as a known data-integrity nit consistent with the pre-existing `useDeleteSet` orphan behavior. Contract updated in `bulkSoftDeleteUncheckedInSession`. |
| **MAJ-3** — `bulkCheckAllInSession` timestamp tie-breaker | Picked **(b)**: added `set_number` as secondary `.order(...)` key on the two read queries (`src/api/sets.ts:28` `listSetsForSession`, `src/api/progress.ts:17` `listSetsForExercise`). `bulkCheckAllInSession` keeps the single-`now()`-per-batch shape (one round-trip, simplest). Two new EDIT rows added to §Mudanças por arquivo. |
| **MIN-1** — dialog button order | iOS HIG vertical stack: **"Check all and finish" (primary) on top, "Finish without saving unchecked" (destructive) in middle, "Cancel" at bottom**. Rationale: primary action highest visual weight at thumb-natural top position; destructive in the middle with red label clarifies it's NOT the default; Cancel last lets a fat-fingered tap on the bottom escape. Matches Apple's `UIAlertController` vertical-stack convention. |
| **MIN-2** — header spacer width | Spacer is **`w-11` (44pt)** to match the check button's `h-11 w-11` tap target, not `w-7`. UI spec updated. |
| **MIN-3** — irreversibility warning | Modal body adds one-line warning: **"Unchecked sets won't be saved. This can't be undone."** Rendered as subtitle under the title. |
| **MIN-4** — confirm finish-flow invalidations | Verified `src/hooks/use-sessions.ts:54-66`: `useFinishSession.onSuccess` invalidates `["stats"]` (line 62) and `["progress"]` (line 63) — both wired by F5 and unchanged since F8 added `useUpdateSessionTimes` (also lines 108-109) with the same pair. The new per-row and bulk hooks therefore safely skip `["stats"]`/`["progress"]` invalidation; the finish-flow always runs after them and covers both keys. Cited explicitly in §Contratos. |

## Decisions on unknowns (Discovery → this design)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Data model | **(a)** Repurpose `completed_at`, drop `NOT NULL` | Cheapest, no backfill, semantics already align (`logSet` set `completed_at = now()` meaning "I just did this set"). The shift to "after I tap check" is < a minute in practice. List order pinned with `nullsFirst: false` + `set_number` secondary. |
| 2 | Check icon position | **Left** of each set row, before the type badge | Strong-like priority: status-before-content. Lets the type badge + #set# label and the input cluster stay untouched (no row repacking). |
| 3 | Visual state | Unchecked = outlined `Square` (gray); Checked = filled `CheckSquare` (primary blue); checked row gets `bg-blue-50 dark:bg-blue-950/30` tint | Calm contrast; tint adds instant visual scan. Inputs stay editable when checked (the user may correct a number after checking). |
| 4 | Auto-advance on check | **No** | Out of scope per prompt. |
| 5 | Auto-check on input commit | **No** | Filling and confirming are decoupled. Editing weight/reps does not flip the state in either direction. |
| 6 | Default state of new set | **Unchecked** | This is the point of the feature. |
| 7 | Removing exercise w/ mixed sets | No change | `bulkSoftDeleteSetsForExerciseInSession` already discards both checked and unchecked (filters on `deleted_at IS NULL` only). Correct behavior. |
| 8 | "Finish without saving" flow | Order: `bulkSoftDeleteUncheckedInSession(sid)` → invalidate `["sets", sid]` (via the hook's onSuccess) → `finish.mutateAsync(sid)`. If bulk-delete fails, do not finish; surface error. | Atomicity: no finished session ever contains rows with `completed_at IS NULL`. |
| 9 | "Auto-check all" flow | Order: `bulkCheckAllInSession(sid)` → invalidate `["sets", sid]` → `finish.mutateAsync(sid)`. Same failure semantics. | Same invariant. |
| 10 | 3-button dialog | New `<ChooseActionModal>` component using React Native `<Modal>` (works on web + native). 3 buttons in HIG vertical-stack order: Check-all-and-finish (primary) / Finish-without-saving (destructive) / Cancel. | `window.confirm` is binary; sequential confirms is bad UX. Reusable for future N-way dialogs. |
| 11 | Cache buster | Bump `src/lib/query-client.ts:27` from `"schema-2026-05-19-muscles"` to `"schema-2026-05-21-set-check"` | Persisted caches from before this run carry `completed_at: string` (non-null). New cache rows may include `null`. Force one refetch. |
| 12 | Dropset orphan edge | `bulkSoftDeleteUncheckedInSession` cascades to **unchecked** children only (per MAJ-2). Checked children survive even when their parent is discarded. | Preserves user's explicit opt-in to keep the checked child; orphaned `parent_set_id` is invisible behind `deleted_at IS NULL` read filters, matches pre-existing `useDeleteSet` behavior. |
| 13 | Resume-after-reload | Free (state is in DB) | Verified by Discovery; flag in test plan only. |
| — | Cache invalidation on check/uncheck | Invalidate `["sets", sessionId]` only — **NOT** `["stats"]`/`["progress"]` | Verified `useFinishSession.onSuccess` invalidates `["stats"]` + `["progress"]` (`use-sessions.ts:62-63`). Per-row toggles never affect those keys mid-session (queries filter `sessions.ended_at IS NOT NULL`). |
| — | Set-list order | Add explicit `nullsFirst: false` AND `set_number ASC` secondary key to `listSetsForSession` and `listSetsForExercise` | Pins null ordering; secondary key resolves intra-session timestamp ties from `bulkCheckAllInSession`. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `supabase/migrations/0007_set_completed_at_nullable.sql` | new | `ALTER TABLE public.sets ALTER COLUMN completed_at DROP NOT NULL;` plus header comment explaining semantic shift; no backfill (existing rows are non-null already); no RLS impact note. |
| `src/db/schema.ts` | edited | Line 149: drop `.notNull()` on `completedAt`. One responsibility: keep Drizzle source-of-truth synced with the SQL migration. |
| `src/db/types.ts` | edited | `SetRow.completed_at: string` → `string \| null`. Widens the consumer type to match the now-nullable column. |
| `src/api/sets.ts` | edited (logSet) | Line 63: change `completed_at: new Date().toISOString()` → `completed_at: null`. Single-responsibility change to insert payload. |
| `src/api/sets.ts` | edited (listSetsForSession) | Line 28: change `.order("completed_at", { ascending: true })` to `.order("completed_at", { ascending: true, nullsFirst: false }).order("set_number", { ascending: true })`. Pins null ordering + adds secondary key to break ties from bulk-check. |
| `src/api/sets.ts` | edited (new exports) | Add `checkSet(id)`, `uncheckSet(id)`, `bulkCheckAllInSession(sessionId)`, `bulkSoftDeleteUncheckedInSession(sessionId)`. Each is one (or few) PostgREST round-trip. |
| `src/api/progress.ts` | edited (listSetsForExercise) | Line 17: change `.order("completed_at", { ascending: true })` to `.order("completed_at", { ascending: true }).order("set_number", { ascending: true })`. Pure read-side change to break intra-session timestamp ties on the progress chart. |
| `src/hooks/use-sets.ts` | edited | Add `useCheckSet(sessionId)`, `useUncheckSet(sessionId)`, `useBulkCheckAllInSession(sessionId)`, `useBulkSoftDeleteUncheckedInSession(sessionId)`. All four invalidate `["sets", sessionId]` only. (Finish-flow invalidates `["stats"]` + `["progress"]` via `useFinishSession`; see `use-sessions.ts:62-63`.) |
| `src/components/set-input.tsx` | edited | (a) Add `showCheckable?: boolean` (default `false`) and `onToggleChecked?: (nextChecked: boolean) => void` props. (b) When `showCheckable`, render a leading `<Pressable>` (h-11 w-11) with `Square` (unchecked) or `CheckSquare` (checked) icon, `accessibilityLabel` `"Mark set as completed"` (unchecked) or `"Unmark set as completed"` (checked). (c) When `showCheckable && row.completed_at != null`, append tint class `bg-blue-50 dark:bg-blue-950/30` on the row outer `<View>`. (d) Existing `Trash2` + notes-toggle stay — single responsibility per icon. |
| `src/components/exercise-block.tsx` | edited | (a) Add `showCheckable?: boolean` and `onToggleSetChecked?: (setId: string, nextChecked: boolean) => void` props. (b) Forward both to `<SetInput>` (inner mapping at lines 161-170). (c) Header row (lines 147-159) gates a leading `w-11` spacer on `showCheckable`. History detail does NOT pass these → defaults to non-toggleable, no tint, no leading icon, no header spacer. |
| `src/components/choose-action-modal.tsx` | new | Cross-platform N-option modal. Promise-based `chooseAction(opts)` API similar to `confirmDelete`. Uses React Native `<Modal>` (works on web via React Native Web). See contract below. |
| `app/_layout.tsx` | edited | Mount `<ChooseActionModalHost />` once at the root layout so any screen can call `chooseAction()` and get a single overlay. One-line add inside the existing provider tree. |
| `app/(app)/workout/[sessionId].tsx` | edited | (a) Wire `useCheckSet`, `useUncheckSet`, `useBulkCheckAllInSession`, `useBulkSoftDeleteUncheckedInSession`. (b) Compute `uncheckedCount = (setsQ.data ?? []).filter(s => s.completed_at == null).length`. (c) `onFinish` becomes: if `uncheckedCount === 0`, keep the current 2-button `confirmDelete`; else open `<ChooseActionModal>` via `chooseAction({title, message, buttons})` and branch on the picked value (`"cancel"` / `"discard"` / `"check-all"`). (d) Pass `showCheckable` + `onToggleSetChecked` to each `<ExerciseBlock>`. The `onToggleSetChecked` handler calls `checkSet.mutateAsync(id)` or `uncheckSet.mutateAsync(id)` based on `nextChecked`. |
| `app/(app)/history/[id].tsx` | edited | Line 204: `setsCompletedAt={(setsQ.data ?? []).map((s) => s.completed_at)}` — type widens to `(string \| null)[]`, but `countSetsOutsideRange` already accepts `readonly (string \| null)[]` per Discovery. `<ExerciseBlock>` calls do NOT add `showCheckable` → no functional change to history rendering. |
| `src/lib/query-client.ts` | edited | Line 27: bump `queryCacheBuster` to `"schema-2026-05-21-set-check"`. |
| `tests/e2e/crud.spec.ts` | edited | Lines 162-202 — after Quick start logs the first working set, call `await page.getByLabel("Mark set as completed").first().click();` before tapping Finish. Avoids hitting the 3-option dialog in the happy-path round-trip test. |
| `tests/e2e/remove-exercise.spec.ts` | edited | Lines 122-171 and 189-217 — same pattern: tap every `getByLabel("Mark set as completed")` before Finish. |
| `tests/e2e/soft-deleted-exercises-in-history.spec.ts` | edited | Lines 150-163 — tap the 2 check buttons (`page.getByLabel("Mark set as completed").nth(0).click()`, `.nth(1).click()`) before Finish. |
| `tests/e2e/exercise-progress-ia.spec.ts` | edited | Line 186 — tap `page.getByLabel("Mark set as completed").first().click()` before Finish. |

(No changes to `src/api/stats.ts`, `src/components/weekly-volume-strip.tsx`, `src/components/active-session-banner.tsx`, `src/api/sessions.ts`, `src/hooks/use-sessions.ts`, `scripts/import-strong.ts`. All already correct under the nullable-`completed_at` model.)

## Contratos de I/O

### Migration `supabase/migrations/0007_set_completed_at_nullable.sql`

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

// Existing — pin null ordering AND add set_number secondary key:
export async function listSetsForSession(sessionId: string): Promise<SetRow[]> {
  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("completed_at", { ascending: true, nullsFirst: false })
    .order("set_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SetRow[];
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
// All affected rows share the same now() timestamp; intra-session ordering is
// resolved by the secondary set_number sort in listSetsForSession /
// listSetsForExercise.
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
// UNCHECKED dropset whose parent is one of those rows.
//
// Cascade semantics (MAJ-2): we only cascade to unchecked children. Checked
// dropset children of an unchecked parent SURVIVE — the user explicitly opted
// to keep them. Their parent_set_id then references a soft-deleted row, which
// is invisible to every read path (all lists filter deleted_at IS NULL). This
// is the same pre-existing data-integrity nit that already exists for per-row
// useDeleteSet of a parent with checked children.
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

  // 3) Cascade ONLY to unchecked dropset children of those rows. Checked
  //    children are preserved (see comment block above).
  const { error: cascadeErr } = await supabase
    .from("sets")
    .update({ deleted_at: nowIso })
    .in("parent_set_id", uncheckedIds)
    .is("completed_at", null)
    .is("deleted_at", null);
  if (cascadeErr) throw cascadeErr;
}
```

RLS: every `update` matches the JWT user via the existing `auth.uid() = user_id` policy on `sets`. No service role needed. The `.in("id", uncheckedIds)` filter only contains ids we just read under RLS, so any forged id substitution is impossible.

### `src/api/progress.ts`

```ts
// Existing — add set_number secondary sort to break bulk-check timestamp ties:
export async function listSetsForExercise(exerciseId: string): Promise<...> {
  // ...same filters...
  .order("completed_at", { ascending: true })
  .order("set_number", { ascending: true });
  // ...
}
```

### `src/hooks/use-sets.ts`

```ts
export function useCheckSet(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => checkSet(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forSession(sessionId) });
      // ["stats"] / ["progress"] not invalidated — only finished sessions
      // reach those queries; useFinishSession.onSuccess (use-sessions.ts:62-63)
      // invalidates both keys at finish-time.
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
  /** Display label. Also used as accessibilityLabel verbatim. */
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
 * or `cancelValue` if the user dismisses (backdrop / hardware back).
 *
 * Implementation note: this is a function returning a Promise, like
 * confirmDelete. Internally it mounts a top-level <Modal> via a singleton
 * provider mounted at app/_layout.tsx.
 */
export function chooseAction(opts: ChooseActionOptions): Promise<string>;
```

Implementation approach (for the Implementer, non-binding sketch):

- Singleton state in module scope (`let openResolver: ((v: string) => void) | null = null; let openOpts: ChooseActionOptions | null = null;`) plus a tiny event-emitter subscription primitive (`useSyncExternalStore`).
- Mount `<ChooseActionModalHost />` once at the root layout (`app/_layout.tsx`) so the overlay is available from any authed or unauthed screen.
- `chooseAction(opts)` returns `new Promise((resolve) => { openResolver = resolve; openOpts = opts; notify(); })`.
- `<ChooseActionModalHost />` renders a React Native `<Modal transparent animationType="fade">` with a centered card, the title/message, and the buttons.
- Each button is a `<Pressable accessibilityRole="button" accessibilityLabel={btn.label}>` — the label IS the selector. Tapping calls `openResolver(value)` and clears state.
- Backdrop tap / hardware back → `openResolver(cancelValue ?? "cancel")`.

This pattern works identically on iOS, Android, and web (React Native Web renders `<Modal>` as a portal-style overlay; precedent: `src/components/exercise-picker.tsx:42`).

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

History detail (`app/(app)/history/[id].tsx`) does not pass `showCheckable`, so the icon, tint, and header spacer never render there. Visual parity preserved.

### Finish-flow handler in `app/(app)/workout/[sessionId].tsx`

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
    message: `You have ${uncheckedCount} unchecked set${uncheckedCount === 1 ? "" : "s"}. Unchecked sets won't be saved. This can't be undone.`,
    buttons: [
      // iOS HIG vertical stack: primary on top, destructive middle, cancel bottom.
      { label: "Check all and finish", value: "check-all", variant: "primary" },
      { label: "Finish without saving unchecked", value: "discard", variant: "destructive" },
      { label: "Cancel", value: "cancel", variant: "default" },
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

```tsx
<ExerciseBlock
  // ...existing props...
  showCheckable
  onToggleSetChecked={async (id, nextChecked) => {
    try {
      if (nextChecked) await checkSetM.mutateAsync(id);
      else await uncheckSetM.mutateAsync(id);
    } catch (err) {
      console.warn("Toggle set check failed", err);
    }
  }}
/>
```

## UI spec

### Accessibility labels (load-bearing — e2e selectors)

| Element | accessibilityLabel | Notes |
|---|---|---|
| Check icon, unchecked state | `"Mark set as completed"` | Used by `page.getByLabel("Mark set as completed")` in 4 e2e specs. |
| Check icon, checked state | `"Unmark set as completed"` | Single label-pair; we do NOT keep one label and rely on a state announcement (rejected per MAJ-1 prompt: pick one strategy). |
| Modal button — primary | `"Check all and finish"` | Label IS the selector. |
| Modal button — destructive | `"Finish without saving unchecked"` | Label IS the selector. |
| Modal button — cancel | `"Cancel"` | Label IS the selector. |

All `<Pressable>` elements above carry `accessibilityRole="button"`.

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
- Tap target: 44×44 (per iPhone shakedown / Apple HIG). Wrap the icon in `<Pressable className="h-11 w-11 items-center justify-center">`.
- Tinted row: outer `<View>` gets `bg-blue-50 dark:bg-blue-950/30` appended when `showCheckable && row.completed_at != null`.

### Header row alignment (`exercise-block.tsx:147-159`)

When `showCheckable` is true, the header row gains a leading **`w-11`** (44pt) spacer to match the check button's tap-target width. In history detail (`showCheckable` not passed), the spacer is absent — header column labels stay where they are today.

```
[spacer-check] [spacer-badge] [#] [Weight (kg)] [Reps] [RPE] [spacer-notes] [spacer-trash]
     w-11           28w        24w    flex        flex   56w       28w           28w
```

### 3-option dialog

```
╭───────────────────────────────────────────╮
│                                           │
│        Some sets are unchecked            │
│                                           │
│  You have 3 unchecked sets. Unchecked     │
│  sets won't be saved. This can't be       │
│  undone.                                  │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │      Check all and finish           │  │  ← primary (blue bg, white text)
│  └─────────────────────────────────────┘  │
│  ┌─────────────────────────────────────┐  │
│  │  Finish without saving unchecked    │  │  ← destructive (red text)
│  └─────────────────────────────────────┘  │
│  ┌─────────────────────────────────────┐  │
│  │              Cancel                 │  │  ← default
│  └─────────────────────────────────────┘  │
│                                           │
╰───────────────────────────────────────────╯
```

- Centered card on a semi-transparent backdrop (`bg-black/40`).
- Card: `bg-white dark:bg-gray-900`, rounded, max-width on web (`max-w-sm`).
- Buttons stack vertically full-width, gap-y between buttons.
- Title (semibold, ~16px). Subtitle (regular, ~14px, gray) carries the MIN-3 warning verbatim.
- Button vertical order: Primary → Destructive → Cancel (iOS HIG / Apple HIG vertical-stack convention; users expect the most-impactful action highest, and Cancel at the bottom is escape-friendly for thumb-reach).

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
              : "Unmark set as completed"
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

- **Data integrity — nullable `completed_at`**: any code reading `set.completed_at` and assuming `string` (non-null) now needs to handle `null`. Discovery audited all callers and all are safe — `.gte(...)` filters drop nulls, `.not("sessions.ended_at", "is", null)` excludes in-progress sessions, and `session-times-form.ts:121` already declares `readonly (string | null)[]`. The TypeScript type widening in `db/types.ts` will surface any caller we missed at compile time. **Mitigation**: rely on `tsc`.
- **Data integrity — orphaned `parent_set_id` for checked dropset children**: under MAJ-2 resolution (a), discarding an unchecked working set with a checked dropset child leaves the dropset's `parent_set_id` pointing at a soft-deleted row. The CHECK constraint (`parent_set_id IS NOT NULL` when `set_type = 'dropset'`) still holds. The orphan is invisible to all read paths (every list filters `deleted_at IS NULL`). **Verdict**: known nit, consistent with pre-existing `useDeleteSet` orphan behavior (user can already trigger this by per-row deleting a parent with checked children today). Accepted in v1; documented for future "rebuild chain" feature.
- **Data integrity — RLS for the bulk operations**: all `.update().eq(session_id, X)` calls run as the authed user. The `.in("parent_set_id", uncheckedIds)` cascade filter only contains ids we just read under RLS in step 1; no privilege escalation possible. **Verdict**: safe.
- **Data integrity — intra-session order after bulk-check**: addressed by MAJ-3 fix. `bulkCheckAllInSession` writes a single `now()` timestamp; the secondary `set_number` sort key in both `listSetsForSession` and `listSetsForExercise` resolves ties deterministically. `set_number` is unique per `(session_id, exercise_id)` (Discovery confirmed via `logSet`'s set_number computation). **Verdict**: deterministic order.
- **UX regression — shared `<ExerciseBlock>` in history**: history detail passes neither `showCheckable` nor `onToggleSetChecked`. Default `showCheckable = false` means no check icon, no tint, no header spacer, no behavior change. **Mitigation**: prop default + explicit non-pass in history detail. Tester verifies history detail looks identical to before.
- **UX regression — header alignment**: leading column added only when `showCheckable`. Gated correctly; history loses no alignment. **Mitigation**: same prop gate on the header spacer.
- **UX regression — e2e tests**: 4 specs currently tap Finish without checking sets; they'll hit the new dialog. Updated each to tap `getByLabel("Mark set as completed")` before Finish (the better long-term pattern — represents real user behavior). **Mitigation**: spec edits listed under file changes.
- **UX regression — destructive button accidental tap**: "Finish without saving unchecked" is positioned in the middle of the vertical stack with red label. Mitigated by MIN-3 subtitle warning ("This can't be undone.") and the explicit "without saving" wording. Cancel at the bottom is one-thumb-tap reachable on iPhone.
- **Platform divergence — 3-option dialog**: `Alert.alert` supports 3 buttons natively but is iOS-styled; `window.confirm` is binary. We sidestep both by using React Native `<Modal>`, which renders identically across iOS, Android, and web (RN Web). **Mitigation**: hand-rolled component, precedent `exercise-picker.tsx:42`.
- **Platform divergence — Pressable hitbox on web**: web requires explicit `h-11 w-11` for tap target (web doesn't auto-expand hitSlop). **Mitigation**: explicit size class on every new `<Pressable>`.
- **Platform divergence — Playwright `dialog` listener vs Modal**: pre-feature, e2e specs `page.on("dialog", ...)` for `window.confirm`. The new `<ChooseActionModal>` is a React Native `<Modal>` — Playwright will NOT fire a dialog event for it. Specs that need to exercise the modal use `page.getByLabel("Check all and finish")` etc., not `dialog.accept()`. **Mitigation**: happy-path specs (the 4 listed) tap the check button before Finish to avoid the modal entirely; any future spec that exercises the modal uses the label selectors.
- **Performance — cascade adds round-trips**: `bulkSoftDeleteUncheckedInSession` is 3 PostgREST calls. Typical session: ~5-10 unchecked sets. Sub-200ms total. **Verdict**: acceptable for an end-of-workout action.
- **Performance — every check tap is a network round-trip**: no optimistic update (no precedent in codebase). On weak networks, the icon feels laggy. **Mitigation**: deferred (out-of-scope for v1). Acceptable given staleTime + Supabase typical latency.
- **Performance — `set_number` secondary sort cost**: btree on `(exercise_id, completed_at)` exists; no `(session_id, completed_at, set_number)` index. The secondary sort happens in-memory after the filter narrows by `session_id`/`exercise_id` (small N, < 100 rows). **Verdict**: negligible.
- **Cache buster bump**: forces one refetch for all users on next app open. Cost: one extra `listSetsForSession` round-trip per session-detail screen view. **Mitigation**: standard cost per Decision 9.
- **Strong importer**: `scripts/import-strong.ts:543` sets `completed_at: startedAt` for every imported set → all imported sets remain "checked". No change needed. **Verdict**: safe.
- **Active-session resume**: persistence is automatic (state is in DB column). User closes app mid-workout with unchecked drafts → reopens → unchecked drafts still present. **Mitigation**: explicit test in Tester's plan.

## Alternativas descartadas

1. **(b) New `checked_at` column alongside `completed_at`** — cleaner semantics (logged vs verified are distinct concepts). Descartada porque it doubles the columns we read everywhere, requires a backfill UPDATE for all existing rows, and every stats/progress query becomes a question of "which timestamp do you mean?". The marginal semantic clarity isn't worth the broader audit.
2. **Boolean `checked` column with `completed_at` left as-is** — would require a backfill (`checked = true` for existing rows) and still leaves `completed_at` ambiguous. Descartada porque it's the worst of both worlds: a new column AND the old one still around.
3. **3-button dialog via two sequential `confirmDelete` prompts on web** — descartada porque sequential modal stacks are confusing UX and Tester would need to track 4 dialog states per spec.
4. **3-button dialog via `Alert.alert` on native + `confirmDelete` collapsing to 2 buttons on web** — descartada porque the on-web experience would silently drop the third option (silent UX divergence the user can't see across platforms).
5. **Auto-check the set on input commit (blur)** — Strong-deviation, removes one tap. Descartada per Discovery #5: filling and confirming are distinct moments; the user may backfill numbers from memory and not have actually done the set yet.
6. **Check button on the right of the row, full-row-height like Strong** — strong visual statement. Descartada because the right side is already crowded (notes + trash). Left placement is cleaner; tint reinforces "done" visually without needing the icon to be huge.
7. **Cascade discard ALL children (checked + unchecked)** — Validator-rejected as a destructive surprise (MAJ-2). User would silently lose a checked dropset they had opted into.
8. **Cascade pre-flight: count checked children, surface in dialog copy** — MAJ-2 alternative (b). Descartada porque it forces extra logic in the Finish handler for a fringe scenario (chained dropset under unchecked parent is rare) and the user would still be confused by the cascade's collateral. Filtering to unchecked-only (chosen) keeps the user's explicit opt-in intact.
9. **Block discard if any unchecked parent has checked children** — MAJ-2 alternative (c). Descartada porque it surfaces a fringe error mid-Finish-flow that the user can't easily recover from without per-row navigation.
10. **Stagger timestamps in `bulkCheckAllInSession` (MAJ-3 alt a)** — `completed_at = now() + interval N seconds` per row. Descartada porque it needs N round-trips or a server-side `UPDATE FROM SELECT` (Drizzle/PostgREST-unfriendly), while the secondary `set_number` sort solves the ordering problem with a one-line read-side change.
11. **Cancel at the top of the dialog stack (matches v1)** — descartada per MIN-1: iOS HIG vertical-stack convention puts primary on top and Cancel at the bottom for thumb reach. v1's order was arbitrary and didn't match a stated convention.
12. **Optimistic check toggle via `onMutate`** — snappier UX. Descartada for v1: no precedent in the codebase, adds complexity to four new hooks, felt-latency on Supabase typical-network is small. Re-evaluate if users complain.
13. **Single accessibilityLabel for check button regardless of state, relying on `accessibilityState={{checked}}`** — pure-ARIA-correct approach. Descartada porque it complicates e2e selectors (Playwright's `getByLabel` is the cleanest cross-platform handle; `accessibilityState` doesn't surface as a label and varies across iOS/Android/web a11y trees). The MAJ-1 prompt explicitly asked to pick ONE strategy — chose the label-pair.

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
- Rebuilding `parent_set_id` chains when a parent is soft-deleted (would resolve the known orphan nit; deferred).
- Pre-flight cascade-discard warning copy ("you'll also lose N checked children") — deferred; current MAJ-2 (a) preserves checked children instead.

## Open questions for Validator

1. **Set ordering with nullsFirst pinned**: confirm `nullsFirst: false` in PostgREST translates to `ORDER BY completed_at ASC NULLS LAST`. Verify the syntax against PostgREST docs.
2. **`set_number` uniqueness invariant**: secondary sort key relies on `set_number` being unique per `(session_id, exercise_id)`. Discovery confirmed `logSet` at `src/api/sets.ts:38-48` computes `set_number` as `max(set_number where session_id=X, exercise_id=Y, deleted_at IS NULL) + 1`. Two unchecked sets on the same exercise will have distinct `set_number`s; after bulk-check they share `completed_at` but differ on `set_number`. Confirm no concurrent-insert race can produce duplicate `set_number` (single-user, single-active-session — safe in practice).
3. **`chooseAction` singleton mount location**: design mounts `<ChooseActionModalHost />` at `app/_layout.tsx` (root). Validator confirm this is the right root (and not `app/(app)/_layout.tsx` which only covers authed screens — the dialog is only invoked from authed screens, so either works, but root is simpler).
4. **Cascade-discard scope (per-row vs bulk)**: cascade applies only on the bulk-discard Finish path. Per-row delete via `useDeleteSet` keeps today's behavior (no cascade) — accepted as known pre-existing nit.
5. **`logSet`-then-immediately-`onCommit` race**: today the user adds a set (`logSet` returns row with `completed_at = null` post-feature), then types weight/reps (`updateSet` patches reps/weight/rpe/notes only). The patch shape doesn't touch `completed_at`, so the row stays unchecked — desired. Confirm no implicit "log set → check it" coupling exists anywhere.

## Status

`done`
