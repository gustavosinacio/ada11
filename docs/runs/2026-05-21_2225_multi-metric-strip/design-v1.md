# Design v1 — 2026-05-21_2225_multi-metric-strip

## Goal (1 sentence)

Extend the per-exercise volume-target strip rendered inside `<VolumeTargetSlot>` on the live workout screen to show three reference metrics in one line — **Max** (previous-best single-session volume), **Now** (running session volume from CHECKED working sets only), and **To PR** (gap = Max − Now) — so the user can read the goal, the progress, and the remaining work as one consistent arithmetic.

## Approach

Treat this as a **presentation + kernel-consistency** change, not a new computation. The numbers Max and To PR are already returned by `computeVolumeTarget` (`previousMaxKg`, `gapKg`); the only behavioral change is that `runningKg` (and the derived `gapKg` + `repsToBeat`) is recomputed over **checked sets only** (`completed_at != null`) so the user-visible arithmetic `Max − Now = To PR` holds. The slot then renders the three labelled numbers inline with middle-dot separators, matching the precedent of `session-summary-row.tsx:56-65`, and keeps the existing `≈ X reps @ Wkg` clause as a parenthetical extension on the same row when there is room. No new query, no new prop on `<ExerciseBlock>`, no schema change, no cache key bump.

The conductor's tradeoff (A) vs (B) is resolved in favour of **(A) Consistent — drop drafts from `runningKg`**:

