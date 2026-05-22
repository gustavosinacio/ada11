# Validation v1 — 2026-05-22_1000_set-row-declutter

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## Most claims verified

- `updateSet` clobbers all 4 fields on every call — confirmed at `src/api/sets.ts:77-94`.
- `plate-calculator.tsx:69-72` bottom-sheet pattern matches Designer's spec verbatim. No `KeyboardAvoidingView` anywhere in the codebase.
- `<SetInput>` is fully editable on both live + history mounts (`history/[id].tsx:239-275`).
- `useUpdateSet` invalidations `["sets", sessionId]` + `["stats"]` confirmed.
- Notes-icon precedent at `set-input.tsx:180` (`color={notes.trim() ? "#3b82f6" : "#9ca3af"}`).
- 0 e2e specs target inline RPE input or notes-toggle label.
- No `MoreHorizontal` import elsewhere (no collision with existing `ChevronDown`).
- `SetRow` shape unchanged → no cache buster needed.

## Issues

### Blockers
**None.**

### Majors

- **[MAJ-1]** `updateSetMeta` spread guard semantics. Designer's snippet uses `Object.prototype.hasOwnProperty.call(patch, "rpe")` then `payload.rpe = patch.rpe ?? null`. TypeScript optional keys (`rpe?: string | null`) can be explicit-`undefined` from callers; `hasOwnProperty` returns true, and `patch.rpe ?? null` collapses to `null`, silently clearing the field on a "leave alone" intent. The exact clobber footgun the design promises to avoid.
  - **Suggested fix**: switch to `if (patch.rpe !== undefined) payload.rpe = patch.rpe;`. Treat `undefined`=absent, `null`=explicit clear. The "—" RPE chip must pass `{rpe: null}` (not `{rpe: undefined}`). Add empty-patch short-circuit so `updateSetMeta(id, {})` doesn't hit the network (PostgREST `.update({})` is likely 400).

- **[MAJ-2]** `<SetRowMenu>` draft-state re-sync on open. Design's risk-section line 331 claims "React Native `<Modal>` does not render children when `visible=false`" — **wrong on RN Web** and unreliable on native. Menu props are `initialRpe`/`initialNotes` (seed-only-on-mount); without explicit sync, the menu can show stale chip selection after cache invalidations.
  - **Suggested fix**: gate the JSX with `{menuOpen ? <SetRowMenu …/> : null}` inside `<SetInput>` so each open is a fresh mount. Side effect: kills the 20+ idle `<SetRowMenu>` JSX trees that would otherwise sit in the reconciliation graph for a typical session (also fixes MIN-1).

### Minors

- **[MIN-1]** Render-cost: 20+ sets in a session = 20+ idle `<SetRowMenu>` trees if not gated. Fixed by MAJ-2's `{menuOpen ? … : null}` gate.
- **[MIN-2]** RPE-stored-as-string edge: legacy rows may have `"9"` instead of `"9.0"`. Chip-equality won't highlight. Fix: normalize on read via `parseFloat(rpe).toFixed(1)` (existing precedent at `set-input.tsx:97`).
- **[MIN-3]** Trash tap-target debt citation. Designer cites `docs/iphone-shakedown.md` for "pre-existing debt" but that file is a blank template. The debt is real (`set-input.tsx:187` `rounded p-1` ≈ 24pt) but the citation is hollow.
- **[MIN-4]** `KeyboardAvoidingView` behavior for Android: Designer specs `behavior="padding"` on iOS, `undefined` on Android. Multi-line notes at the bottom of a 320pt sheet on Android may still get covered. Spec `behavior="height"` on Android or test both.
- **[MIN-5]** Race: chip tap while notes input is focused → `Keyboard.dismiss` → notes blur → notes commit, then chip commit. Two writes, two refetches. Not incorrect but worth specifying batch-on-overlap behavior or accepting the cost.
- **[MIN-6]** Empty-patch network call. `updateSetMeta(id, {})` would issue `.update({})` (PostgREST likely 400). Short-circuit in JS.
- **[MIN-7]** `["stats"]` invalidation on RPE/notes change. RPE/notes aren't inputs to any stat. Could skip the invalidation for meta updates — optional.

## Decision

**`no-go`**

Reasoning:
- 0 blockers + 2 majors → no-go per decision rule.
- Both majors have surgical fixes already proposed. Expect tight v2.

Round 1 of 3 D↔V; 2 rounds remaining.

## Counts

`{ blockers: 0, majors: 2, minors: 7 }`

## Recommendation to Conductor

`invoke Designer for re-design (v2)`. Required v2 fixes:
1. (MAJ-1) `updateSetMeta` partial-spread: `if (patch.rpe !== undefined) payload.rpe = patch.rpe`. Empty-patch short-circuit. Document "—" chip sends `{rpe: null}`.
2. (MAJ-2) `<SetRowMenu>` JSX gated by `menuOpen` so each open is a fresh mount. Drop the incorrect "Modal unmounts children" claim. Also resolves MIN-1.
3. (MIN-2) Normalize RPE string on read via `parseFloat(rpe).toFixed(1)`.
4. (MIN-6) Empty-patch short-circuit (covered by MAJ-1 fix).
5. Other minors absorbed opportunistically.
