# Validation v2 — 2026-05-22_1000_set-row-declutter

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## v1 issues — verification

| Issue | v2 fix | Verified |
|---|---|---|
| MAJ-1 (`updateSetMeta` undefined-vs-absent) | `if (patch.rpe !== undefined) payload.rpe = patch.rpe;` + empty-patch short-circuit + 5 unit tests. | ✓ design-v2:63-68; "—" chip dispatches `{rpe: null}` at :84. |
| MAJ-2 (`<SetRowMenu>` mount-gating) | `{menuOpen ? <SetRowMenu …/> : null}` in `<SetInput>`. `visible` prop dropped. v1's incorrect "Modal unmounts children" claim removed. | ✓ design-v2:210-220, :127. |
| MIN-2 (chip equality normalization) | `parseFloat(initialRpe).toFixed(1)` for chip-equality compare. | ✓ design-v2:159. |
| MIN-3 (drop shakedown citation) | Citation dropped; debt logged as follow-up. | ✓ design-v2:284, :321. |
| MIN-4 (KAV Android behavior) | `behavior={Platform.OS === "ios" ? "padding" : "height"}`. | ✓ design-v2:171. |
| MIN-5 (two-write race) | Cost accepted explicitly. | ✓ design-v2:184-188. |
| MIN-7 (drop `["stats"]` invalidation) | Only `["sets", sessionId]` invalidated. | ✓ design-v2:115. Verified `src/api/stats.ts:28-29` SELECT excludes rpe/notes — safe. |

**All v1 issues addressed.**

## NEW BLOCKER

- **[BLK-1] `updateSet` clobber path is triggered on every reps/weight blur — silently NULLs saved RPE and notes.**
  - **What's wrong**: Today's `<SetInput>.onCommit` produces `{reps, weight, rpe, notes}` from local state. v2 narrows it to `{reps, weight}` (rpe/notes moved into the menu). The unchanged `updateSet` (`src/api/sets.ts:77-94`) does `.update({reps: patch.reps ?? null, weight: patch.weight ?? null, rpe: patch.rpe ?? null, notes: patch.notes ?? null})`. So when a reps/weight commit fires, `patch.rpe` and `patch.notes` are `undefined` → `?? null` → DB row gets `rpe=null, notes=null`. **The user's RPE / notes are erased on every reps or weight focus loss.**
  - **Latent footgun in v1, triggered-on-every-blur in v2.** Validator v1 missed it; the narrowing change in v2 is what promotes it.
  - **Suggested fix (option a, strongly recommended)**: change `src/api/sets.ts:77-94` `updateSet` to the same partial-spread pattern as `updateSetMeta`: `if (patch.X !== undefined) payload.X = patch.X`. Narrowest diff. Kills the latent footgun once and for all. The design's previous "broad blast radius" framing is wrong — `updateSet` has one caller path (`useUpdateSet` from `[sessionId].tsx` + `history/[id].tsx`); switching to partial-spread strictly preserves correctness for all current callers because they all pass the fields they want written.
  - Alternatives: (b) keep rpe/notes in `<SetInput>` state seeded from row data via `useEffect`, forward on every commit; or (c) new `updateSetCore(id, {reps, weight})` partial API leaving `updateSet` for full-patch callers (none exist).

## Lingering minors (cosmetic)

- **[MIN-8-v2]** JSDoc warning on `updateSet` not actually present in the v2 contracts section. Easy follow-up.
- **[MIN-9-v2]** `<SetRowMenu>`'s `onSubmit` accepts `{rpe?: string | null, notes?: string | null}` — explicit `undefined` is permitted by the type but the design says callers shouldn't pass it. Tighten type to "key present or absent, not present-with-undefined".

## Decision

**`no-go`**

Reasoning:
- 1 blocker → no-go.
- All v1 issues fixed cleanly.
- BLK-1 is a real user-data-loss bug. The latent footgun became user-triggered by v2's narrowing.
- Round 2 of 3 used; 1 round remaining. v3 must close cleanly or escalate.

## Counts

`{ blockers: 1, majors: 0, minors: 2 }`

## Recommendation to Conductor

`invoke Designer for re-design (v3)` with tight scope:
1. **(BLK-1)** Apply partial-spread pattern to `src/api/sets.ts:77-94` `updateSet`: `if (patch.X !== undefined) payload.X = patch.X`. Add unit tests confirming `{reps: 5}` updates ONLY reps and leaves rpe/notes/weight unchanged.
2. **(MIN-8/9)** Optional polish.
