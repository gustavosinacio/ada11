# Review v1 — 2026-05-22_1130_chart-scroll-week-selector

Reviewing: the diff for the implementation against `design-v2.md` (and the 6 validator-v2 minors).

## Diff scope

- Baseline commit: `cdf5f2bfb6fd55eb74659bab94cb6c209224c0c1` (per `state.md`).
- Files changed in scope: 12 (3 new + 9 edited).
  - **New**: `src/utils/weekly-volume-strip-math.ts`, `src/components/week-selector.tsx`, `tests/e2e/chart-scroll-week-selector.spec.ts`.
  - **Edited**: `src/utils/dates.ts`, `src/api/stats.ts`, `src/hooks/use-stats.ts`, `src/components/weekly-volume-strip.tsx`, `app/(app)/history/index.tsx`, `app/(app)/history/week/[isoWeek].tsx`, `tests/unit/dates.test.ts`, `tests/unit/weekly-volume-bucketing.test.ts`, `tests/e2e/week-drill-down.spec.ts`.
- `npm run typecheck`: **clean** (no output). Ran once for sanity, per contract.

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| BLK-1: `listWeeklyVolumeRows` signature preserved as `opts?: { sinceUtc?: string }`; both branches retained | yes | `src/api/stats.ts:48-49` keeps `opts: {...} = {}`; `sinceUtc` branch at `:51-69`, lifetime branch at `:71-95`. |
| MIN-A: defensive `opts: {...} = {}` default | yes | `src/api/stats.ts:49`. No-arg call from `useLifetimeWeeklyVolume` at `src/hooks/use-stats.ts:26` reads `opts.sinceUtc === undefined` safely. |
| MAJ-1: `isoWeeksBetween` exported, returns `[]` when end < start | yes | `src/utils/dates.ts:98-119`. Empty-range early-return at `:102`. |
| MAJ-1: `computeStripModel` returns `null` on empty data | yes | `src/utils/weekly-volume-strip-math.ts:51` (`if (data.length === 0) return null`), also `:59` for the all-invalid-completed_at edge. |
| MAJ-2: bottom-sheet modal mirrors `<SetRowMenu>` | yes | `src/components/week-selector.tsx:140-145` (`<Modal visible animationType="slide" transparent>`), `:146-150` (backdrop `flex-1 justify-end bg-black/50`), `:153` (inner blocker), `:154` (`rounded-t-2xl bg-white px-6 pb-10 pt-6 dark:bg-gray-900`). No `[X]` header. Matches `set-row-menu.tsx:111-129`. |
| MAJ-3: `<VisibleRangePill>` uses `forwardRef` + `useImperativeHandle`; parent never `setState`s on scroll | yes | `src/components/week-selector.tsx:39-64` for the pill; `src/components/weekly-volume-strip.tsx:155-183` for `onScroll` — only `pillRef.current?.setRange(label)` + `isPinnedRightRef.current = …` (ref mutation, not state). |
| Scrutiny-2: `setRange` dedupe | yes | `weekly-volume-strip.tsx:178` (`if (label === lastLabelRef.current) return;`). |
| MIN-5: week-rollover effect re-pins on `buckets.length` growth + `isPinnedRightRef.current` | yes | `weekly-volume-strip.tsx:147-153`. |
| `useWeeklyVolume` deleted | yes | Only doc-comment mentions remain (`use-stats.ts:15`); no live exports/imports. Confirmed via `grep -rn "useWeeklyVolume" src app tests`. |
| `WEEKS_WINDOW` deleted | yes | `grep -rn "WEEKS_WINDOW" src app tests` returns nothing. |
| All callers swapped to `useLifetimeWeeklyVolume` | yes | `app/(app)/history/index.tsx:9,17`, `app/(app)/history/week/[isoWeek].tsx:15,52`. `progress/index.tsx` and `verdict/[sessionId].tsx` already on lifetime. |
| `isInWindow` guard deleted at `history/week/[isoWeek].tsx` | yes | Comment now says "Lifetime data covers every historical ISO week — no out-of-window guard is needed" (`:66-68`). BRANCH 1 (invalid URL), 2 (loading), 3 (error), 4 (data) cover edge cases. |
| Tab tap-to-drill-down preserved | yes | `weekly-volume-strip.tsx:287` `router.push("/(app)/history/week/${segment}")`. |
| Lifetime-best overlay inside the scroller | yes | `weekly-volume-strip.tsx:305-313` — overlay is an `<View className="absolute …">` inside the `<ScrollView>`'s `<View style={{ width: contentWidth, … }}>` container, spanning full content width. |
| Cross-year label format | yes | `weekly-volume-strip.tsx:56-63`: single-year `"MMM d – MMM d, yyyy"`, cross-year `"MMM d, yyyy – MMM d, yyyy"`. |
| `weekly-volume-strip-math.ts` extraction (deviation #1) | yes — justified | `src/utils/weekly-volume-strip-math.ts`. Mirrors `src/utils/progress-page-math.ts` (existing precedent). Kernel semantics: `data.length === 0 → null`, dynamic buckets via `isoWeeksBetween(firstSessionMonday, currentMonday)`, kernel `parseFloat(weight) × reps` with `w > 0 && r > 0` guards — identical to v1 inline math. |
| `tests/e2e/week-drill-down.spec.ts` repurposed | yes | `:319-378` now seeds current-week only, deep-links 12 weeks back, asserts `Total volume` + `No sessions this week.` render and the old "outside the visible range" copy is gone (`toHaveCount(0)` at `:359-361`). |
| 208/208 unit tests passing | not re-run | Reviewer doesn't run unit tests; implementer's `npm run test:unit` claim is sufficient and consistent with the code I read. |

## Issues

### Blockers
- none.

### Majors
- none.

### Minors

- **[MIN-1]** `src/components/weekly-volume-strip.tsx:90-99`: `initialLabel` hard-codes `previewCount = Math.min(8, model.buckets.length)`. The magic 8 assumes a phone-portrait viewport showing ~8 bars (`viewportWidth ≈ 360 / COLUMN_WIDTH=46 → 7.8`). Tablet / web wide viewport will show more bars than the label advertises until the first `onScroll` event corrects it. Fix: extract `DEFAULT_VISIBLE_BAR_COUNT = 8` to a constant near the layout constants and add a short comment; OR compute from `viewportWidthRef.current` if non-zero, falling back to 8. Not load-bearing — corrected on first scroll. Severity: minor.

- **[MIN-2]** `src/components/weekly-volume-strip.tsx:226`: `rightAnchorX = Math.max(0, contentWidth)` is mathematically wrong as written (should be `Math.max(0, contentWidth - viewportWidth)` for a precise right-edge offset). It works because `<ScrollView>` clamps `contentOffset.x` to the valid range internally, but the variable name implies a precomputed right-edge offset, not "total width sent past the clamp". Fix: rename to `mountContentOffsetX` or compute `contentWidth - viewportWidthRef.current` once `onLayout` has fired. Severity: minor — works in practice, just confusing.

- **[MIN-3]** `src/components/weekly-volume-strip.tsx:129-141` `handleJumpTo` returns silently with `idx < 0` (when the user picks a (year, month) that falls between `lastAvailable` and December of `lastYear` — i.e. "future" months past the current ISO week). UX is "tap Jump, nothing happens". The selector modal's `isBeforeFirst` constraint disables pre-first months but does NOT disable post-last months, so this state is reachable. Fix: either clamp `idx` to `model.buckets.length - 1` in `handleJumpTo` so the strip lands on the rightmost bar, OR mirror the `isBeforeFirst` dim treatment with `isAfterLast` in the modal. Severity: minor — design notes "post-last-available months stay enabled so users can scroll into 'future' months… the strip just lands on the rightmost bar in that case" (`week-selector.tsx:101-103`), but the code does NOT implement that fallback. Cheap dead-letter to actually deliver the contracted behaviour.

- **[MIN-4]** `tests/e2e/chart-scroll-week-selector.spec.ts:203-266` test #2 ("week-selector flow") taps `Jump to selected month` against the *default* selection (last-available year+month), so the assertion "modal closes cleanly" is trivially satisfied even if `handleJumpTo` is a no-op. The Implementer flagged this in `Deviations` (#3) as "asserting actual scroll-x changes on Expo Router web is brittle — defer to manual QA". Acceptable as a documented deferral; logged here so Tester knows the scroll-side-effect is currently unasserted. Severity: minor — coverage gap, not a bug.

- **[MIN-5]** `tests/e2e/weekly-volume-strip.spec.ts:197` still asserts `labelTexts.length >= 8` (validator MIN-C). Under lifetime data with ≥8 weeks the assertion passes trivially; it no longer guards a meaningful invariant (the old "exactly 8" assertion was the load-bearing one). Implementer documented this in `Deviations` (#2). Severity: minor — pre-existing coverage looseness, not introduced by this run.

## Security checklist

- [x] RLS: no new `from('table').*` calls. The new code only consumes `useLifetimeWeeklyVolume` (which already routes through the existing RLS-protected `sets`/`sessions` queries). No new tables, no new migrations.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` in `src/` or `app/`. `tests/e2e/chart-scroll-week-selector.spec.ts:25` uses the service-role key, which is the canonical E2E pattern (see siblings `auth.spec.ts:35`, `end-of-session-verdict.spec.ts:31`). Test files don't ship to the client.
- [x] No raw SQL `rpc` calls in this diff.
- [x] No new `EXPO_PUBLIC_*` env vars introduced.

## Style / convention checklist

- [x] No new `any` types in production code (`grep -rn ": any" src/components/week-selector.tsx src/components/weekly-volume-strip.tsx src/utils/weekly-volume-strip-math.ts` returns nothing).
- [x] No new `// @ts-ignore`.
- [x] Comments narrate *why*, not *what*. Examples that pass: `weekly-volume-strip.tsx:79-80` (memo invalidation contract), `:163` (right-edge pinning), `weekly-volume-strip-math.ts:35-45` (kernel contract + null-return rationale). No comments restating obvious code.
- [x] Imports follow project style. Package imports first, then `~/`-aliased internal modules. Relative `./week-selector` only inside `src/components/`.
- [x] New files placed in conventional folders: `src/utils/`, `src/components/`, `tests/e2e/`.

## Decision

**pass**

Reasoning:

- 0 blockers, 0 majors, 5 minors — well under the `pass` bar (`0 blockers and ≤1 major`).
- All v1 blockers (BLK-1 signature drop) and v1 majors (MAJ-1 helper + empty data, MAJ-2 modal pattern, MAJ-3 scroll re-render avoidance) verified against the diff with `file:line` evidence.
- All 6 validator-v2 minors folded (MIN-A default fix; MIN-B precise delete target; MIN-C deferred per implementer with reviewer concurrence; MIN-D `initialLabel` prop wired; Scrutiny-1 canonical `useImperativeHandle` shape; Scrutiny-2 dedupe ref).
- The `weekly-volume-strip-math.ts` extraction is a justified deviation (mirrors `progress-page-math.ts`, decouples the math kernel from the RN component tree for unit-test isolation).
- Security checklist clean — no new tables, no RLS concerns, no service-role leakage.
- The 5 minors logged are quality nits (magic number, variable name, dead-letter UX fallback, coverage looseness on the new spec, pre-existing coverage looseness on `weekly-volume-strip.spec.ts`). None block proceeding to Tester.
