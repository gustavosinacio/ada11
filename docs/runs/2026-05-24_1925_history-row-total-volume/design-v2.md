# Design v2 — 2026-05-24_1925_history-row-total-volume

## Diff from v1

Resposta direta a cada finding do Validator (`validation-v1.md`). Cada item abaixo é uma mudança concreta em relação a v1 — o design completo restated abaixo já incorpora todos eles.

1. **MAJ-1 (fix)** — substituída a tentativa de teste `.tsx` de render do `<SessionSummaryRow>` por um arquivo `tests/unit/session-summary-row-format.test.ts` que exercita um **presenter puro** novo: `presentSessionVolumeSlot(totalVolumeKg, unit) → string | null`. O presenter é extraído para `src/utils/session-row-format.ts` e consumido pelo `<SessionSummaryRow>`. Espelha o precedente de `tests/unit/session-header-total-volume.test.ts` (sem RNTL, sem `.tsx`; `vitest.config.ts:11` só inclui `tests/unit/**/*.test.ts`).

2. **MAJ-2 (fix)** — pinada UMA única forma para o ramo zero-volume no detail header em `app/(app)/history/[id].tsx:289-295`:
   - Mantém o ternary existente `total > 0 ? formatVolume(total, unit) : "—"`.
   - Troca o helper de `formatWeight` → `formatVolume`.
   - Remove a palavra final `" volume"` do `<Text>`.
   - Resultado verbatim: positivo → `"Total: 3 sets · 12,345 kg"`; zero → `"Total: 3 sets · —"`.
   - A v1 dizia "drop a `> 0 ? ... : "—"` branch" e simultaneamente "still hide when `===0`" — auto-contraditório. v2 cancela essa instrução e mantém o ternary.

3. **MIN-1 (fix)** — Visual-spec atualizado para o output real de `formatDisplayDate(..., { includeWeekday: true })`: weekday curto, mês abreviado, sem ano (current-year). Exemplo correto: `"Sat, May 24 · 1h 23m · 12,345 kg"` (não `"Tuesday, May 24, 2026 …"`). Verificado em `src/utils/format-display-date.ts:94-108` — `weekday: "short"`, `month: "short"`, `year` apenas quando `getFullYear() !== new Date().getFullYear()`.

4. **MIN-2 (fix)** — Adicionada linha em **Riscos** reconhecendo o flicker de cold-cache: na primeira renderização sem cache aquecido, as linhas aparecem sem o slot de volume até `weeklyVolumeQ` resolver. Como o slot é opcional/condicional, a degradação é graciosa (não há shift de layout porque o `<Text>` simplesmente cresce ao final da linha 2).

5. **MIN-3 (fix)** — Adicionada uma linha em **Out of scope**: `useMaxVolumeWindowWeeks` NÃO se aplica a totais de linha do histórico — totais por sessão são fatos históricos absolutos, não agregados "best-of-N-weeks".

6. **MIN-4 (acknowledged)** — A citação de linha agora é precisa: o template literal `${formatWeight(...)}` está em `session-summary-row.tsx:51`; a guarda `totalVolumeKg != null && totalVolumeKg > 0` está em `:50`. Mudança puramente cosmética nas referências.

7. **MIN-5 (fix)** — `Pick<>` widening preferido sobre `as unknown as SetRow`. `sumLiveVolume` em `src/utils/volume-target.ts:88` passa a aceitar `Pick<SetRow, "completed_at" | "set_type" | "weight" | "reps">[]`. Todos os call sites atuais passam `SetRow[]` (que satisfaz o tipo mais estreito por estrutura), portanto nenhuma migração de callsite é necessária. Remove o cast em `groupSessionVolumes`. Verificados os callers de `sumLiveVolume` (`volume-target.ts` interno; `session-verdict-math.ts`; `session-header.tsx`; o teste `session-header-total-volume.test.ts`) — todos passam `SetRow[]`, todos continuam compilando.

---

## Goal (1 sentence)
Render each finished session's non-warmup total volume on its History row (`· 12,345 kg` / `· 27,210 lbs`) by reducing the already-loaded lifetime weekly-volume cache through the canonical `sumLiveVolume` kernel, while fixing two co-located outliers (the `formatWeight`-instead-of-`formatVolume` row label and the drifted ad-hoc aggregate in the session-detail header) so all four surfaces — list row, drill-down row, detail header, verdict — read the same number.

