# Validation v2 — 2026-05-23_1855_read-only-history-view

Round: Design↔Validate round 2 of ≤3.
Reviewing: `design-v2.md` against `validation-v1.md` + repo.

## Verification of Conductor's 10 checks

| # | Item | Verdict |
|---|---|---|
| 1 | `"Edit workout times"` purged | VERIFIED. Only diff-tracking quotes of the v1 finding remain; all substantive references use `"Edit start and end times"` (live label at `session-times-editor.tsx:119`, cross-checked against `crud.spec.ts:253,349,374`). |
| 2 | `Keyboard.dismiss()` before `setIsEditing(false)` | VERIFIED at design-v2:158-162. `Keyboard` import added at line 75. Rationale in code comment + Riscos line 364. |
| 3 | MIN-1 redirect prose softened | VERIFIED. Lines 309 + 376 now describe the `useEffect` post-commit behavior. |
| 4 | MIN-2 `useLastWorkingSet` perf win | VERIFIED at design-v2:380. Source verified at `exercise-block.tsx:100`. |
| 5 | MIN-3 `<ExercisePicker>` mount-gated | VERIFIED at design-v2:273-285. |
| 6 | MIN-4 `Stack.Screen` lifted into const | VERIFIED at design-v2:145-181; consumed in loading/error/happy. |
| 7 | MIN-5 unmount enumeration promoted | VERIFIED at design-v2:365-370 (5-bullet list). |
| 8 | MIN-6 `useColorScheme` flagged NEW | VERIFIED — confirmed against `history/[id].tsx:1-11` that it isn't currently imported; import diff at design-v2:67-85. |
| 9 | No state-resurrection on picker mount-gate | VERIFIED. Done handler runs `setPickerOpen(false)` THEN `setIsEditing(false)` in the same React event; both state updates batch, picker unmounts cleanly. |
| 10 | Other claims still hold | VERIFIED. Dynamic `headerRight: () =>` pattern matches measurements precedent at `measurements/[id]/index.tsx:140-156`; 6 mutation hooks still gated; `(deleted)` suffix preserved via header-replica contract at design-v2:127. |

## Spot-checks for new bugs

- **`Keyboard.dismiss()` semantics**: confirmed `<SetInput>` commits on blur (`set-input.tsx:140,153`); RN blurs the focused TextInput on iOS/Android; web blurs via focus-loss on unmount; TanStack mutations dispatch before promise resolution so unmount during in-flight does not cancel. MAJ-2 fix is technically sound.
- **`pickerOpen` resurrection**: Done handler force-resets `pickerOpen=false` BEFORE flipping `isEditing`. Re-entry mounts a fresh picker with `pickerOpen=false`. No stale-open modal.
- **`addedExerciseIds`** preserved across toggle — design-v2:375 explicitly notes this; user re-enters Edit to remove if needed.
- **Empty-block path** (`sets.length === 0`) reachable via `addedExerciseIds`; design-v2:130 renders italic "No sets logged for this exercise." (correct).
- **Loading-state Pencil tap** flips `isEditing=true` while data still loading; on resolve, user lands in edit mode without seeing read-only default first. Documented tradeoff at design-v2:377; acceptable since the user explicitly tapped Edit.

## v1 issues — status table

| ID (v1) | Status |
|---|---|
| MAJ-1 (wrong label) | RESOLVED |
| MAJ-2 (Done data-loss) | RESOLVED |
| MIN-1 (redirect prose) | RESOLVED |
| MIN-2 (`useLastWorkingSet` perf) | RESOLVED |
| MIN-3 (picker mount-gating) | RESOLVED |
| MIN-4 (`Stack.Screen` reuse) | RESOLVED |
| MIN-5 (unmount enumeration) | RESOLVED |
| MIN-6 (`useColorScheme` import) | RESOLVED |

## New findings

### Blockers
None.

### Majors
None.

### Minors

- **[NEW-MIN-1] design-v2.md:147 — title chain inline snippet is logically wrong.** `session.data?.name?.trim() || "Workout" || "Session"` always evaluates to the name or `"Workout"` (because `"Workout"` is truthy and short-circuits); `"Session"` is dead. Today's loading/error states render `"Session"` (`history/[id].tsx:158, 167`), so the snippet as-written is a UX regression for the loading/error variants. The design DOES instruct the implementer in the follow-up paragraph at lines 183-185 to use the explicit ternary, but the misleading snippet above could be copy-pasted. **Fix during Implement**: use `title: session.data?.name?.trim() ? session.data.name.trim() : (session.data ? "Workout" : "Session")`. Implementer must read both paragraphs before coding.

## Decision

**go**

Counts: blockers=0, majors=0, minors=1.

Confidence: HIGH — every v1 blocker/major/minor addressed with file-line citations verified against the live source. The single new minor is a documentation defect that the design itself corrects in the next paragraph.

Risk if shipped as-is: LOW — additive feature, no schema/migration/RLS, mutation hooks structurally gated, no existing e2e specs need to change.

Recommendation: **invoke Implementer**. Pass NEW-MIN-1 hand-off note (use the explicit ternary, not the buggy short-circuit).
