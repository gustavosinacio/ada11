# Design v1 — 2026-05-23_1805_session-total-volume-header

## Goal (1 sentence)
Surface the running total volume of the active workout session as a second metric block inside `<SessionHeader>`, computed via the canonical `sumLiveVolume` kernel over the already-mounted `useSetsForSession(sessionId)` cache and formatted via `formatVolume` with the user's `useWeightUnit()`.

## Approach
Compute the live total in the live-screen route (`app/(app)/workout/[sessionId].tsx`) with `useMemo(() => sumLiveVolume(setsQ.data ?? []), [setsQ.data])` — mirroring the verdict screen's gold-standard precedent at `verdict/[sessionId].tsx:53-56` — and pass two new props to `<SessionHeader>`: `volumeKg: number` and `unit: WeightUnit`. The header stays presentational (no new query, no new hook, no new data dependency inside the header file), which keeps test scaffolding simple and preserves a single-call-site for the kernel. Inside the header, render the volume as a second `label-above-number` block to the right of "Elapsed", visually identical to the existing block, then keep the `Finish` pressable at the far right. This preserves the load-bearing `getByText("Elapsed", { exact: true })` selector used by 5 e2e specs and adds a sibling `getByText("Volume", { exact: true })` for new tests. The F10 "checked = committed" invariant is enforced by reusing `sumLiveVolume` verbatim — warmups out, dropsets in, unchecked drafts out — so the live header and the post-Finish verdict screen agree on every digit by construction.

## Mudanças por arquivo
| File | Type | Change |
|---|---|---|
| `src/components/session-header.tsx` | edited | Add `volumeKg: number` and `unit: WeightUnit` to `Props`. Destructure in the function. Render a second metric block between the existing "Elapsed" block and the `Finish` pressable: `Volume` label + `formatVolume(volumeKg, unit)` numeral, using the exact same NativeWind classes as the "Elapsed" pair. Wrap both metric blocks in a single `flex-row` `View` with a `gap-6` so they sit as two columns to the left of the unchanged `Finish` pressable. Add `accessibilityLabel={\`Session total volume: \${formatVolume(volumeKg, unit)}\`}` and `accessibilityRole="text"` on the volume block's outer `View`. No change to the "Elapsed" block's text, classes, or DOM order. |
| `app/(app)/workout/[sessionId].tsx` | edited | Add two imports: `import { sumLiveVolume } from "~/utils/volume-target";` and `import { useWeightUnit } from "~/hooks/use-preferences";` (the path alias matches existing project imports — confirm at Implementer time). Below the existing `setsQ` (line 69), add `const unit = useWeightUnit();` and `const totalVolumeKg = useMemo(() => sumLiveVolume(setsQ.data ?? []), [setsQ.data]);` (must add `useMemo` to the existing React import if not already present). Pass `volumeKg={totalVolumeKg}` and `unit={unit}` to `<SessionHeader>` at line 401-405. No other changes. |

## Contratos de I/O
- **`<SessionHeader>` prop signature (additions in bold)**:
  ```ts
  import type { WeightUnit } from "~/db/types";

  type Props = {
    startedAt: string;
    onFinish: () => void;
    finishing?: boolean;
    // additions:
    volumeKg: number;       // kg always; conversion handled by formatVolume
    unit: WeightUnit;       // "kg" | "lbs"
  };
  ```
  Both new props are required (not optional). Rationale: optional props with defaults would let a future caller forget to pipe live data and silently render `0 kg`, hiding a regression. Required + supplied at the only call site is safer.
- **Kernel reused verbatim, no new function**:
  ```ts
  // src/utils/volume-target.ts (unchanged)
  export function sumLiveVolume(sets: SetRow[]): number;
  ```
  Called with `setsQ.data ?? []`. On first render before `setsQ.data` resolves, returns `0`; `formatVolume(0, "kg")` → `"0 kg"`. No skeleton, no spinner — TanStack flips the value in under a tick once the cache hydrates.
- **Formatter reused verbatim, no new function**:
  ```ts
  // src/utils/units.ts (unchanged)
  export function formatVolume(kg: number | null | undefined, unit: WeightUnit): string;
  ```
