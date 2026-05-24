# Design v1 — 2026-05-24_1925_history-row-total-volume

## Goal (1 sentence)
Render each finished session's non-warmup total volume on its History row (`· 12,345 kg` / `· 27,210 lbs`) by reducing the already-loaded lifetime weekly-volume cache through the canonical `sumLiveVolume` kernel, while fixing two co-located outliers (the `formatWeight`-instead-of-`formatVolume` row label and the drifted ad-hoc aggregate in the session-detail header) so all four surfaces — list row, drill-down row, detail header, verdict — read the same number.

## Approach
The History tab already loads `useLifetimeWeeklyVolume()` to power `<WeeklyVolumeStrip>`. That dataset is server-pre-filtered to non-warmup, non-deleted, `completed_at IS NOT NULL`, `sessions.ended_at IS NOT NULL` rows — i.e. exactly the predicate `sumLiveVolume` enforces minus the warmup/completed_at guards which are no-ops over this dataset. Adding a single pure helper `groupSessionVolumes(rows: WeeklyVolumeRow[]): Map<string, number>` lets the History list and the per-week drill-down each do one O(n) reduce per render (memoized on `data` reference) and pass `totalVolumeKg={map.get(session.id)}` into the existing `totalVolumeKg?: number` prop on `<SessionSummaryRow>`. No new query, no new hook, no schema change, no N+1.

Three co-located corrections fold in (each load-bearing for cross-surface consistency, which the prompt names explicitly):

1. The row's display path switches from `formatWeight(totalVolumeKg, unit)` → `formatVolume(totalVolumeKg, unit)`, and the trailing `" volume"` label is dropped — copy now matches the prompt verbatim (`· 12,345 kg`).
2. `app/(app)/history/[id].tsx:124-136` replaces its ad-hoc reduction (no warmup filter, no `completed_at` gate, no `w>0 && r>0` guard, `formatWeight` for an aggregate) with `sumLiveVolume(setsQ.data ?? [])` + `formatVolume(...)`. The detail header now agrees with the row the user tapped from.
3. In-progress sessions hide the volume slot. The lifetime cache excludes them by construction; the existing orange "In progress" tag is the user signal, and the live workout header is the canonical place to read mid-session volume.