- F11's "drafts count" decision was made before F10 (set-check button) shipped. F10 is now the canonical "checked = committed" boundary across the app (see `set-input.tsx:103`, `listSetsForExercise` filtering `ended_at IS NOT NULL`, the bug-fix run `2026-05-21_2155_volume-math-wrong/` that diagnosed precisely this perception gap).
- The user's most recent direction (prompt verbatim) is: *"Per F10's spec, current session volume must count only sets marked done (checked)."* This is unambiguous for the Now display. The only design ambiguity is whether the gap math against the same `runningKg` should follow — and forcing them to diverge re-creates the exact "Volume to PR looks wrong" perception that this feature is meant to fix.
- The motivational argument for inclusive `runningKg` is preserved by a different mechanism: every check-toggle now shrinks the gap immediately. Checking a set is the act of motivation, and the strip reflects it. The "draft-counting" UX is replaced by a tighter feedback loop on the check button.
- Risk acknowledged: this is a behaviour change in the existing reps-to-beat math. Mitigation: the unit tests that assert the old behaviour are updated (see Test plan); the e2e golden path is re-scripted to seed CHECKED sets (most existing seeds already pass `completedAt` — the few that don't get a one-line patch).

The other two unknowns are decided as follows:

- **Layout** (Unknown #1): **Single line, dot-separated** — `"Max 4,900 kg · Now 1,200 kg · To PR 3,700 kg"` followed by the existing `· ≈ 7.2 reps @ 60.0 kg` clause when applicable. Rationale: the prompt frames the feature as "extend the strip" (not "redesign as a stat block"); the existing container is one short `Text` row with `text-sm` and middle-dot separators (precedents: `volume-target-slot.tsx:80`, `session-summary-row.tsx:60`, `exercise-block.tsx:138`). Stacking to 3-4 rows would add ~60-80px per exercise (×8 exercises = ~500px of scroll), unnecessary when the data fits on a line. Width check: at `text-sm` (14px) the worst-case copy fits within ~52 chars on standard data (`Max 4,900 kg · Now 1,200 kg · To PR 3,700 kg · ≈ 7.2 reps @ 60.0 kg` = 64 chars; on a 320px-wide iPhone SE this wraps to a second line — RN `Text` handles wrap gracefully, which is the same behaviour the current single-metric strip exhibits with long numbers, so no regression).
- **`no-pr` rendering** (Unknown #3): **Keep returning `null`.** The strip is the "previous best comparison" surface; when there is no previous best, hiding the strip preserves the existing UX contract and avoids widening the `VolumeTargetState` union just to display a dangling "Now X" value the user already sees in the set list. The "show me my Now even with no PR" motivation is better served by the future per-session header (out of scope), not by polluting every never-trained exercise block.

## Decisions on unknowns

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Layout shape | Single-line, middle-dot separators, with `≈ reps @ Wkg` clause appended on the same line in `chasing`. | Matches existing container + token usage in `volume-target-slot.tsx`; matches `session-summary-row.tsx` precedent; minimal vertical cost; graceful wrap on narrow screens. |
| 2 | Checked-only `runningKg` | (A) Consistent — `sumVolume` for the live-session input filters by `completed_at != null` (working/dropset sets only; warmups still excluded by `set_type`). Past-session reduction unchanged (rows seeded via `seedFinishedPRSession` already carry `completed_at`, and `listSetsForExercise` only loads finished sessions — past-session rows are effectively all "checked" anyway). | Forces `Max − Now = To PR` to be true on the visible UI; aligns with F10 "checked = committed"; replaces the lost "drafts motivate" UX with the tighter "check the set, watch the gap shrink" feedback loop. |
| 3 | `no-pr` rendering | Keep `null`. `VolumeTargetState` union unchanged on the `no-pr` branch. | Avoids type widening for a non-motivating render; preserves the "strip = PR comparison" contract. |
| 4 | `surpassed` state copy | Keep the current single-celebration copy (`"New PR! +X over your previous"` / `"Matched your previous best — one more rep is a PR"`). Do NOT prepend `Max/Now/To PR` triplet there — once you're past Max, "To PR" is negative-or-zero and the triplet stops being meaningful. | The user is past the comparison frame; celebration stands alone. Matches today's behaviour. |
| 5 | Copy labels | `Max`, `Now`, `To PR`. All caps `PR` (gym convention; matches the existing `Volume to PR:` label). Short labels keep the line under the wrap budget on narrow screens. | Per prompt's example; shorter than "Previous best / This session / To beat PR"; matches the existing `"… PR …"` register. |
| 6 | A11y for chasing | New `accessibilityLabel`: `"Previous best ${maxDisplay}. Current session ${nowDisplay}. ${gapDisplay} to beat your previous best. About ${reps} reps at ${weight}."` (drop the last sentence when the reps clause is hidden). | Reads the same three numbers in spoken form; preserves the existing "reps to beat" suffix wording. |
| 7 | Helper signature | `computeVolumeTarget` keeps its existing input shape. `sumVolume` is split into two internal helpers: `sumPastVolume(sets)` (no completion filter — past sessions are all "finished") and `sumLiveVolume(sets)` (filters `completed_at != null`). Both still skip warmups and run the `w > 0 && r > 0` guard. The exported function still returns the same `VolumeTargetState` union. | Localises the behaviour change to one kernel; keeps `computeVolumeTarget`'s consumers unchanged; explicit naming documents the two semantics. |
| 8 | `repsToBeat` denominator | Unchanged — still picks current weight by `max(set_number)` from `currentSessionSets` (any set with a finite positive weight, regardless of `completed_at`). | The "what weight am I on?" pick is about *intent*, not commitment — the user types `80` into a draft and the reps-to-beat math should immediately use `80`. Decoupling check-state from current-weight pick was the right call in F11 and survives this change. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/utils/volume-target.ts` | edited | Split the internal `sumVolume(sets)` into `sumPastVolume(sets)` (current behaviour, no completion filter) and `sumLiveVolume(sets)` (adds `completed_at != null` filter). `computeVolumeTarget` calls `sumPastVolume` over each `pastSessions[i].sets` and `sumLiveVolume` over `currentSessionSets`. Public type `VolumeTargetState` unchanged. JSDoc updated to document the asymmetry (and why). |
| `src/components/volume-target-slot.tsx` | edited | Replace the chasing-branch `<Text>` body so the same single `<Text>` row now renders `Max <bold>X kg</bold> · Now <bold>Y kg</bold> · To PR <bold>Z kg</bold>` followed by the existing `· ≈ <bold>R reps</bold> @ Wkg` clause when `showRepsClause`. Update `a11y` string to read all three numbers. `surpassed` branch unchanged. `no-pr` branch unchanged (still returns `null`). |
| `tests/unit/volume-target.test.ts` | edited | (a) Add a new `describe("computeVolumeTarget — checked-only running volume")` block: a chasing test where the current session has one CHECKED set and one DRAFT set, and `runningKg` reflects only the checked one. (b) Update the existing chasing tests' inline `mkSet` calls that depend on draft inclusion — there are none today (no existing chasing test stamps `completed_at`), so all current tests now implicitly assume the live sets are drafts and need their `mkSet` calls updated to pass `completed_at: "..."` for sets that should count. See Test plan for the exhaustive list. |
| `tests/e2e/volume-target.spec.ts` | edited | (a) Update the existing `seedLiveSet` helper signature to require a `completedAt` for the sets the assertions depend on (or pass it explicitly per call). (b) The three "phase B/C/D" calls in the golden-path test (`setNumber: 1/2/3`) currently pass no `completedAt`; stamp them with `new Date().toISOString()` so the numeric assertions still hold. (c) The MAJ-1 regression test already stamps `completedAt` on set #2 only — update set #1 to also be checked (otherwise the new `runningKg` drops set #1's volume and the gap math changes; see Test plan for the new expected numbers). (d) Update the assertions' literal strings to match the new `Max … · Now … · To PR …` copy (e.g. selector for "Volume to PR" → "To PR"; new assertions on "Max 1,800 kg" and "Now 0 kg" / "Now 500 kg" for phases B/C; "Max 1,000 kg" / "Now 400 kg" / "To PR 600 kg" etc. for MAJ-1). |

No changes to: `src/api/progress.ts`, `src/hooks/use-progress.ts`, `src/hooks/use-sets.ts`, `src/api/sets.ts`, `src/components/exercise-block.tsx` (no new prop), `app/(app)/workout/[sessionId].tsx`, schema, RLS, query keys.

## Contratos de I/O

### `src/utils/volume-target.ts`

Exported types — **no change**:

```ts
export type VolumeTargetState =
  | { kind: "no-pr" }
  | {
      kind: "chasing";
      previousMaxKg: number;
      runningKg: number;
      gapKg: number;
      currentWeightKg: number | null;
      repsToBeat: number | null;
    }
  | {
      kind: "surpassed";
      previousMaxKg: number;
      runningKg: number;
      overflowKg: number;
    };

export type ComputeVolumeTargetInput = {
  pastSessions: SessionSets[] | undefined;
  currentSessionSets: SetRow[];
};

export function computeVolumeTarget(
  input: ComputeVolumeTargetInput,
): VolumeTargetState;
```

Internal kernel split (private to the module):

```ts
// Used for `pastSessions[i].sets`. No completion filter — past sessions
// are loaded via `listSetsForExercise` which scopes to `ended_at IS NOT NULL`
// sessions, and within a finished session every set is implicitly committed
// (the F10 spec only governs the live-session interpretation).
function sumPastVolume(sets: SetRow[]): number;

// Used for `currentSessionSets`. Filters `completed_at != null` BEFORE the
// canonical kernel guards (warmup skip, w > 0, r > 0). Drafts (unchecked
// rows) are excluded so the user-visible `Max − Now = To PR` arithmetic
// holds.
function sumLiveVolume(sets: SetRow[]): number;
```

Both share the same per-set predicate (`set_type !== "warmup"`, `parseFloat(weight)` finite and `> 0`, `reps > 0`); `sumLiveVolume` only differs in the leading `if (s.completed_at == null) continue;` guard.

`currentWeightKg` pick (the `max(set_number)` reducer at `volume-target.ts:106-111`) is **unchanged** — still iterates `currentSessionSets` regardless of `completed_at`. Rationale captured in Decision #8.

### `src/components/volume-target-slot.tsx`

Props — **no change**:

```ts
type Props = {
  exerciseId: string;
  currentSessionSets: SetRow[];
};
```

Chasing-branch render shape (single `<Text>` row, inline bold children):

```tsx
<Text accessibilityRole="text" accessibilityLabel={a11y}
      className="text-sm text-gray-500 dark:text-gray-400">
  {"Max "}
  <Text className="font-semibold tabular-nums text-black dark:text-white">
    {maxDisplay}
  </Text>
  {" · Now "}
  <Text className="font-semibold tabular-nums text-black dark:text-white">
    {nowDisplay}
  </Text>
  {" · To PR "}
  <Text className="font-semibold tabular-nums text-black dark:text-white">
    {gapDisplay}
  </Text>
  {showRepsClause ? (
    <>
      {" · ≈ "}
      <Text className="font-semibold tabular-nums text-black dark:text-white">
        {repsDisplay}
      </Text>
      {` @ ${weightDisplay}`}
    </>
  ) : null}
</Text>
```

Where:
- `maxDisplay = formatVolume(state.previousMaxKg, unit)`
- `nowDisplay = formatVolume(state.runningKg, unit)`
- `gapDisplay = formatVolume(state.gapKg, unit)`
- `repsDisplay`, `weightDisplay`, `showRepsClause` — unchanged from the existing implementation.

A11y label (chasing):

```ts
const a11y = showRepsClause
  ? `Previous best ${maxDisplay}. Current session ${nowDisplay}. ${gapDisplay} to beat your previous best. About ${state.repsToBeat!.toFixed(1)} reps at ${weightDisplay}.`
  : `Previous best ${maxDisplay}. Current session ${nowDisplay}. ${gapDisplay} to beat your previous best.`;
```

Surpassed branch (no change): retains the emerald accent and the existing `"New PR! +X over your previous"` / `"Matched your previous best — one more rep is a PR"` copy and a11y labels.

`no-pr` branch (no change): `return null`.

### DB columns / queries

None added, none changed. Cache keys (`["progress", exerciseId]`, `["sets", sessionId]`) and their invalidations untouched. The new `sumLiveVolume` reads the same `completed_at` field that `set-input.tsx:103` already uses as the canonical "checked" predicate; no schema or RLS surface change.

## UI mockup

```
// State A: no-pr (first time logging this exercise)
// → return null. No DOM, no row.

// State B: chasing, with current weight available
┌──────────────────────────────────────────────────────────────────────────┐
│ Max **4,900 kg** · Now **1,200 kg** · To PR **3,700 kg** · ≈ **7.2 reps** @ 60.0 kg │
└──────────────────────────────────────────────────────────────────────────┘
  text-sm text-gray-500           bold = text-black dark:text-white, tabular-nums
  border-b border-gray-100 px-4 py-2 (container, unchanged)

// State B': chasing, no current weight yet (drop reps clause)
┌──────────────────────────────────────────────────────────────────────────┐
│ Max **4,900 kg** · Now **0 kg** · To PR **4,900 kg**                      │
└──────────────────────────────────────────────────────────────────────────┘

// State C: surpassed (unchanged from F11)
┌──────────────────────────────────────────────────────────────────────────┐
│ **New PR! +380 kg over your previous**                                    │
└──────────────────────────────────────────────────────────────────────────┘
  text-sm font-medium text-emerald-600 dark:text-emerald-400, tabular-nums

// State C': matched (unchanged from F11)
┌──────────────────────────────────────────────────────────────────────────┐
│ **Matched your previous best — one more rep is a PR**                     │
└──────────────────────────────────────────────────────────────────────────┘
```

Font/size/token usage:
- Container: `border-b border-gray-100 px-4 py-2 dark:border-gray-900` — unchanged from `volume-target-slot.tsx:68`.
- Wrapper `Text`: `text-sm text-gray-500 dark:text-gray-400` — unchanged.
- Inline bold values: `font-semibold tabular-nums text-black dark:text-white` — unchanged.
- Separator: `" · "` (with leading + trailing space) — unchanged from current `" · ≈ "` separator used in the same file.
- Reps clause keeps its current `≈` prefix and `@ Wkg` suffix; `formatVolume` for kg aggregates, `formatWeight` for the per-set weight — unchanged.

VoiceOver: chasing announces "Previous best 4,900 kg. Current session 1,200 kg. 3,700 kg to beat your previous best. About 7.2 reps at 60.0 kg." Surpassed and matched announcements unchanged.

## Test plan

### Unit — `tests/unit/volume-target.test.ts`

The existing 13 tests do not assert any draft-vs-checked behaviour (none of the chasing tests stamp `completed_at`). With the new `sumLiveVolume` filter, **all chasing/surpassed tests that pass `currentSessionSets` with `completed_at: null` (the default in `mkSet`) will now compute `runningKg = 0`** — most of those tests' `expect(state.runningKg).toBe(N)` and `expect(state.gapKg).toBe(N)` assertions will fail.

Required updates (each is a one-line change in `mkSet` — pass `completed_at: "2026-05-21T10:05:00Z"`):

| Test (current `it(...)` label) | Action |
|---|---|
| `"returns chasing with correct gap and reps when current weight is finite"` | Stamp the single current set with `completed_at`. Expected values unchanged. |
| `"returns floating-point reps when gap is not a multiple of current weight"` | Stamp the single current set. Expected `repsToBeat ≈ 7.5` unchanged. |
| `"returns chasing with repsToBeat=null when no current set has a positive weight"` | Set has no valid weight — `runningKg = 0` regardless of check state. Leave as-is; the assertion still holds. |
| `"returns chasing with repsToBeat=null when currentSessionSets is empty"` | Empty — leave as-is. |
| `"max-volume reduction picks the highest single-session total across pastSessions"` | The single current set (`100 × 1`) must be stamped. Expected `gapKg = 700` unchanged. |
| `"returns surpassed with positive overflow when running exceeds previous max"` | Stamp BOTH current sets. Expected `overflowKg = 500` unchanged. |
| `"returns surpassed with overflowKg=0 on an exact tie (MIN-2)"` | Stamp the single current set. Expected `overflowKg = 0` unchanged. |
| `"excludes warmups from BOTH past-max and running-volume reductions"` | Stamp the non-warmup current set (`100 × 2`). Expected `runningKg = 200` unchanged. |
| `"picks the highest set_number, not the last array index"` (MAJ-1) | Set #2 already stamped. Stamp set #1 (`100 × 5`) as well. Expected `runningKg = 900`, `gapKg = 100`, `repsToBeat ≈ 1.25` unchanged. |
| `"skips sets without a valid weight when picking current weight"` | Stamp set #1 (`80 × 5`). Expected `currentWeightKg = 80`, `runningKg = 400` unchanged. |

NEW `describe` block to add — `"computeVolumeTarget — checked-only running volume"`:

1. `"excludes draft (unchecked) sets from runningKg"` — past 1000 kg; current = [checked 100×5, draft 100×5]. Expect `runningKg = 500`, `gapKg = 500`, `currentWeightKg = 100`, `repsToBeat = 5`.
2. `"counts all checked working sets toward runningKg"` — past 1000 kg; current = [checked 100×3, checked 100×2]. Expect `runningKg = 500`, `gapKg = 500`.
3. `"a draft set still drives the currentWeightKg pick when it has the highest set_number"` — past 1000 kg; current = [checked set #1: 60×5 (volume 300), draft set #2: 80×0 weight-only]. Expect `runningKg = 300`, `currentWeightKg = 80`, `repsToBeat = 700 / 80 ≈ 8.75`. (Documents Decision #8 — current-weight pick is decoupled from check state.)
4. `"warmup is still excluded even when checked"` — past 500 kg; current = [checked warmup 200×50 (volume 10,000 if counted, must NOT be), checked working 100×2 (volume 200)]. Expect `runningKg = 200`, `gapKg = 300`. (Documents that the warmup-skip predicate runs after the checked filter.)

### E2E — `tests/e2e/volume-target.spec.ts`

The existing 6 e2e tests need three classes of update:

**A. Seed updates — pass `completedAt`** on every `seedLiveSet` call whose volume must count toward `runningKg`:

| Test | Sets to stamp |
|---|---|
| `"golden path: chasing copy + reps clause across multiple seeded sets"` | All three `seedLiveSet` calls (phases B/C/D) — pass `completedAt: new Date().toISOString()`. |
| `"chasing — no weight logged: hides the reps clause"` | The single draft `sets` insert has `completed_at: null` intentionally — keep it. The Now display becomes "0 kg" and the To PR display stays "1,800 kg". Update assertions accordingly (see C below). |
| `"tie case: matched copy renders when running == previous max"` | Stamp all three live sets. Expected `Matched your previous best` copy unchanged. |
| `"MAJ-1 regression: max(set_number) picks current weight, not array index"` | Set #1 currently unchecked, set #2 currently checked. **Stamp set #1 as well** so it counts toward `runningKg`. Expected numbers unchanged (gap 100, reps 1.3, weight 80.0). |
| `"no previous max: strip is hidden for a never-trained exercise"` | No prior session → still `no-pr` → strip still hidden. No change needed beyond label updates if any. |
| `"history detail does NOT render the strip"` | No change needed beyond label updates (history never mounts the slot). |

**B. Helper update** — `seedLiveSet` already accepts `completedAt`. The golden-path test currently omits it; switch to explicitly passing `new Date().toISOString()` per the table above.

**C. Assertion string updates** — replace the existing strict-text selectors with the new copy:

| Old assertion | New assertion |
|---|---|
| `page.getByText(/Volume to PR:/i)` | `page.getByText(/To PR/i)` (note: no trailing colon in new copy) |
| `page.getByText("1,300 kg")` (golden phase B) | Keep — `To PR` value is still `1,300 kg`. Also add `await expect(page.getByText("1,800 kg")).toBeVisible()` for the `Max` value and `await expect(page.getByText("500 kg")).toBeVisible()` for the `Now` value. |
| `page.getByText("820 kg")` (golden phase C) | Keep. Also add assertions on `"Max 1,800 kg"` (substring), `"Now 980 kg"`. |
| `page.getByText(/26\.0 reps/)`, `/13\.7 reps/` | Unchanged — reps clause copy is preserved. |
| `page.getByText("1,800 kg")` (no-weight test) | Keep. Also assert `page.getByText("Now 0 kg")` (substring match via a regex like `/Now\s+0 kg/`). |
| `"Matched your previous best"` (tie) | Unchanged. |
| `"100 kg"` (MAJ-1 gap) | Unchanged — still 100 kg gap. Also assert `"Max 1,000 kg"`, `"Now 900 kg"`. |
| `"@ 80\.0 kg"`, `"1\.3 reps"`, `"+380 kg"`, `/New PR/i` | Unchanged. |

New e2e to add (single test, golden case for the consistency claim):

- `"checked-only running volume: toggling a set's check updates Now, gap, and reps in lockstep"` — seed past 1,000 kg. Seed live sets: set #1 = 100×5 (DRAFT). Mount the slot, assert `Max 1,000 kg · Now 0 kg · To PR 1,000 kg · ≈ 10.0 reps @ 100.0 kg`. Then via the admin client UPDATE `sets.completed_at = now()` on set #1 and re-mount via `gotoLiveSession` (which purges cache + reloads). Assert `Max 1,000 kg · Now 500 kg · To PR 500 kg · ≈ 5.0 reps @ 100.0 kg`. (This is the literal arithmetic the user is being asked to mentally verify; the e2e proves it.)

### Manual smoke (Tester scope)

1. Live workout, fresh exercise: strip hidden (no-pr path).
2. Live workout, exercise with prior history: strip shows three metrics; Now = 0 kg before checking anything.
3. Type weight/reps into a set: Now stays at 0; reps clause appears (because `currentWeightKg` updates).
4. Check the set: Now jumps to volume; gap shrinks; reps clause reflects new gap. Arithmetic should literally add up on screen.
5. Uncheck the set: Now drops back; gap restores.
6. Toggle dark mode: contrast and `tabular-nums` rendering preserved.
7. VoiceOver / TalkBack: a11y label reads all three numbers.
8. iPhone SE width (320px) in browser: line wraps cleanly without overflowing the container.

## Riscos

- **Data integrity (RLS / migrations)**: zero. No schema change, no new query, no new cache key. The new `completed_at` filter reads a column already populated by `checkSet`/`uncheckSet` (`src/api/sets.ts:156-181`); RLS is scoped via the existing `["sets", sessionId]` query.
- **UX regression — F11 "drafts count" was intentional**: this is the deliberate reversal. Mitigation: documented in this design's Approach; user prompt explicitly requests it; the test suite captures the new semantics; the celebration path (surpassed) is unchanged so the motivational peak still feels the same.
- **UX regression — shared `<ExerciseBlock>`**: history detail does not mount the slot (`exercise-block.tsx:181-186` is the only call site and is gated by `showVolumeTarget`, which only the live screen passes). Verified by grep in the F11 Discovery; unchanged here. The new behaviour is entirely inside `<VolumeTargetSlot>`.
- **Cache mid-session staleness**: `useCheckSet`/`useUncheckSet` invalidate `["sets", sessionId]` (`src/hooks/use-sets.ts:99-100`). `setsByExercise` rebuilds → `<VolumeTargetSlot>` re-renders with a new `currentSessionSets` reference → `useMemo([progressQ.data, currentSessionSets])` re-runs → `sumLiveVolume` re-computes with the new check states. Verified end-to-end with no new wiring (Discovery #6).
- **`currentWeightKg` pick stays draft-inclusive**: documented and intentional (Decision #8). Risk: a user with a draft `80 kg` typed but never checked sees a `≈ X reps @ 80.0 kg` clause even though Now is 0 kg. This is the intended UX (the strip is about "what's the gap if I keep going at this weight?"); Validator should confirm.
- **Platform divergence (iOS / Android / web)**: zero. RN `Text` + NativeWind tokens + `tabular-nums` + middle-dot are all cross-platform. The single-line layout uses the same `<Text>` wrapping behaviour as the existing strip; iPhone SE wrap behaviour was acceptable before and remains so.
- **Performance — kernel cost**: `sumLiveVolume` adds one extra null check per row before the existing guards. `currentSessionSets.length` is bounded by the user's actual sets per exercise (typically ≤ 10). Sub-millisecond.
- **Performance — render cost**: the chasing render now has 3 inline `<Text>` children (Max, Now, To PR) instead of 1. RN inlines these into the same `<Text>` paragraph; no extra layout pass.
- **Accessibility — verbosity**: the new a11y label is longer (4 sentences vs 2). For users with screen readers this is the explicit tradeoff for the new information. Validator may push back; alternative wording in Alternatives.
- **Test churn**: 10 existing unit tests + 4 existing e2e tests need updates. The mechanical pattern (add `completed_at: ...` to `mkSet`, add `completedAt` to `seedLiveSet`) is small and uniform. Risk: a forgotten test produces a misleading red. Mitigation: the Test plan above enumerates every site.
- **Backward compatibility on the unit-test seed factory**: `mkSet` defaults `completed_at` to `null` — fine. No change to the factory; tests opt into "checked" by passing the timestamp explicitly. Same pattern used by the MAJ-1 regression test already.

## Alternativas descartadas

1. **(Alt to Approach (A)) Backward-compat: keep `runningKg` inclusive, show a separate "checked" number** — preserve F11's "drafts motivate" UX. Descartada porque the user prompt explicitly mandates checked-only for the new Now metric and re-introduces the perception bug (the displayed numbers don't add up) — exactly what this feature exists to fix. Also fragmentary: would require maintaining two parallel running-volume concepts (`runningKgInclusive` for gap math, `runningKgChecked` for display), doubling the kernel surface area for no user benefit.
2. **(Alt to Layout) Stacked rows** — three short rows: `"Max …"`, `"Now …"`, `"To PR …"`, plus a fourth `"≈ … reps @ …"`. Descartada porque vertical cost is ~60-80px per exercise × ~6-8 exercises = significant scroll-length increase, and the existing strip's single-line idiom (and its surrounding column-header row) already establishes "info bar = one line of `text-sm` with middle dots". `session-summary-row.tsx:56-65` and `volume-target-slot.tsx:80` are direct in-repo precedents.
3. **(Alt to Layout) Two-line: header row with three metrics, second row with the reps clause** — middle-ground. Descartada porque the reps clause is a *parenthetical extension* of the chasing state, not an equal-weight metric; demoting it to a separate row visually elevates it beyond its UX role. The single-line approach with a trailing `· ≈` separator (which the current strip already uses) reads naturally.
4. **(Alt to `no-pr`) Render `"Now Y kg"` even with no PR** — always-on running-volume display. Descartada porque (a) requires widening `VolumeTargetState["no-pr"]` to carry `runningKg`, (b) creates a useless N-row strip for every never-trained exercise in a brand-new user's workout, (c) the running set list already shows the same information row-by-row. If "always show Now" becomes a future requirement, a separate per-session header is a better surface.
5. **(Alt to `no-pr`) Render `"Max — · Now Y kg"` with em-dash for missing Max** — partial info. Descartada porque the em-dash is visually noisy and creates an asymmetric "the data shape says PR but the value is missing" UX that's worse than hiding the strip. Same reason as #4 in shorter form.
6. **(Alt to `surpassed`) Show `Max · Now · To PR` triplet on surpassed too** — uniform shape across all states. Descartada porque once `runningKg > previousMaxKg`, "To PR" is `≤ 0` and the natural copy ("0 kg" or "-380 kg") is either visually empty or semantically wrong. The celebratory single-line copy is stronger UX and is the existing behaviour. Validator can re-open if they disagree.
7. **(Alt to Decision #7) Add an `onlyChecked: boolean` parameter to a single `sumVolume` function** — DRY by signature instead of by two named helpers. Descartada porque (a) the boolean obscures the asymmetry between past and live semantics; (b) named helpers (`sumPastVolume` / `sumLiveVolume`) document the intent at the call site without comments; (c) the call-site count is 2 — naming wins over parameterization at this scale.
8. **(Alt to Decision #8) Make `currentWeightKg` also checked-only** — full consistency. Descartada porque (a) the "what weight am I on?" semantic is about *intent* (what the user is currently working at) not commitment (what they've banked); (b) most users only check at end of exercise, so the reps-clause would disappear for the entire first half of a working set's lifecycle, exactly when the motivation is most useful; (c) F11 already made this call and it survived MAJ-1 review.
9. **(Alt copy) `Best / Current / Gap`** — terser. Descartada porque (a) `Best` is ambiguous with "personal best" vs "best of session"; (b) `Gap` is vaguely engineering jargon; (c) `Max / Now / To PR` reuses the existing `PR` register and reads more naturally in a gym context.

## Out of scope

- Per-session aggregate (across exercises) "Max / Now / To PR" header.
- Showing the strip on history detail or per-exercise progress screens (still gated by the `showVolumeTarget` prop, only the live screen passes it).
- New cache invalidation on `useCheckSet` / `useUncheckSet` (the existing `["sets", sessionId]` invalidation cascades correctly — see Discovery #6).
- Editing the target weight manually.
- Polishing the "matched your previous best" copy.
- Range-bound previous-max ("best in last 90 days").
- PR-table denormalization / Postgres trigger.
- Notifications / haptics on PR achievement.
- Estimated-1RM-based targets.
- Cache-buster bump (N/A, no schema change).
- Batched `useExerciseMaxVolumes(ids[])` hook (F11 deferred this; still deferred).
- Updating `docs/data-model.md:67` (stale `completed_at NOT NULL` line) — separate doc-cleanup.