- **DB columns / queries**: none added, none changed. Reads `sets` rows via the existing `useSetsForSession(sessionId)` cache (query key `["sets", sessionId]`). RLS unchanged. No migration. No cache buster bump.
- **UI copy strings (pinned)**:
  - Label (visible): `Volume`
  - Numeral (visible): output of `formatVolume(volumeKg, unit)`, e.g. `"12,345 kg"`, `"0 kg"`, `"27,210 lbs"`
  - Accessibility label on volume block: `` `Session total volume: ${formatVolume(volumeKg, unit)}` `` → e.g. `"Session total volume: 12,345 kg"`
  - `accessibilityRole` on volume block: `"text"`
  - Unchanged: `"Elapsed"` label, `"Finish"` pressable label, `"Finish workout"` accessibility label.

## Test surfaces (pin verbatim for Tester)
Unit / component test selectors (against `<SessionHeader>`):
- `getByText("Elapsed", { exact: true })` — must still resolve uniquely (regression guard for the 5 existing e2e specs).
- `getByText("Volume", { exact: true })` — new label is unique on the live screen header.
- `getByText(/^\d{1,3}(,\d{3})*\skg$/)` or `getByText(/^\d{1,3}(,\d{3})*\slbs$/)` — the formatted volume numeral. Tests should NOT hardcode `"0 kg"` in the regex; assert the rendered shape and a separate exact-string check against `formatVolume(expectedKg, unit)` for the seeded scenario.
- `getByLabelText(/^Session total volume: /)` — accessibility label gate.

E2E gate (new spec or extension of an existing spec):
- After logging two sets with concrete weight/reps (e.g. `100 kg × 5`, `100 kg × 5`) and checking both, the header must show `getByText("1,000 kg")` (or the `lbs` equivalent). Unchecking one set must transition to `getByText("500 kg")` within the next TanStack invalidation tick. Editing the weight on a checked set must re-render the new total without remount.
- Existing `getByText("Elapsed", { exact: true })` wait gate must continue to resolve identically in all 5 currently-passing e2e files. NO change to their assertion lines is part of this design's scope.

## Riscos
- **Data integrity**: None. No DB write, no schema, no RLS surface, no cache buster. Pure read consumer of `["sets", sessionId]`. The arithmetic is `sumLiveVolume` reused verbatim — same kernel that drives the verdict screen and the per-exercise "Now" strip, so divergence between the new live header and the post-Finish verdict is impossible by construction.
- **UX regressions**:
  - Layout width on iPhone SE 320pt. The header gains a second metric column. Estimate: `"Elapsed" 56pt + "12:34" 80pt = ~80pt block` + `"Volume" 50pt + "12,345 kg" 100pt = ~100pt block` + `gap-6 24pt` + `"Finish" pressable 80pt` + `px-4 32pt total horiz padding` ≈ 316pt of content + padding inside a 320pt viewport. Borderline; long volumes (`"123,456 kg"` ≈ 7 digits) could push past. **Mitigation**: if width audit during Implementer round flags overflow, drop the numeral from `text-2xl` to `text-xl` (matches `volume-target-slot.tsx` for compactness) for BOTH metric blocks to keep symmetry — but only if needed. The pinned test selectors don't assert font size, so this fallback is non-breaking. Recommend Implementer measures on Android emulator + iOS simulator at 320pt before committing the final class.
  - Visual competition with the black `Finish` pressable. Mitigation: keep the volume numeral in `text-black dark:text-white` (same as Elapsed) — it does not steal attention from the Finish button which is a black-bg pressable, not a numeral.
  - The locked-in `getByText("Elapsed", { exact: true })` selector. Risk: zero, because the change preserves the literal text and uniqueness. Audited at `discovery.md:69-77` (5 e2e files, all using the same selector for a wait gate).
- **Platform-specific**:
  - iOS / Android / web all consume the same NativeWind classes and `formatVolume`'s en-US locale, so thousands-separator rendering is consistent across platforms (the en-US lock at `units.ts:30` was the fix for the pt-BR `.` collision; the new header inherits that fix for free).
  - Web: the `gap-6` Tailwind class is supported across react-native-web and native via NativeWind v4. No platform branch needed.
  - No `<Stack.Screen>` or native nav surface is touched.
