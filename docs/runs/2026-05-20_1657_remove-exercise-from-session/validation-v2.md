# Validation v2 — 2026-05-20_1657_remove-exercise-from-session

## v1 issues re-verified

| Ref | v1 severity | v2 resolution | Verdict |
|---|---|---|---|
| **M1** — `.select("id")` dead code | major | API signature now `Promise<void>`; matches `softDeleteSet` verbatim. design-v2:60-68 | RESOLVED |
| **M2** — `logSet` race reachable | major | Two-layer: `removeDisabled={logSet.isPending}` prop + `if (logSet.isPending) return;` early-return in handler. design-v2:198-199, 231 | RESOLVED (new M3 trade-off below) |
| **m1** — `out` → `filtered` rename ambiguity | minor | Option (b) chosen; all 3 downstream refs switched. design-v2:161, 165, 171, 177 | RESOLVED |
| **m2** — `setCount` staleness | minor | Accepted-and-documented. M2 guard narrows the window. design-v2:315 | ACCEPTED |
| **m3** — defensive nullish | minor | Moot — `.select()` removed under M1(a) | MOOT |
| **m4** — Trash size 18 vs chevron 20 | minor | Accepted as `routine-exercise-row.tsx:80-107` precedent | ACCEPTED |
| **m5** — Header math ~144px vs ~98px | minor | Corrected to ~96px. design-v2:328-330 | RESOLVED |
| **m6** — `!sessionId` guard missing | minor | Added as first line of `handleRemoveExercise`. design-v2:198 | RESOLVED |
| **m7** — `removedExerciseIds` missing dep | minor | Added as 6th entry in `useMemo` dep array. design-v2:184 | RESOLVED |

## v2-new claim verification

| Claim | Verified against | Verdict |
|---|---|---|
| API returns `void`, matches `softDeleteSet` | `src/api/sets.ts:119-125`; design-v2:60 | TRUE |
| `removeDisabled` wired to `logSet.isPending` | design-v2:231; `logSet` defined at `workout/[sessionId].tsx:35` | TRUE |
| `handleRemoveExercise` early-returns on `!sessionId \|\| logSet.isPending` | design-v2:198-199 | TRUE |
| All 3 `out` references switched to `filtered` | design-v2:161, 165, 171, 177 | TRUE |
| `removedExerciseIds` in `useMemo` deps | design-v2:184 (6th entry) | TRUE |
| Trash `opacity-40` when disabled | design-v2:284 | TRUE (but see m8) |

## New concerns

### Major (1)

**M3** — `useLogSet(sessionId)` is session-scoped, not per-exercise; `removeDisabled` over-blocks across unrelated exercises.

Evidence:
- `src/hooks/use-sets.ts:37-46`: one mutation instance keyed only to session.
- `workout/[sessionId].tsx:35`: screen instantiates `logSet` once.
- Effect: `logSet.isPending` true whenever any set save anywhere in the session is in flight. Trash on Exercise B is disabled while saving on Exercise A.

**Acknowledged** by Designer at design-v2:236, 367-368. Closes the original M2 race (insert on X + remove X) which was the real concern. Over-blocking for ~hundreds of ms with visual feedback (`opacity-40`) is benign.

Allowed under "≤ 1 major → go" rule as known debt.

Suggested follow-up (not blocking): scope the disable per-exercise via `useIsMutating` once mutation keys are added.

### Minor (1)

**m8** — `opacity-40` for disabled trash vs `opacity-30` for disabled chevrons in same cluster.

`exercise-block.tsx:108,117` uses `opacity-30`; design-v2:284 specifies `opacity-40`. 10% diff, barely noticeable.
- Fix: drop trash to `opacity-30` to match. One-line at Implementer time.

## Concerns explicitly cleared
- `<ExerciseBlock>` prop addition safe for history detail (no `onRemove` passed).
- `softDeleteSet` precedent verified.
- `confirmDelete` API verified.
- `routine-exercise-row` cluster order replicated exactly.
- Cache invalidation (`["sets", sessionId]` + `["stats"]`) consistent with `useLogSet`.
- Override branch: removed exercise dropped from both override-resolved positions and trailing-append.
- `excludeIds` picker prop automatically re-exposes a removed exercise.

## Decision

**go** — 0 blockers, 1 major (M3, acknowledged trade-off), 1 minor (m8, cosmetic).

Round 2 of 3.

Implementer should apply m8 (`opacity-30` for trash to match chevrons) as polish; M3 ships as documented known debt.