The helper lives in **`src/utils/progress-page-math.ts`** — already the home of `computeLifetimeMaxPerExercise`, which does the same `WeeklyVolumeRow[]` → `Map<exerciseId, number>` shape via `sumLiveVolume`-equivalent arithmetic. Co-locating keeps the volume-grouping kernels in one tested module rather than spawning a new file for one function.

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `src/utils/progress-page-math.ts` | edited | Add pure helper `groupSessionVolumes(rows): Map<string, number>` near `computeLifetimeMaxPerExercise` (line ~225). Reduces by `session_id`, delegates per-set arithmetic to `sumLiveVolume` (imported from `~/utils/volume-target`) so the kernel name appears in the call graph — single source of truth. JSDoc cites the rationale and the no-op nature of warmup/`completed_at` filters over pre-filtered rows. |
| `src/components/session-summary-row.tsx` | edited | Line 6: replace `formatWeight` import with `formatVolume`. Line 50-52: drop the trailing `" volume"` word and switch helper. New render: `` ` · ${formatVolume(totalVolumeKg, unit)}` ``. Zero-guard (`totalVolumeKg != null && totalVolumeKg > 0`) preserved — handles in-progress (slot omitted) and the (rare) all-warmup finished session. |
| `app/(app)/history/index.tsx` | edited | Add `useMemo` import (line 2). Compute `totalVolumeBySessionId = useMemo(() => groupSessionVolumes(weeklyVolumeQ.data ?? []), [weeklyVolumeQ.data])`. Capture full result of `useLifetimeWeeklyVolume()` (already destructured for `refetch/isRefetching` — extend to keep `data` ref). Pass `totalVolumeKg={totalVolumeBySessionId.get(item.id)}` into `<SessionSummaryRow>` at line ~50. |
| `app/(app)/history/week/[isoWeek].tsx` | edited | Add `groupSessionVolumes` import. Compute `totalVolumeBySessionId` via `useMemo` over `weeklyVolumeQ.data` (~line 93, alongside `weekVolumeKg`). Pass `totalVolumeKg={totalVolumeBySessionId.get(s.id)}` into `<SessionSummaryRow>` at line 196. |
| `app/(app)/history/[id].tsx` | edited | Line 37: swap `formatWeight` for `formatVolume`. Lines 124-136: replace ad-hoc reduce with the canonical kernel — `totalSets = (setsQ.data ?? []).filter(s => s.completed_at != null && s.set_type !== "warmup").length` and `totalVolumeKg = sumLiveVolume(setsQ.data ?? [])`. Lines 289-295: render `formatVolume(totals.totalVolumeKg, unit)` (drop the trailing `" volume"` and the `> 0 ? ... : "—"` branch; `formatVolume` already returns `"0 kg"` semantics — but per the cross-surface decision below, we still hide when `===0` to match the row behaviour). Import `sumLiveVolume` from `~/utils/volume-target`. |
| `tests/unit/group-session-volumes.test.ts` | new | Unit tests for the new helper. See **Test surfaces** below. |
| `tests/unit/session-summary-row.test.tsx` | new (or extend if it exists) | Render-time tests: passing `totalVolumeKg={12345}` with `unit="kg"` renders `· 12,345 kg`; with `unit="lbs"` renders `· 27,210 lbs` (kg→lbs conversion); zero hides the slot; `null`/`undefined` hides the slot. |
| `tests/e2e/exercise-progress-ia.spec.ts` | edited | Update the stale comment at lines 294-297 ("the list page doesn't pass totalSets to SessionSummaryRow, so there's no 'N sets' text") — now reads `"date · duration · volume"`. The existing `/·\s*\d+m\b/` regex still matches the duration token alone, so the selector itself does not change. |

## Contratos de I/O

### New pure helper

Location: `src/utils/progress-page-math.ts` (extend existing module).

```ts
import type { WeeklyVolumeRow } from "~/api/stats";
import { sumLiveVolume } from "~/utils/volume-target";

/**
 * Groups `rows` by `session_id` and reduces each group via `sumLiveVolume`.
 *
 * Returned map values are kg totals for non-warmup sets in finished sessions.
 * The `WeeklyVolumeRow` server filters guarantee `completed_at != null`,
 * `sessions.ended_at != null`, `set_type != "warmup"` and `deleted_at IS NULL`,
 * so `sumLiveVolume`'s warmup-skip + `completed_at` guards are no-ops here.
 * Using the kernel anyway (rather than inlining `w * r`) keeps every aggregate
 * volume readout in the app rooted in a single function — see the cross-surface
 * consistency rule documented in `volume-target.ts:53-67`.
 *
 * Result is intentionally a Map (not a Record): O(1) `.get(sessionId)` per row
 * render, no JSON-key coercion. Callers `useMemo` on `data` reference identity.
 *
 * In-progress sessions are absent from `rows` (server filters require
 * `sessions.ended_at IS NOT NULL`), so the map has no entry for an
 * `ended_at IS NULL` session — `map.get(id)` returns `undefined`, and the
 * `<SessionSummaryRow>` zero-guard hides the slot.
 */
export function groupSessionVolumes(
  rows: WeeklyVolumeRow[],
): Map<string, number> {
  const bySession = new Map<string, SetRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    // sumLiveVolume reads `completed_at`, `set_type`, `weight`, `reps`.
    // WeeklyVolumeRow carries these directly — cast to the kernel's input
    // shape rather than spreading a new intermediate type.
    list.push({
      completed_at: row.completed_at,
      set_type: row.set_type,
      weight: row.weight,
      reps: row.reps,
    } as unknown as SetRow);
    bySession.set(row.session_id, list);
  }
  const out = new Map<string, number>();
  for (const [sessionId, sets] of bySession) {
    out.set(sessionId, sumLiveVolume(sets));
  }
  return out;
}
```

