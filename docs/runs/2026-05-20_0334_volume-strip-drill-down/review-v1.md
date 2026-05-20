# Review v1 — 2026-05-20_0334_volume-strip-drill-down

## Summary
Two-file diff: `src/components/weekly-volume-strip.tsx` (edit) + `app/(app)/history/week/[isoWeek].tsx` (new). MAJOR-1 and MINOR-1, MINOR-3 from validator all applied. Bar-baseline math correct; volume kernel byte-equivalent between strip and week screen; no N+1; SessionSummaryRow reused verbatim; all 5 render branches mount screenHeader. 0 blockers / 0 majors / 3 minors.

## Verification of validator's required fixes

| Validator finding | Required | Applied? | Evidence |
|---|---|---|---|
| MAJOR-1 — out-of-window cache divergence | guard against `lastNIsoWeeks(8).map(w=>w.key)`; empty state when not in window | yes | `[isoWeek].tsx:74-78` (isInWindow memo) + branch 128-138 with copy `"This week is outside the visible range. Open the History tab to see the latest weeks."` |
| MINOR-1 — explicit outer wrapper | `<View className="mt-4 flex-row gap-1.5">` (drop `items-end`, `h-24`) | yes | `weekly-volume-strip.tsx:109` |
| MINOR-3 — drop `weekKeyFromMonday` | no helper, call `weekKeyOf(monday)` | yes | `dates.ts` unchanged; `[isoWeek].tsx:68` calls `weekKeyOf(monday)` |
| MINOR-2 — visual column-width check | deferred to Tester | acknowledged | implementation.md "Notes for Tester" §1 documents fallback |
| MINOR-4 — touch-target HIG miss | accepted, no padding | yes | no padding added |

## Specific checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | MAJOR-1 guard | pass | lines 74-78 + 128-138 |
| 2 | MINOR-1 wrapper | pass | line 109 |
| 3 | MINOR-3 no helper | pass | dates.ts unchanged |
| 4 | Bar baseline math (`marginTop = PLOT_HEIGHT - h`) | pass | h=96 → marginTop=0 (fills); h=4 → marginTop=92 (stub at bottom). Pixel-identical to old `items-end` layout. |
| 5 | Volume kernel alignment | pass | `weekly-volume-strip.tsx:43-50` and `[isoWeek].tsx:93-100` byte-equivalent — same source, filter, reduce. |
| 6 | No N+1 | pass | only `useSessions()` + `useWeeklyVolume()` |
| 7 | `<SessionSummaryRow>` reused verbatim | pass | unmodified; in-progress chip surfaces via row's existing branch |
| 8 | `<Stack.Screen>` in every render branch | pass | invalid (117-124), outside-window (128-138), loading (141-148), error (151-161), data (193-227) |
| 9 | `screenHeader` const pattern | pass | matches measurements precedent |
| 10 | No `any`/`@ts-ignore`/`console.log` | pass | grep clean |
| 11 | `Bucket.start: Date` external impact | pass | module-local; test file constructs its own bucket |
| 12 | Tap target a11y | pass | `accessibilityRole="button"`, `accessibilityLabel="View week of {label}"`, `active:opacity-70` |
| 13 | Dark mode tokens | pass | full coverage |
| 14 | Empty-state copy | pass | `"No sessions this week."` + outside-window copy |

## Findings

### MINOR-1 — Tampered/non-Monday URL renders a misleading header date
- **Where:** `[isoWeek].tsx:61-66, 111, 164-170`
- **What:** `monday = parseISO(isoWeek)` doesn't snap to Monday. `weekKeyOf` snaps internally so data is correct, but the header title and body range use the raw parsed Date. For `/(app)/history/week/2026-05-13` (Wed), title reads "Week of May 13" but data is for May 11–17. Affects only tampered URLs (strip always emits Monday segments). Design pseudocode called for `isoWeekStart(d)`; implementation dropped it.
- **Fix:** wrap parsed date in `isoWeekStart(d)` before returning from memo. Two-line change.

### MINOR-2 — Body header should use `endOfWeek` instead of ms arithmetic
- **Where:** `[isoWeek].tsx:168-170`
- **What:** Sunday computed via `monday.getTime() + 6 * 86_400_000`. Safe in BRT (no DST since 2019) but diverges from established `endOfWeek` pattern at `src/utils/dates.ts:59`. Will silently break for DST-observing locales.
- **Fix:** `const sunday = endOfWeek(monday, { weekStartsOn: 1 });`. 3-line change.

### MINOR-3 — Comment line-number anchor will rot
- **Where:** `[isoWeek].tsx:88-90`
- **What:** Comment cites `weekly-volume-strip.tsx:39-46` line range. Will become stale on the next edit to the strip.
- **Fix:** drop `:39-46`, keep file path only.

## Security checklist
- [x] RLS — both queries reuse existing RLS-scoped hooks.
- [x] No service-role keys.
- [x] User input (`isoWeek`) is NaN-guarded and only flows into pure date helpers; no SQL/rpc.
- [x] No new EXPO_PUBLIC_* env vars.

## Style / architecture
- [x] No new `any`, no `// @ts-ignore`, no `console.log`.
- [x] Imports follow project style.
- [x] Conventional folder placement.
- [x] `MetricRow`/`Section` kept local, mirroring measurements precedent.

## Quality gates
- `npm run typecheck` → clean.
- `npm run lint` → 0 errors, 1 pre-existing `router.d.ts` warning.
- `npm run test:unit` → 51/51.

## Decision

**`pass`**

0 blockers, 0 majors, 3 minors (all style/cosmetic). Recommend Implementer address inline as drive-by polish if convenient; they don't gate Tester.
