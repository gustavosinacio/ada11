# Validation v1 — 2026-05-24_2020_auto-fill-placeholder-on-check

Round: Design↔Validate round 1 of ≤3.
Reviewing: `design-v1.md`.

## Verified claims

| Claim | Verified? |
|---|---|
| Handler at `app/(app)/workout/[sessionId].tsx:492-520` is the right insertion point | YES |
| `useUpdateSet` mounted at screen scope (line 72) | YES |
| `previousByRowId` Map built inside `<ExerciseBlock>` via `useMemo` | YES (lines 106-122) |
| `previousByRowId.get(s.id)` passed to `<SetInput>` as `previousSet` | YES (line 235) |
| `<SetInput>` re-syncs local strings via `useEffect([row.reps, row.weight, unit])` | YES (lines 90-93) |
| Only one production caller of `onToggleSetChecked` (the live screen) | YES |
| `<ReadOnlyExerciseBlock>` does not mount the toggle handler | YES (no `showCheckable`/`onToggleSetChecked` props) |
| `bulkCheckAllInSession` bypasses `onToggleSetChecked` | YES (line 338-348 calls bulk mutation directly) |
| `updateSet` partial-spread contract — `{weight, reps}` only writes those columns | YES (pinned by `api-sets.updateSet.test.ts:49-122`) |
| `sumLiveVolume` filters `weight > 0 && reps > 0` (strict) → no-previous safe | YES |
| `useUpdateSet` invalidation behavior — invalidates both `["sets", sessionId]` AND `["stats"]` | YES (use-sets.ts:73-74) |
| Existing rest-timer e2e seeds positive values → auto-fill predicate returns null, no extra await, timer fires identically | YES |
| Design's "mid-typing race is pre-existing" claim | **NO — see MAJ-1** |

## Findings

### Blockers
None.

### Majors

- **MAJ-1 — Mid-typing race is a NEW regression, not pre-existing.**
  Today: user types `"100"` into weight without blurring → taps check → `checkSet(id)` flips only `completed_at` → cache invalidates → `row.weight` unchanged → `useEffect([row.reps, row.weight, unit])` does NOT fire (deps unchanged) → local `"100"` preserved → later blur commits `"100"` correctly.
  After v1: same flow → handler reads cache (`row.weight == null`) → predicate fires → `await updateSet({weight: previous.weight="120.00"})` → cache invalidates → `row.weight` changes `null → "120.00"` → `useEffect` fires (deps DID change) → local string reset to `"120"` → **user's typed `"100"` silently overwritten by previous-session's 120.**
  
  Real, reproducible data-loss path on a common ergonomic flow.
  
  **Mitigations**:
  - (a) Force-commit before predicate: in the check handler, call `Keyboard.dismiss()` synchronously (matches the read-only history MAJ-2 precedent). On RN-Web, blur dispatches `onBlur` → `commit()` → cache updated. On iOS/Android, `Keyboard.dismiss()` blurs the focused TextInput, same outcome. After the dismiss, read the cache for the auto-fill predicate.
  - (b) Push predicate down into `<SetInput>` local state (architectural shift, rejected via discarded alternative).
  - (c) One-tick deferral.
  
  Recommend (a) — smallest blast radius, established precedent.

### Minors

- **MIN-1** — e2e list missing a **lbs unit-mode** scenario. Auto-fill writes canonical kg-string from `previous.weight`; `<SetInput>` displays via `inputStringFromKg`. In lbs mode the user sees the placeholder converted (e.g. 100 kg → "220" lbs). Add one e2e case "auto-fill in lbs mode shows lbs-converted value after check".

- **MIN-2** — prop signature `previousSet: SetRow | null` (required) vs `?: SetRow | null` (optional). Helper short-circuits safely on undefined; making the prop optional avoids type-safety footgun for future callers.

- **MIN-3** — predicate test list should explicitly include `previous.weight = "0"` (or `"0.00"`) case: assert helper does NOT propagate a zero weight (because `previousHasWeight` is false). Without this case, a future refactor could silently break the gate.

- **MIN-4** — design correctly rejects "lift `previousByRowId` to the screen" citing hooks-in-a-loop hazard. Verified accurate; pinning for future-design reference.

- **MIN-5** — `useUpdateSet` also invalidates `["stats"]` (not just `["sets", sessionId]`). Auto-fill check path issues one extra `["stats"]` invalidation per check vs the non-auto-fill path. Not a correctness issue (stats kernels gate on `completed_at != null`), but worth flagging as a future optimization candidate.

## Decision

**no-go** (1 major as known correctness regression; recommend baking mitigation (a) upfront rather than risking a Tester catch).

Counts: blockers=0, majors=1, minors=5.

## Recommendation

Invoke Designer v2 with mitigation (a) `Keyboard.dismiss()` before reading cache for the auto-fill predicate. Reference the read-only history view MAJ-2 precedent. Add lbs-mode e2e case + previous-weight-zero unit test case + optional `previousSet?` prop typing.

Confidence: HIGH on MAJ-1 (traced data-flow file:line).
Risk: MEDIUM if shipped without mitigation — gated on the user typing-then-checking-before-blur, but reproducible and frequent on web.