- **Performance**:
  - One `useMemo([setsQ.data])` reduce over the session's set rows on each cache mutation. Typical session has <100 sets; the verdict screen already runs the same reduce without instrumentation. Negligible.
  - The 1-second `setInterval` clock in `<SessionHeader>` (line 22-25) is unchanged — its rerenders no longer call any new query, so its cost stays flat. The `useMemo` in the route guards against re-reducing on clock ticks (the clock ticks live INSIDE the header; the route's memo only recomputes when `setsQ.data` changes).

## Alternativas descartadas

1. **(Unknown 1, dropset/warmup inclusion rule) — Custom kernel that includes unchecked drafts** — would diverge from F10 "checked = committed" semantics and break parity with the verdict screen — descartada porque the per-exercise "Now" strip and verdict already define the canonical rule and forking it would re-introduce the exact UX bug that `2026-05-21_2225_multi-metric-strip` was created to fix (`discovery.md:29`).
2. **(Unknown 2, empty state) — Hide the volume block until the first set is checked** — would cause layout jank when the first check fires and would create a header that "appears" mid-session, which is harder to discover — descartada porque the verdict screen and per-exercise strip both render `0 kg` from the start, and the same pattern keeps the surface predictable and discoverable.
3. **(Unknown 3, label and format) — Inline `Volume · 12,345 kg`** — saves vertical space but breaks visual symmetry with the existing "Elapsed" label-above-number block, and inlining hurts the dual-metric scan pattern — descartada porque header symmetry with the established two-line pattern is established at `session-header.tsx:31-35` and `volume-target-slot.tsx`.
4. **(Unknown 4, placement) — New row below the existing Elapsed/Finish row inside the header** — doubles header vertical height and pushes the `<ScrollView>` content further down, costing screen real estate on small phones — descartada porque the two-column "metrics on the left, Finish on the right" layout fits within a single row on standard widths with our `text-2xl` numerals, and the 320pt fallback (drop to `text-xl`) is cheaper than spending another row.
5. **(Unknown 4, placement) — Sibling element rendered above or below `<SessionHeader>` in normal flow at the route level** — would split the visual unit of the header into two adjacent bands and require an extra border treatment — descartada porque keeping the volume inside the header preserves the single bordered band (`border-b border-gray-200 dark:border-gray-800`) the user already recognizes as the session header.
6. **(Unknown 5, loading state) — Skeleton or spinner while `setsQ.data` is undefined** — adds rendering complexity and a perceptible flash on first mount of every live session — descartada porque the derived value resolves synchronously to `0` (formatted `"0 kg"`) on first render and the TanStack cache hydrates within a tick, matching the verdict screen's terminal behavior.
7. **(Unknown 7, scope) — Mirror the same number onto the verdict screen / history detail** — out of scope (verdict already shows it; history is a different feature) — descartada porque the prompt explicitly scopes to "during a live workout" and the verdict screen already prints the identical number via the same kernel at `verdict/[sessionId].tsx:139-140`.
8. **(Unknown 8, a11y label) — Use `Volume \${volumeLabel}` (no "Session total" qualifier)** — terser but less precise for screen readers that may surface it out of context — descartada porque the verdict screen's headline accessibility label includes "Session" semantically (`Total volume Y kg`) and the qualifier helps a TalkBack/VoiceOver user disambiguate from the per-exercise "Now" numbers further down the same scroll view.
9. **Place the `sumLiveVolume` call inside `<SessionHeader>` itself** (Header consumes `useSetsForSession` directly) — would couple the presentational header to the route's `sessionId` and require either a new prop `sessionId` or a Context — descartada porque pushing the data dependency into the header expands its responsibilities and complicates unit tests; keeping it presentational with a `volumeKg` prop mirrors the existing `startedAt` / `onFinish` shape.

## Out of scope
- Verdict screen, history detail, per-exercise strip — already display volume via the same kernel.
- Animation / count-up effect on the volume number.
- Per-muscle volume breakdown in the header.
- Showing target volume / volume-to-PR in the header (the per-exercise strip already does this).
- Cancel-workout button placement or styling (lives below the `<ScrollView>` at `app/(app)/workout/[sessionId].tsx:531-541`).
- Workout home screen (`app/(app)/workout/index.tsx`) — list of routines, no live session.
- Any change to `sumLiveVolume`, `formatVolume`, `computeVolumeTarget`, or any kernel in `src/utils/`.
- Any new query key, hook, or cache.
- Any change to the `useSetsForSession` query shape, ordering, or RLS.
- Cache buster bump (Decision 9 applies only to schema-affecting changes).

## Overall calibration
- **Confidence**: HIGH — every component (kernel, formatter, hook, header file, route file) was read by Discovery and re-verified by Designer; the verdict-screen precedent at `verdict/[sessionId].tsx:53-56, 139-140` is structurally identical; the F10 invariant is settled across 3 prior runs; the prop signature is the smallest possible extension of an already-presentational component.
- **Risk**: LOW — UI-only consumer of an existing query; reversible local edit; no destructive operations; no schema/RLS/migration; the only non-trivial residual risk is iPhone SE 320pt overflow, mitigated by a documented `text-xl` fallback that does not affect any test selector.