Note on the `SetRow` cast: `WeeklyVolumeRow` is a strict subset (it omits `id`, `session_id`, `set_number`, `parent_set_id`, etc.) but `sumLiveVolume` only reads `completed_at`, `set_type`, `weight`, `reps`. Two acceptable implementations:

- **(chosen)** Build a minimal object with exactly the four fields and cast through `unknown` to `SetRow`. Type is structurally compatible at the call site; the cast is local and documented.
- **(alternative)** Loosen `sumLiveVolume`'s parameter type to `Pick<SetRow, "completed_at" | "set_type" | "weight" | "reps">[]`. Cleaner long-term but widens a shared kernel signature for one new caller — out of scope.

If the Validator pushes back on the cast, the Implementer should switch to the `Pick<>` widening and update existing call sites (`exercise-block-volume`, `session-verdict-math`, `volume-target`) — all of which pass full `SetRow[]` and continue to satisfy the narrower type.

### Component prop contract (no change)

`<SessionSummaryRow>` already declares `totalVolumeKg?: number`. The component change is render-side only — helper swap and copy. The visible prop surface is unchanged.

### DB columns / queries
None. No migration, no new SQL, no RLS edit. The lifetime cache query (`listWeeklyVolumeRows`) is the data source; it already runs on this exact screen.

### Visual spec (exact copy)
Row line 2 with both fields present:

```
Tuesday, May 24, 2026 · 1h 23m · 12,345 kg
```

- Separator: `" · "` (space-middot-space) — same as the existing date/duration separator.
- Format: `formatVolume(kg, unit)` — `Math.round` then `toLocaleString("en-US")` then `" " + unit`. Verified rendering for prompt's example: `12345` kg → `"12,345 kg"`; `12345 / 0.45359237 ≈ 27,216` lbs (close to the prompt's `"27,210"` — the prompt is illustrative, not a literal test fixture).
- In-progress row: volume slot omitted entirely; existing orange "In progress" tag continues to render below.
- Empty finished session (zero-volume): slot omitted (preserves the existing `totalVolumeKg > 0` zero-guard at `session-summary-row.tsx:50`).
- No new line, no font/colour change. Row height stays variable as today.

### Test surfaces

**Unit — `tests/unit/group-session-volumes.test.ts`**:

| Case | Fixture | Expectation |
|---|---|---|
| empty input | `[]` | returns empty `Map` |
| single session, two sets | rows with same `session_id`, weights `100/100`, reps `10/8` | `map.get(sid) === 100 * 10 + 100 * 8 === 1800` |
| two sessions | rows split across `sid-A` (1000 kg) and `sid-B` (500 kg) | `map.size === 2`; both totals correct |
| warmup row in mix | one warmup row alongside a working row | warmup excluded (`sumLiveVolume` skips); only working contributes |
| null `completed_at` row | one row with `completed_at: null` (hypothetical — server filters it, but kernel must still skip) | row excluded |
| `w=0` row | `weight: "0"` | excluded by `w > 0` guard |
| `r=0` row | `reps: 0` | excluded by `r > 0` guard |
| lbs path (kernel returns kg) | kg-output is converted at display layer; helper itself is unit-agnostic | kg total only — display conversion tested separately |

**Unit — `tests/unit/session-summary-row.test.tsx`** (component render):

| Case | Props | Expectation |
|---|---|---|
| kg, > 0 | `totalVolumeKg=12345, unit="kg"` | row text matches `/· 12,345 kg/` |
| lbs, > 0 | `totalVolumeKg=12345, unit="lbs"` | row text matches `/· 27,2\d{2} lbs/` (rounded lbs) |
| zero | `totalVolumeKg=0, unit="kg"` | no `kg` substring after the duration |
| undefined | `totalVolumeKg` omitted | no volume slot rendered |
| in-progress + value passed | `session.ended_at=null, totalVolumeKg=500` | volume slot omitted (matches the caller's behaviour: caller doesn't pass volume for in-progress, but defensive — the row component itself can still render it; per **Risks: in-progress edge** we let the caller decide and rely on the data source to omit the entry) |