## Approach
The History tab already loads `useLifetimeWeeklyVolume()` to power `<WeeklyVolumeStrip>`. That dataset is server-pre-filtered to non-warmup, non-deleted, `completed_at IS NOT NULL`, `sessions.ended_at IS NOT NULL` rows — i.e. exactly the predicate `sumLiveVolume` enforces minus the warmup/`completed_at` guards which are no-ops over this dataset. Adding a single pure helper `groupSessionVolumes(rows): Map<string, number>` lets the History list and the per-week drill-down each do one O(n) reduce per render (memoized on `data` reference) and pass `totalVolumeKg={map.get(session.id)}` into the existing `totalVolumeKg?: number` prop on `<SessionSummaryRow>`. No new query, no new hook, no schema change, no N+1.

Three co-located corrections fold in (each load-bearing for cross-surface consistency, which the prompt names explicitly):

1. The row's display path switches from `formatWeight(totalVolumeKg, unit)` → `formatVolume(totalVolumeKg, unit)`, and the trailing `" volume"` label is dropped — copy now matches the prompt verbatim (`· 12,345 kg`). Internally the row delegates the suffix decision to a new pure presenter `presentSessionVolumeSlot(totalVolumeKg, unit)` so the format is independently testable.
2. `app/(app)/history/[id].tsx:124-136` replaces its ad-hoc reduction (no warmup filter, no `completed_at` gate, no `w>0 && r>0` guard, `formatWeight` for an aggregate) with `sumLiveVolume(setsQ.data ?? [])` + `formatVolume(...)`. The detail header line 289-295 keeps its existing `> 0 ? ... : "—"` ternary, swaps `formatWeight`→`formatVolume`, and drops the trailing word `" volume"` — see MAJ-2 fix above.
3. In-progress sessions hide the volume slot. The lifetime cache excludes them by construction; the existing orange "In progress" tag is the user signal, and the live workout header is the canonical place to read mid-session volume.

The grouping helper lives in **`src/utils/progress-page-math.ts`** — already the home of `computeLifetimeMaxPerExercise`, which does the same `WeeklyVolumeRow[]` → `Map<key, number>` shape via `sumLiveVolume`-equivalent arithmetic. The presenter helper lives in a new, tiny module `src/utils/session-row-format.ts` (kept separate from `units.ts` so the test can exercise just the slot composition without dragging the conversion table into scope; mirrors the small-pure-utility pattern of `format-display-date.ts`).

