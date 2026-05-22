# Validation v3 — 2026-05-22_1000_set-row-declutter (FINAL)

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## v2 issues — verification

| Issue | v3 fix | Verified |
|---|---|---|
| BLK-1 (`updateSet` clobber on reps/weight blur) | Partial-spread pattern in `updateSet`; empty-patch short-circuit; return type widened to `SetRow \| null`. | ✓ design-v3:63-88. |
| Caller audit `workout/[sessionId].tsx:379-385` | Forwards `{reps, weight}` only; rpe/notes absent → untouched in DB. | ✓ verified against current source. |
| Caller audit `history/[id].tsx:261-267` | Same shape. | ✓ |
| `useUpdateSet` null tolerance | Skips invalidation on `null`. | ✓ design-v3:121-126. |
| `["stats"]` invalidation retained on `useUpdateSet` | Kept; reps/weight feed stats; rpe/notes don't → asymmetry intentional. | ✓ verified `src/api/stats.ts:28-29` SELECT excludes rpe/notes. |
| Unit test regression case | `updateSet({reps: 5})` → `.update({reps: 5})` exactly. | ✓ design-v3:168 + E2E backup at :184-186. |
| MIN-8 (JSDoc on updateSet) | Full tri-state docblock added. | ✓ design-v3:48-62. |
| MIN-9 (omit-undefined typing) | JSDoc on both `UpdateSetInput` and `UpdateSetMetaInput`. | ✓ |

**All v2 issues fixed.**

## New scrutiny — all clean

- Both callers `await updateSet.mutateAsync(...)` without using the resolved value → safe to widen return to `SetRow | null`.
- Chain end-to-end: `<SetInput>.onCommit({reps, weight})` → page `onUpdateSet` → `updateSet.mutateAsync` → partial-spread → DB columns rpe/notes left untouched. ✓
- `["stats"]` asymmetry (retained on `useUpdateSet`, dropped on `useUpdateSetMeta`) correct and documented.
- Regression test is the right form (`.update({reps: 5})` payload-shape assertion).

## Issues

### Blockers / Majors
**None.**

### Minors (cosmetic)

- **[MIN-10-v3]** Design-v3 table says "Six cases" but Test plan lists 7. Authoritative is the Test plan. Implementer lands 7.
- **[MIN-11-v3]** Design says `useUpdateSet` patch type is "narrowed". Existing `UpdateSetInput` at `src/api/sets.ts:15-20` is already idiomatic `{X?: T | null}` — only JSDoc changes, no code-level narrowing.

## Decision

**`go`**

Reasoning:
- 0 blockers + 0 majors + 2 cosmetic minors → `go`.
- BLK-1 closed at the root with minimum-diff fix. No behavior change for any current caller.
- 7 unit tests + 1 E2E backup directly assert the regression case.
- v3 ships a cleaner contract than the codebase had pre-run (`updateSet` and `updateSetMeta` now share the tri-state semantics).

## Counts

`{ blockers: 0, majors: 0, minors: 2 }`

## Recommendation to Conductor

`invoke Implementer`. Land the 7-case test version (not 6); treat patch-type "narrowing" as JSDoc-only.
