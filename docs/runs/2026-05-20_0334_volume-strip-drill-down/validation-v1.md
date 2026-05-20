# Validation v1 — 2026-05-20_0334_volume-strip-drill-down

## Summary
Verified Designer's claims against the codebase. Found **1 major** (out-of-window cache divergence) and **4 minors**. No blockers. `go`.

## Verification of Designer's claims

| Claim | Verified? | Evidence |
|---|---|---|
| `WeeklyVolumeStrip` only consumer at `history/index.tsx:48` | yes | grep clean |
| `Bucket` type module-local, no external consumers | yes | grep clean |
| `computeStripModel` module-local | yes | `weekly-volume-strip.tsx:34` not exported |
| `lastNIsoWeeks` exposes `start: Date` per week | yes | `src/utils/dates.ts:54-68` |
| `parseISO("YYYY-MM-DD")` returns local Monday 00:00 | yes | date-fns v4 contract; round-trips through `isoWeekStart` + `weekKeyOf` |
| `useFinishSession` invalidates `["sessions"]` AND `["stats"]` | yes | `src/hooks/use-sessions.ts:57-64` |
| Headline kernel = strip kernel | yes | `weekly-volume-strip.tsx:39-47` matches design pseudocode |
| History list includes in-progress sessions | yes | `history/index.tsx:44-58` + `session-summary-row.tsx:66-70` chip |
| `history/_layout.tsx` Stack with hidden headers | yes | confirmed |
| `<MetricRow>` + `<Section>` precedent reusable | yes | `measurements/[id]/index.tsx:34-60` |
| `formatVolume(kg, unit)` exists | yes | `src/utils/units.ts:36-47` |
| `WeeklyVolumeRow.completed_at` is the right field | yes | `src/api/stats.ts:4-9` |
| Volume math source excludes warmups + in-progress server-side | yes | `src/api/stats.ts:25-28` |
| Route `history/week/[isoWeek].tsx` doesn't collide with `history/[id].tsx` | yes | Expo Router literal-segment precedence |
| `active:` NativeWind variant works on `Pressable` | yes | 5 precedents with `active:bg-*` |
| `router.push("/(app)/history/week/...")` syntax established | yes | `history/index.tsx:53` |

## Findings

### MAJOR-1 — Out-of-window cache divergence breaks the "numbers match" contract for deep links
- **Where:** Design §Riscos / §Contratos "Headline derivation" + `src/hooks/use-stats.ts:16-27`.
- **Fact:** `useWeeklyVolume()` only pulls **last 8 ISO weeks**. The detail screen filters this cached set by `targetKey`. For **deep links** (URL pasted into web, bookmarked URL) or **time-shift** (oldest visible week + waiting past Monday midnight), the cached set won't include the target week → `headlineVolumeKg = 0`. Meanwhile, `useSessions()` returns all sessions, so the user sees sessions in the list but zero in the headline.
- **Fix (a) — required:** guard `targetKey` against `lastNIsoWeeks(8).map(w=>w.key)`; render "Week outside the visible range" empty state when not in window. 4 lines, mirrors the existing `monday === null` branch.

### MINOR-1 — Outer container shape change under-specified
- **Where:** Design §Contratos pseudo-shape.
- **Fact:** Current strip uses two sibling rows (`flex-row items-end h-24` + `flex-row gap-1.5`). Design pseudo-shape doesn't spell out the new outer wrapper. Without explicit guidance, Implementer might keep `items-end h-24` which would fight the `marginTop` baseline trick.
- **Fix:** spell out `<View className="mt-4 flex-row gap-1.5">{...}</View>` (drop `items-end` and `h-24`).

### MINOR-2 — `flex-row gap-1.5` + `<Pressable className="flex-1">` siblings
- **Fact:** All current `active:bg-*` Pressables are full-width rows. The proposed 8 `<Pressable className="flex-1">` siblings inside `flex-row gap-1.5` should render evenly but no precedent in this codebase.
- **Fix:** Implementer should eyeball-test; if uneven, wrap Pressable in `<View className="flex-1">` and let Pressable be just `active:opacity-70`.

### MINOR-3 — `weekKeyFromMonday` helper is redundant
- **Fact:** `weekKeyOf(monday)` is already idempotent on a Monday (`isoWeekStart(monday) === monday` → same key).
- **Fix:** drop `weekKeyFromMonday`. Use `weekKeyOf(monday)` directly.

### MINOR-4 — Touch target 39pt × 120pt below iOS HIG width
- **Fact:** Design accepts the miss (column ~39pt vs 44pt). Vertical compensation helps but doesn't replace the width minimum per Apple.
- **Fix:** None — accepted. Implementer must NOT widen via padding (distorts visual). Follow-up: if mis-taps reported, reduce WEEKS_WINDOW to 6.

## Designer's open questions — answers
1. Keep `weekKeyFromMonday`? **No** (MINOR-3).
2. Body header range or Monday-only? **Range in body, Monday in header** — confirmed.
3. Zero stat sheet on empty week? **Yes** (layout consistency).
4. `active:opacity-70` acceptable? **Yes** (5 Pressable precedents with `active:bg-*`).

## Counts
- Blockers: 0
- Majors: 1 (MAJOR-1)
- Minors: 4

## Decision

**`go`**

The Implementer must:
1. Implement MAJOR-1 fix (a) — guard `targetKey` against `lastNIsoWeeks(8).map(w=>w.key)`; render "outside visible range" empty state.
2. Apply MINOR-3 (drop `weekKeyFromMonday`, use `weekKeyOf(monday)`).
3. Use the explicit outer-wrapper shape (MINOR-1).
4. Visual-check column widths after implementation (MINOR-2).