**E2E — selectors and surfaces**:

- `tests/e2e/exercise-progress-ia.spec.ts:298` — selector unchanged (`/·\s*\d+m\b/` still hits the duration token). Stale comment updated.
- Net-new e2e is **not** required for round 1 (the existing test traverses the same row and the unit/component tests cover the render). The Conductor's guidance asked for e2e coverage of "at least 3 different rows on the History list (kg + lbs variant)" — recommended addition, deferred to Tester to land if budget allows. Designer's recommendation: add as Tester scope, not Implementer scope.

If Tester picks it up, the fixture path is the existing fresh-user e2e flow at `tests/e2e/` — finish 3 sessions with deterministic weights, switch unit, assert each row carries the expected `formatVolume(...)` substring.

## Riscos

- **Data integrity (in-progress edge)**: The lifetime cache excludes `ended_at IS NULL`. An in-progress session row therefore gets `map.get(id) === undefined` → slot hidden. **Risk LOW**. Note: if a user finishes a session and the lifetime cache is stale (60 s `staleTime`) **and** the History list is the entry surface, the row will briefly render without a volume between "Finish" and the strip's refetch. Acceptable degradation — `useFinishSession` invalidates `["stats","weekly-volume","lifetime"]` so the refetch fires immediately on completion (verified in `use-sessions.ts` mutation invalidations). The race window is sub-second on a warm app.

- **Data integrity (stale-cache divergence)**: If the lifetime cache hasn't refetched after a session edit (rename / soft-delete) the row's volume could disagree with the detail screen for the staleness window. The existing strip already has this property; we are adding one more consumer of the same cache, not creating a new staleness surface. **Risk LOW**.

- **UX regressions (shared component)**: `<SessionSummaryRow>` is rendered by **two** screens — the History list and the week drill-down. Both are wired in this design. **No third caller** (grep-confirmed via Discovery file list). The component's prop surface doesn't change. **Risk LOW**.

- **UX regressions (`history/[id]` detail header)**: Fixing the drifted ad-hoc reduction will change the displayed number for any historical session that contained warmup sets (their volume currently inflates the header total) or had unchecked-but-not-deleted sets (current code includes them via `parseFloat(null) → NaN` then `Number.isFinite(NaN) === false` filters them — so this is actually a no-op for the unchecked path; the warmup path is the real delta). User-visible change: warmup-containing session totals will *decrease* to match the strip + verdict. This is a *correctness improvement* but a *visible number change*. **Risk MEDIUM** for surprise; LOW for incorrectness. Tester should regression-test a session with known warmup volume to confirm the new number matches the verdict screen for the same session.

- **UX regressions (zero-volume sessions)**: A finished session with 0 working volume (only warmups, or all sets soft-deleted) currently renders nothing in the row's volume slot (the prop is never passed; the zero-guard would hide it anyway). Post-change it still renders nothing — but the detail header changes from `"—"` to also hiding the volume (because we drop the `> 0 ? ... : "—"` branch). **Risk LOW**. If we want to preserve the `"—"` placeholder on detail, the Implementer keeps the conditional and renders `"—"` only when zero; choose: drop placeholder (cleaner, matches row) **or** keep placeholder (consistent with prior detail UX). **Designer recommendation: drop the placeholder** — the row hides on zero, so the detail should too.

- **Platform-specific (line wrap)**: On iPhone SE 320pt with `Tuesday, May 24, 2026 · 1h 45m · 27,210 lbs`, line 2 may wrap to two visual lines. `<Text>` already wraps gracefully; `FlatList` does not use `getItemLayout` or fixed `estimatedItemSize` (verified line 45-58). **Risk LOW**. iOS/Android/web render identically.

