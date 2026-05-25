# Validation v2 — 2026-05-24_2020_auto-fill-placeholder-on-check

Round: Design↔Validate round 2 of ≤3.
Reviewing: `design-v2.md`.

## Verified claims

| Claim | Verified? |
|---|---|
| `setsByExercise` captured in handler closure; cache shape is `SetRow[]` keyed by `["sets", sessionId]` | yes |
| `useUpdateSet` patch shape partial-spread | yes |
| `<SetInput>.commit()` calls `onCommit({reps, weight})` with both keys present | yes |
| `previousByRowId` in `<ExerciseBlock>:106-122` is the placeholder source | yes |
| Only one production caller of `<ExerciseBlock>` (live screen) | **NO — see BLK-2** |
| `Keyboard.dismiss()` synchronously dispatches `onBlur` so same JS turn reads post-blur cache | **NO — see BLK-1** |
| `setQueryData` on `["sets", sessionId]` surfaces to same-tick handler via `setsByExercise.get(ex.id)` | **NO — see BLK-1** |

## Findings

### Blockers

- **BLK-1 — Same-tick post-blur cache read is architecturally impossible.**
  v2's central mitigation rests on this chain: `Keyboard.dismiss()` → blur → `commit()` → `setQueryData(...)` → handler reads `setsByExercise.get(ex.id)` and sees fresh value, all on the same JS turn. **Two independent failures break this:**
  1. `setsByExercise` is closed over from the last render via `useMemo(() => …, [setsQ.data])`. Handler captures the Map at render time. A synchronous `setQueryData` updates the store and schedules a render — but the currently-running handler cannot observe that update through `setsByExercise`.
  2. On iOS/Android, `Keyboard.dismiss()` does NOT synchronously fire `onBlur`. It posts a `blurTextInput` UIManager command; the resulting blur event arrives asynchronously via the bridge in a later JS turn. The read-only-history precedent at `app/(app)/history/[id].tsx:186-197` relies on the *unmount cycle* (next render), NOT on the next line of synchronous code reading post-blur state.
  
  Net: E2E cases E2/E3 ("type 120, tap check, assert 120 survives") will fail. **MAJ-1 from v1 is NOT closed.**
  
  **Fix (the only race-free option)**: read the typed-but-uncommitted value DIRECTLY from `<SetInput>`'s local state through an extended toggle callback signature. Extend `onToggleChecked` to pass the current `{reps, weight}` strings, OR push the auto-fill predicate into `<SetInput>` itself.

- **BLK-2 — `sessionId: string` (required) prop on `<ExerciseBlock>` breaks the history-edit caller.**
  Design claims "only one production caller". False — history detail mounts `<ExerciseBlock>` in edit mode at `app/(app)/history/[id].tsx:310-352` (added by `2026-05-23_1855_read-only-history-view`). With v2's required `sessionId`, this caller becomes a TypeScript error. Also, the cache-shim runs on every `<SetInput>.onCommit` regardless of `showCheckable`, so even though the history-edit caller doesn't enable check, it would still crash if it triggered an `onCommit`.
  
  **Fix**: either make `sessionId?: string` optional and gate the shim on its presence, OR thread `sessionId={id}` into the history-edit caller. (Both moot if the shim is removed per BLK-1 fix.)

### Majors

- **MAJ-1 — `<ExerciseBlock>`'s sync-cache-patch shim collides with `useUpdateSet`'s onSuccess invalidation.** Every `<SetInput>` blur (not only auto-fill) would: (1) sync setQueryData → render with patched cache, (2) await mutation, (3) onSuccess invalidates → refetch fires, (4) brief stale-while-revalidate window may revert/re-apply the value if network is slow. Real UX regression on the existing manual-commit path, introduced indirectly by the auto-fill fix.

- **MAJ-2 — `commit()` writes `{reps: null, weight: null}` for cleared fields and the sync-cache-patch propagates clears verbatim.** If user typed `"120"` into weight only, `commit()` sends `{reps: null, weight: "120.00"}` and the shim's `{...r, ...patch}` clears reps in the cache synchronously. Today's deferred clear becomes an immediate clear; F10 kernels see the half-write transiently.

### Minors

- MIN-1: E12 lbs string `"220.5"` is correct (`(220.462).toFixed(1) === "220.5"`).
- MIN-2: file-edit collapses if BLK-1 fix is taken (no shim).
- MIN-3: unit coverage for previous-zero is complete (cases 13/14/15).
- MIN-4: `["stats"]` over-invalidation acknowledged.
- MIN-5: uncheck → re-check case is correctly null-predicate; assert weight/reps survive uncheck as regression insurance.

## v1 issue status

| ID | Addressed? |
|---|---|
| MAJ-1 (mid-typing race) | **NO** — the mitigation doesn't work for the architectural reasons in BLK-1 |
| MIN-1 (lbs e2e) | YES |
| MIN-2 (optional `previousSet`) | YES |
| MIN-3 (previous=0 unit) | YES |
| MIN-4 (lift-to-screen rationale) | YES |
| MIN-5 (`["stats"]` over-invalidation) | YES |

## Decision

**no-go** — 2 blockers.

Counts: blockers=2, majors=2, minors=5.

## Recommendation

Round 2 of 3 — **last round before escalation**. Invoke Designer v3 with hard constraints:

1. **Read typed value directly from `<SetInput>`'s local state.** Extend `onToggleChecked` callback to pass the current `{reps: string, weight: string}` strings. OR push the auto-fill predicate into `<SetInput>` itself (it already has `previousSet` prop and local state). Race-free on every platform.

2. **Drop the `<ExerciseBlock>` sync-cache-patch shim entirely.** Eliminates BLK-2, MAJ-1, MAJ-2.

3. **Make `sessionId` on `<ExerciseBlock>` optional**, OR remove the prop entirely if (2) is taken.

4. **Drop `Keyboard.dismiss()`** from auto-fill path — not needed once buffered value flows through callback. Keep only as UX polish if independently desired.

Confidence: HIGH on BLK-1 (closure capture + native blur-dispatch semantics traced file:line). HIGH on BLK-2 (direct grep of `<ExerciseBlock>` callers).
Risk if shipped as v2: HIGH — central feature claim regresses to "auto-fill overwrites user input" on the most common ergonomic flow.