To make `groupSessionVolumes` interoperate with `sumLiveVolume` cleanly, the kernel's parameter type is widened from `SetRow[]` to `Pick<SetRow, "completed_at" | "set_type" | "weight" | "reps">[]`. The kernel reads exactly those four fields (verified `volume-target.ts:88-100`); existing callers passing `SetRow[]` remain assignable.

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `src/utils/volume-target.ts` | edited | Widen `sumLiveVolume`'s parameter: `sets: SetRow[]` → `sets: Pick<SetRow, "completed_at" \| "set_type" \| "weight" \| "reps">[]`. Body unchanged. Existing callers (full `SetRow[]`) continue to satisfy the narrower input by structural typing. One responsibility: relax the kernel input contract. |
| `src/utils/progress-page-math.ts` | edited | Add pure helper `groupSessionVolumes(rows: WeeklyVolumeRow[]): Map<string, number>` near `computeLifetimeMaxPerExercise` (line ~225). Reduces by `session_id`, delegates per-set arithmetic to `sumLiveVolume` (imported from `~/utils/volume-target`) — single source of truth. JSDoc cites the rationale and the no-op nature of the warmup/`completed_at` filters over pre-filtered rows. Now that `sumLiveVolume` accepts the `Pick<>` shape, no cast is required — `WeeklyVolumeRow` is assignable directly (its four required fields all match the Pick keys). One responsibility: add the new pure aggregation. |
| `src/utils/session-row-format.ts` | new | Tiny module exporting `presentSessionVolumeSlot(totalVolumeKg: number \| null \| undefined, unit: WeightUnit): string \| null`. Returns `null` when `totalVolumeKg == null` or `totalVolumeKg <= 0`; otherwise returns `" · ${formatVolume(totalVolumeKg, unit)}"` (note the leading space-middot-space — matches the row's existing separator pattern). Pure, no React. One responsibility: encapsulate the visibility + format decision so it is testable in `.test.ts`. |
| `src/components/session-summary-row.tsx` | edited | Replace `formatWeight` import with `presentSessionVolumeSlot` from `~/utils/session-row-format` (the new helper imports `formatVolume` itself; the row no longer touches `formatVolume` directly). Lines 50-52: replace the inline ternary with `{presentSessionVolumeSlot(totalVolumeKg, unit) ?? ""}`. Drops the trailing `" volume"` word. Behaviour for `undefined`/`null`/`0` is unchanged (slot omitted); for positive, copy becomes `· 12,345 kg`. One responsibility: consume the new presenter and stop hard-coding the suffix. |
| `app/(app)/history/index.tsx` | edited | Add `useMemo` import (line 2). Add `groupSessionVolumes` import from `~/utils/progress-page-math`. Retain destructuring of `useLifetimeWeeklyVolume()` to expose `data`. Compute `totalVolumeBySessionId = useMemo(() => groupSessionVolumes(weeklyVolumeQ.data ?? []), [weeklyVolumeQ.data])`. Pass `totalVolumeKg={totalVolumeBySessionId.get(item.id)}` into `<SessionSummaryRow>` at line ~50. One responsibility: wire the per-session map into the row prop. |
| `app/(app)/history/week/[isoWeek].tsx` | edited | Add `groupSessionVolumes` import. Compute `totalVolumeBySessionId` via `useMemo` over `weeklyVolumeQ.data` (~line 93, alongside `weekVolumeKg`). Pass `totalVolumeKg={totalVolumeBySessionId.get(s.id)}` into `<SessionSummaryRow>` at line 196. One responsibility: same wiring as the list, applied to the drill-down. |
| `app/(app)/history/[id].tsx` | edited | Line 37: swap `formatWeight` for `formatVolume` import. Lines 124-136: replace ad-hoc reduce with the canonical kernel — `totalSets = (setsQ.data ?? []).filter(s => s.completed_at != null && s.set_type !== "warmup").length` and `totalVolumeKg = sumLiveVolume(setsQ.data ?? [])`. Lines 289-295: **keep the `> 0 ? ... : "—"` ternary; swap `formatWeight(totals.totalVolumeKg, unit)` → `formatVolume(totals.totalVolumeKg, unit)`; drop the trailing word `" volume"`**. Final render: positive → `"Total: 3 sets · 12,345 kg"`; zero → `"Total: 3 sets · —"`. Import `sumLiveVolume` from `~/utils/volume-target`. Two responsibilities here (kernel swap + label format) — justified because they are the same correctness fix on the same `<Text>` block and splitting them would leave the screen in a transitional state for one PR. |
| `tests/unit/group-session-volumes.test.ts` | new | Unit tests for the new helper. See **Test surfaces** below. |
| `tests/unit/session-summary-row-format.test.ts` | new | Unit tests for the new pure presenter `presentSessionVolumeSlot`. Mirrors `tests/unit/session-header-total-volume.test.ts` shape. See **Test surfaces**. |
| `tests/e2e/exercise-progress-ia.spec.ts` | edited | Update the stale comment at lines 294-297 (note: row now exposes "date · duration · volume"). The existing `/·\s*\d+m\b/` regex still matches the duration token alone, so the selector itself does not change. |

## Contratos de I/O

### Kernel widening — `src/utils/volume-target.ts`

```ts
import type { SetRow } from "~/db/types";

export function sumLiveVolume(
  sets: Pick<SetRow, "completed_at" | "set_type" | "weight" | "reps">[],
): number {
  let total = 0;
  for (const s of sets) {
    if (s.completed_at == null) continue;
    if (s.set_type === "warmup") continue;
    const w = s.weight ? parseFloat(s.weight) : NaN;
    const r = s.reps ?? 0;
    if (Number.isFinite(w) && w > 0 && r > 0) {
      total += w * r;
    }
  }
  return total;
}
```

Compatibility: `SetRow[]` is structurally assignable to `Pick<SetRow, …>[]` because `SetRow` carries all four fields with matching types. Callers verified:

- `src/utils/volume-target.ts:144` — local call, passes `currentSessionSets: SetRow[]`. OK.
- `src/utils/session-verdict-math.ts` — passes `SetRow[]`. OK.
- `src/components/session-header.tsx` (consumed via the verdict / live header paths) — passes `SetRow[]`. OK.
- `tests/unit/session-header-total-volume.test.ts` — passes `SetRow[]` via `mkSet()`. OK.

### New pure presenter — `src/utils/session-row-format.ts`

```ts
import type { WeightUnit } from "~/db/types";
import { formatVolume } from "~/utils/units";

/**
 * Returns the suffix to append to the row's line-2 text when a session
 * has a positive total volume; returns `null` to indicate the slot
 * should be omitted entirely.
 *
 * The leading `" · "` separator is included in the returned string so the
 * caller can do `{presentSessionVolumeSlot(v, u) ?? ""}` without any
 * additional whitespace logic. Matches the line-2 separator pattern in
 * `<SessionSummaryRow>` (date · duration · volume).
 *
 * Pure — no React, no hooks. Testable directly with vitest.
 */
export function presentSessionVolumeSlot(
  totalVolumeKg: number | null | undefined,
  unit: WeightUnit,
): string | null {
  if (totalVolumeKg == null) return null;
  if (totalVolumeKg <= 0) return null;
  return ` · ${formatVolume(totalVolumeKg, unit)}`;
}
```

### New pure helper — `src/utils/progress-page-math.ts`

```ts
import type { WeeklyVolumeRow } from "~/api/stats";
import { sumLiveVolume } from "~/utils/volume-target";

/**
 * Groups `rows` by `session_id` and reduces each group via `sumLiveVolume`.
 *
 * Returned map values are kg totals for non-warmup sets in finished sessions.
 * `WeeklyVolumeRow` server filters guarantee `completed_at != null`,
 * `sessions.ended_at != null`, `set_type != "warmup"`, and `deleted_at IS NULL`,
 * so `sumLiveVolume`'s warmup-skip + `completed_at` guards are no-ops here.
 * Using the kernel anyway (rather than inlining `w * r`) keeps every aggregate
 * volume readout rooted in a single function — see the cross-surface
 * consistency rule documented in `volume-target.ts:53-67`.
 *
 * Result is a Map (not a Record): O(1) `.get(sessionId)` per row render, no
 * JSON-key coercion. Callers `useMemo` on `data` reference identity.
 *
 * In-progress sessions are absent from `rows` (server filters require
 * `sessions.ended_at IS NOT NULL`), so the map has no entry for an
 * `ended_at IS NULL` session — `map.get(id)` returns `undefined`, and the
 * `<SessionSummaryRow>` presenter hides the slot.
 *
 * `sumLiveVolume` accepts the `Pick<SetRow, ...>` shape that `WeeklyVolumeRow`
 * structurally satisfies, so no cast is needed at the call site.
 */
export function groupSessionVolumes(
  rows: WeeklyVolumeRow[],
): Map<string, number> {
  const bySession = new Map<string, WeeklyVolumeRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(row);
    bySession.set(row.session_id, list);
  }
  const out = new Map<string, number>();
  for (const [sessionId, sets] of bySession) {
    out.set(sessionId, sumLiveVolume(sets));
  }
  return out;
}
```

### Component prop contract (no change)

`<SessionSummaryRow>` already declares `totalVolumeKg?: number`. The component change is render-side only — replace the inline format expression with the presenter call. The visible prop surface is unchanged.

### Detail-screen render contract — `app/(app)/history/[id].tsx:289-295`

Pinned form (verbatim — MAJ-2):

```tsx
<Text className="mt-0.5 text-sm text-gray-500">
  Total: {totals.totalSets} {totals.totalSets === 1 ? "set" : "sets"} ·{" "}
  {totals.totalVolumeKg > 0
    ? formatVolume(totals.totalVolumeKg, unit)
    : "—"}
</Text>
```

Positive case: `"Total: 3 sets · 12,345 kg"`. Zero case: `"Total: 3 sets · —"`. The trailing word `" volume"` is removed; the `> 0 ? formatVolume(…) : "—"` ternary is preserved.

### DB columns / queries

None. No migration, no new SQL, no RLS edit. The lifetime cache query (`listWeeklyVolumeRows`) is the data source; it already runs on this exact screen.

### Visual spec (exact copy)

Row line 2 with both fields present (current year, en-US locale):

```
Sat, May 24 · 1h 23m · 12,345 kg
```

Out-of-current-year session, lbs unit:

```
Fri, Nov 8, 2019 · 1h 23m · 27,214 lbs
```

- Separator: `" · "` (space-middot-space) — same as the existing date/duration separator.
- Date format: `formatDisplayDate(session.started_at, { includeWeekday: true })` — verified output at `format-display-date.ts:94-108`. Short weekday, short month, year suffix only when not current local year.
- Volume format: `formatVolume(kg, unit)` — `Math.round` then `toLocaleString("en-US")` then `" " + unit`.
- In-progress row: volume slot omitted entirely; existing orange "In progress" tag continues to render below.
- Empty finished session (zero-volume): slot omitted (presenter returns `null` on `<= 0`).
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
| dropset counted | one `set_type: "dropset"` working row | included (matches kernel rule) |

**Unit — `tests/unit/session-summary-row-format.test.ts`** (pure presenter, no React, no RNTL):

| Case | Input | Expectation |
|---|---|---|
| undefined | `presentSessionVolumeSlot(undefined, "kg")` | `null` |
| null | `presentSessionVolumeSlot(null, "kg")` | `null` |
| zero | `presentSessionVolumeSlot(0, "kg")` | `null` |
| negative (defensive) | `presentSessionVolumeSlot(-5, "kg")` | `null` |
| positive kg, five-digit | `presentSessionVolumeSlot(12345, "kg")` | `" · 12,345 kg"` |
| positive lbs (conversion) | `presentSessionVolumeSlot(12344, "lbs")` | `" · 27,214 lbs"` (matches the audit fixture in `session-header-total-volume.test.ts:202`) |
| sub-thousand kg | `presentSessionVolumeSlot(500, "kg")` | `" · 500 kg"` |
| separator shape | result for any positive | starts with the literal `" · "` (space-middot-space), matches the row separator pattern |

Mirrors `tests/unit/session-header-total-volume.test.ts` (vitest, no RNTL, pure-format assertions only). Executes under the existing `vitest.config.ts:11` `include: ["tests/unit/**/*.test.ts"]` glob.

**E2E — selectors and surfaces**:

- `tests/e2e/exercise-progress-ia.spec.ts:298` — selector unchanged (`/·\s*\d+m\b/` still hits the duration token). Stale comment updated to reflect the new row shape.
- Net-new e2e is **not** required in this round — the existing test traverses the same row and the unit-level presenter test covers the render contract. The Conductor's optional "3-row + unit-toggle" e2e remains a Tester-scope nice-to-have.

## Riscos

- **Data integrity (in-progress edge)**: The lifetime cache excludes `ended_at IS NULL`. An in-progress session row therefore gets `map.get(id) === undefined` → slot hidden. **Risk LOW**. If a user finishes a session and the lifetime cache is stale (60 s `staleTime`) **and** the History list is the entry surface, the row briefly renders without a volume between "Finish" and the strip's refetch. Acceptable degradation — `useFinishSession` invalidates `["stats","weekly-volume","lifetime"]` so the refetch fires immediately on completion. The race window is sub-second on a warm app.

- **Data integrity (stale-cache divergence)**: If the lifetime cache hasn't refetched after a session edit (rename / soft-delete) the row's volume could disagree with the detail screen for the staleness window. The existing strip already has this property; we are adding one more consumer of the same cache, not creating a new staleness surface. **Risk LOW**.

- **Loading flicker (cold cache)**: On the very first render of the History tab — before `weeklyVolumeQ` resolves — rows render with date · duration only (no volume slot). When the query lands, rows re-render with the appended `· 12,345 kg`. The slot is optional/conditional so the change is graceful: no layout-shift jump because the `<Text>` simply grows at the end of line 2; no skeleton needed. **Risk LOW**. Same pattern as the strip itself, which already lives on this screen.

- **UX regressions (shared component)**: `<SessionSummaryRow>` is rendered by **two** screens — the History list and the week drill-down. Both are wired in this design. **No third caller** (grep-confirmed via Discovery). The component's prop surface doesn't change. **Risk LOW**.

- **UX regressions (`history/[id]` detail header)**: Fixing the drifted ad-hoc reduction will change the displayed number for any historical session that contained warmup sets (their volume currently inflates the header total) or had unchecked-but-not-deleted sets (current code includes them via `parseFloat(null) → NaN` then `Number.isFinite(NaN) === false` filters them — so this is actually a no-op for the unchecked path; the warmup path is the real delta). User-visible change: warmup-containing session totals will *decrease* to match the strip + verdict. This is a *correctness improvement* but a *visible number change*. **Risk MEDIUM** for surprise; LOW for incorrectness. Tester should regression-test a session with known warmup volume to confirm the new number matches the verdict screen for the same session.

- **UX regressions (zero-volume sessions)**: A finished session with 0 working volume (only warmups, or all sets soft-deleted) currently renders nothing in the row's volume slot (the prop is never passed; the presenter would hide it anyway). Post-change still renders nothing. On the detail header, zero stays rendered as `"—"` (ternary preserved per MAJ-2). **Risk LOW**.

- **Platform-specific (line wrap)**: On iPhone SE 320pt with `Fri, Nov 8, 2019 · 1h 45m · 27,214 lbs`, line 2 may wrap to two visual lines. `<Text>` already wraps gracefully; `FlatList` does not use `getItemLayout` or fixed `estimatedItemSize` (verified `history/index.tsx:45-58`). **Risk LOW**. iOS/Android/web render identically.

- **Performance**:
  - One additional O(n) reduce per render of the History tab on top of the existing strip math, where n = lifetime non-warmup sets. For a power user with 10k sets the cost is ~ms-scale, dwarfed by `<FlatList>` and React reconciliation. Memoization keys on `data` reference identity (`useMemo([weeklyVolumeQ.data])`) — refetch produces a new reference; all other rerenders reuse the prior Map.
  - Per-row `.get(sessionId)` lookup is O(1).
  - Zero net new network calls.
  - **Risk LOW**.

- **Kernel widening (`Pick<>` migration)**: Changing `sumLiveVolume`'s signature from `SetRow[]` to `Pick<SetRow, "completed_at" | "set_type" | "weight" | "reps">[]` is structurally compatible with every existing caller (`SetRow[]` satisfies the Pick by inclusion). If a future caller passes an object with a *narrower* set of fields, it now compiles where it would not before — but the kernel only reads those four fields, so semantically nothing changes. **Risk LOW**. Implementer should run `tsc --noEmit` to confirm zero callsite breakage.

- **Tests / selectors**: The e2e regex selector for the History row is duration-anchored and unchanged. Stale code-comment update is the only mechanical edit. **Risk LOW**.

## Alternativas descartadas

1. **Add a new `useSessionVolumeMap()` hook wrapping `useLifetimeWeeklyVolume` + `groupSessionVolumes`** — descartada porque adds indirection (a hook that does nothing but call a pure function over another hook's output) without testable behaviour beyond what the helper already provides. Two consumers (`history/index.tsx`, `history/week/[isoWeek].tsx`) is below the threshold where the hook pays its complexity tax.

2. **Inline the reduce at each callsite** — descartada porque would duplicate the kernel call between two routes (the list and the drill-down), losing the cross-surface test surface that the prompt explicitly demands ("same kernel… so the number is consistent across surfaces"). One pure helper, two callers, one test file is the cleaner shape.

3. **Add a SQL view / `rpc()` that returns `(session_id, total_kg)` server-side** — descartada porque the data is already in the client cache for free (the strip needs it), so a new server endpoint adds query cost and migration risk to solve a problem that doesn't exist. The prompt's "no per-row N+1 fetch" constraint is satisfied without a backend change.

4. **Cache derivation via a new `sessions.total_volume_kg` denormalized column** — descartada porque requires a migration, a backfill, a trigger to keep it current on set edits, and an RLS audit — for a number that can be computed in microseconds from data already in the client. The denormalization tax is non-trivial; the read tax is zero.

5. **Move the volume to an explicit third line below date/duration** — descartada porque (a) the prompt's example (`· 12,345 kg`) uses inline-append semantics, (b) the existing `· Wm` separator pattern on line 2 sets the expectation, (c) FlatList doesn't depend on fixed row height. Inline keeps the row dense and matches the verdict-screen pattern (`+N PRs · Y kg · Zh Wm`).

6. **Fetch the in-progress session's sets via `useSetsForSession(activeId)` and run `sumLiveVolume` for the active row** — descartada porque the in-progress session has a dedicated live-header surface that already shows volume in real time, and the existing orange "In progress" row tag is sufficient signal. One extra hook for one row, repeating a number that's more accurate on another screen, is not worth the wiring cost.

7. **Keep `sumLiveVolume`'s `SetRow[]` signature and cast `WeeklyVolumeRow` via `as unknown as SetRow`** — descartada (v1 proposal, rejected by MIN-5). The cast was tolerable but flagged for cleanup; the `Pick<>` widening is a single-file edit that removes the cast permanently and accurately reflects the kernel's actual read set.

8. **Inline `presentSessionVolumeSlot` logic directly inside `<SessionSummaryRow>`** — descartada porque the test plan requires a `.test.ts` (vitest config excludes `.tsx`; no RNTL in repo). Extracting to a pure module is the only way to land MAJ-1's mandate without dragging in an RNTL stack out-of-scope.

## Out of scope

- Per-exercise progress chart (`exercises/[id]/progress.tsx`) — unaffected; its kernel is already canonical.
- Verdict screen (`workout/verdict/[sessionId].tsx`) — already uses `sumLiveVolume` + `formatVolume`. No change.
- Live session header (`session-header.tsx`) — already canonical.
- `<WeeklyVolumeStrip>` — unaffected; same data source, different aggregation.
- Routine list / Progress list rows.
- Schema migrations; RLS edits; new endpoints; new hooks.
- Net-new e2e spec for the 3-row + unit-toggle assertion — recommended to Tester, not in Implementer scope.
- Renaming `sumLiveVolume` → `sumNonWarmupCommittedVolume` or similar (the name is mildly misleading now that it's used for past sessions too, but renaming a kernel touched by 6+ callers is a separate refactor).
- **`useMaxVolumeWindowWeeks` does NOT apply to history-row totals** — per-session totals are absolute historical facts, not "best-of-N-weeks" aggregates. The window setting governs PR comparison (`computeVolumeTarget`), not per-row labels.

## Resposta a issues do Validator

- **MAJ-1**: Endereçado. New file `tests/unit/session-summary-row-format.test.ts` exercises a new pure presenter `presentSessionVolumeSlot` extracted to `src/utils/session-row-format.ts`. The `<SessionSummaryRow>` consumes the presenter. No `.tsx` test; mirrors `session-header-total-volume.test.ts`.
- **MAJ-2**: Endereçado. Single pinned path for detail-screen zero branch: keep ternary, swap `formatWeight`→`formatVolume`, drop trailing `" volume"`. Positive → `"Total: 3 sets · 12,345 kg"`; zero → `"Total: 3 sets · —"`. Stated verbatim in the **Mudanças por arquivo** row and in **Contratos de I/O → Detail-screen render contract**.
- **MIN-1**: Endereçado. Visual-spec example corrected to `"Sat, May 24 · 1h 23m · 12,345 kg"` matching the actual `formatDisplayDate({includeWeekday: true})` output.
- **MIN-2**: Endereçado. New bullet in **Riscos → Loading flicker (cold cache)** documenting the first-paint flicker and noting the graceful nature of the optional slot.
- **MIN-3**: Endereçado. New bullet in **Out of scope** explicitly stating `useMaxVolumeWindowWeeks` is not applied to history-row totals.
- **MIN-4**: Endereçado. Line citations corrected (template literal at `:51`, zero-guard at `:50`).
- **MIN-5**: Endereçado. `sumLiveVolume` widened to `Pick<SetRow, "completed_at" | "set_type" | "weight" | "reps">[]`. Cast removed from `groupSessionVolumes`. Compat-check listed for every existing caller.

## Confidence and risk labels

- **Confidence: HIGH** — every load-bearing claim (existing prop, existing cache, kernel signature, server filters, callers, formatter behaviour, vitest config, `formatDisplayDate` output) is verified against code in Discovery and re-verified in Validation v1. The change is mechanical fulfilment of an already-shipped prop contract plus two co-located bug fixes the prompt's cross-surface-consistency clause implies, plus a tiny presenter extraction the test infrastructure dictates.
- **Risk: LOW** — no migration, no new query, two-screen blast radius, one shared component, one shared helper, kernel re-used. The single MEDIUM-risk note is the visible-number change on history-detail headers for sessions containing warmup volume — flagged for Tester regression.