- **Performance**:
  - One additional O(n) reduce per render of the History tab on top of the existing strip math, where n = lifetime non-warmup sets. For a power user with 10k sets the cost is ~ms-scale, dwarfed by `<FlatList>` and React reconciliation. Memoization keys on `data` reference identity (`useMemo([weeklyVolumeQ.data])`) — refetch produces a new reference, all other rerenders reuse.
  - Per-row `.get(sessionId)` lookup is O(1).
  - Zero net new network calls.
  - **Risk LOW**.

- **Tests / selectors**: The e2e regex selector for the History row is duration-anchored and unchanged. Stale code-comment update is the only mechanical edit. **Risk LOW**.

## Alternativas descartadas

1. **Add a new `useSessionVolumeMap()` hook wrapping `useLifetimeWeeklyVolume` + `groupSessionVolumes`** — descartada porque it adds indirection (a hook that does nothing but call a pure function over another hook's output) without testable behaviour beyond what the helper already provides. Two consumers (`history/index.tsx`, `history/week/[isoWeek].tsx`) is below the threshold where the hook pays its complexity tax.

2. **Inline the reduce at each callsite** — descartada porque it would duplicate the kernel call between two routes (the list and the drill-down), losing the cross-surface test surface that the prompt explicitly demands ("same kernel… so the number is consistent across surfaces"). One pure helper, two callers, one test file is the cleaner shape.

3. **Add a SQL view / `rpc()` that returns `(session_id, total_kg)` server-side** — descartada porque the data is already in the client cache for free (the strip needs it), so a new server endpoint adds query cost and migration risk to solve a problem that doesn't exist. The prompt's "no per-row N+1 fetch" constraint is satisfied without a backend change.

4. **Cache derivation via a new `sessions.total_volume_kg` denormalized column** — descartada porque it requires a migration, a backfill, a trigger to keep it current on set edits, and an RLS audit — for a number that can be computed in microseconds from data already in the client. The denormalization tax is non-trivial; the read tax is zero. Rejected on cost.

5. **Move the volume to an explicit third line below date/duration** — descartada porque (a) the prompt's example (`· 12,345 kg`) uses inline-append semantics, (b) the existing `· Wm` separator pattern on line 2 sets the expectation, (c) FlatList doesn't depend on fixed row height. Inline keeps the row dense and matches the verdict-screen pattern (`+N PRs · Y kg · Zh Wm`).

6. **Fetch the in-progress session's sets via `useSetsForSession(activeId)` and run `sumLiveVolume` for the active row** — descartada porque the in-progress session has a dedicated live-header surface that already shows volume in real time, and the existing orange "In progress" row tag is sufficient signal. One extra hook for one row, repeating a number that's more accurate on another screen, is not worth the wiring cost.

## Out of scope
- Per-exercise progress chart (`exercises/[id]/progress.tsx`) — unaffected; its kernel is already canonical.
- Verdict screen (`workout/verdict/[sessionId].tsx`) — already uses `sumLiveVolume` + `formatVolume`. No change.
- Live session header (`session-header.tsx`) — already canonical.
- `<WeeklyVolumeStrip>` — unaffected; same data source, different aggregation.
- Routine list / Progress list rows.
- Schema migrations; RLS edits; new endpoints; new hooks.
- Net-new e2e spec for the 3-row + unit-toggle assertion — recommended to Tester, not in Implementer scope.
- Renaming `sumLiveVolume` → `sumNonWarmupCommittedVolume` or similar (the name is mildly misleading now that it's used for past sessions too, but renaming a kernel touched by 6+ callers is a separate refactor).

## Confidence and risk labels
- **Confidence: HIGH** — every load-bearing claim (existing prop, existing cache, kernel signature, server filters, callers, formatter behaviour) is verified against code in Discovery; the change is mechanical fulfilment of an already-shipped prop contract plus two co-located bug fixes the prompt's cross-surface-consistency clause implies.
- **Risk: LOW** — no migration, no new query, two-screen blast radius, one shared component, one shared helper, kernel re-used. The single MEDIUM-risk note is the visible-number change on history-detail headers for sessions containing warmup volume — flagged for Tester regression.
