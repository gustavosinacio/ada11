# Implementation — 2026-05-20_0334_volume-strip-drill-down

Based on: `design-v1.md` (approved) and `validation-v1.md` (`go` with 1 MAJOR required + 4 minors).

## Files changed

- `src/components/weekly-volume-strip.tsx` (edited) — added `start: Date` to the
  local `Bucket` type; passed `wk.start` through from `lastNIsoWeeks()` in
  `computeStripModel`. Replaced the two-row layout (bars row + labels row)
  with a single `<View className="mt-4 flex-row gap-1.5">` wrapper whose
  children are per-column `<Pressable className="flex-1 active:opacity-70">`
  elements. Each `<Pressable>` contains the bar (`marginTop: PLOT_HEIGHT - h`
  baseline trick, `height: h`) and the M/d date label, with
  `accessibilityRole="button"` and `accessibilityLabel={\`View week of ${b.label}\`}`.
  `onPress` calls `router.push("/(app)/history/week/" + format(b.start, "yyyy-MM-dd"))`.
  Imports added: `format` from `date-fns`, `useRouter` from `expo-router`, and
  `Pressable` from `react-native`. No volume-math change.

- `app/(app)/history/week/[isoWeek].tsx` (new) — view-only week-detail screen.
  Parses the URL segment with `parseISO` (defensive `Number.isNaN(d.getTime())`
  guard), derives `targetKey = weekKeyOf(monday)`, runs the MAJOR-1 in-window
  guard against `lastNIsoWeeks(8).map(w => w.key)`, then derives:
  (a) `weekSessions` via `useMemo` filter of `useSessions().data` by
  `weekKeyOf(parseISO(s.started_at)) === targetKey`, and
  (b) `weekVolumeKg` via the same reduce kernel as
  `weekly-volume-strip.tsx:39-46` against `useWeeklyVolume().data` (so the
  headline number always matches the strip bar). Renders 5 branches — invalid
  week, outside window, loading, error, data — each mounting `screenHeader`
  (`<Stack.Screen options={{ title: "Week of {MMM d}", headerShown: true }} />`).
  The data branch shows a body header (range "MMM d – MMM d"), a `Volume`
  `Section` with three `MetricRow`s (Total volume, Sessions with optional
  "(incl. N in progress)" suffix, Avg per session — hidden when zero ended
  sessions), then the `Sessions` section header followed by either an empty
  state ("No sessions this week.") or a `.map` of `<SessionSummaryRow>` rows.
  Each row taps through to `/(app)/history/${s.id}`. Local `MetricRow` +
  `Section` components mirror the measurements view-screen pattern verbatim.

`src/utils/dates.ts` was NOT modified (MINOR-3 — `weekKeyFromMonday` helper
dropped, `weekKeyOf(monday)` used directly because `isoWeekStart` is
idempotent on a Monday).

## Deviations from design

- **`weekKeyFromMonday` helper not added (MINOR-3 applied).** Design left this
  optional; Validator chose to drop it. Implementation calls `weekKeyOf(monday)`
  directly — `isoWeekStart` is idempotent on a Monday so the redundant
  round-trip is a no-op.

- **Outer wrapper shape (MINOR-1 applied).** Design pseudocode was ambiguous on
  the wrapper. Implementation uses the exact validator-prescribed shape:
  `<View className="mt-4 flex-row gap-1.5">{...}</View>` — dropped `items-end`
  and `h-24` from the wrapper; each per-column `<Pressable>` self-sizes via
  `marginTop: PLOT_HEIGHT - h`.

- **MINOR-2 visual check.** Each `<Pressable>` carries `flex-1` directly (no
  extra `<View className="flex-1">` wrapper). All eight siblings share an
  identical `flex-1` weight inside a `flex-row gap-1.5`, which RN's flexbox
  distributes evenly. If visual QA flags uneven columns, fall back to the
  validator's wrap-in-`<View className="flex-1">` recommendation. Currently
  shipping the simpler single-element form.

- **Body header — range only, not Monday-only.** Validator confirmed range in
  body + Monday-only in header. Header reads "Week of May 18" (Monday); body
  reads "May 18 – May 24" (full range, computed by adding 6 days to the Monday
  in ms). ada11 runs America/São_Paulo which has no DST since 2019, so the
  +6×86_400_000 ms math is exact for this user. If the app ever ships to a
  DST-observing locale we should switch to
  `endOfWeek(monday, { weekStartsOn: 1 })` for safety — flagged here, not done
  in v1 to keep scope tight.

- **"Sessions" row includes in-progress count inline.** Design specified
  `"{n} (incl. {m} in progress)"` when applicable. Implementation matches: the
  primary count is `endedSessionsCount` (consistent with the headline volume,
  which excludes in-progress server-side), with the `(incl. N in progress)`
  suffix appearing only when `inProgressCount > 0`. The `Avg per session`
  row is hidden entirely when `endedSessionsCount === 0` (per design — avoids
  showing "0 kg" as an average).

- **`router` is `useRouter`, not `<Link>`.** Design listed both as
  acceptable. `router.push` is the dominant pattern in the codebase (12 call
  sites), and `<SessionSummaryRow>` already takes an `onPress` callback rather
  than wrapping a `<Link>`. Sticking with `router.push` is consistent.

- **No `headerRight` action.** Design called this out as v1: no edit
  affordance on the week-detail screen because sessions are edited from
  `history/[id].tsx`. Implementation matches — no `headerRight`.

## Soft callbacks made (during this implementation pass)

None. All ambiguities were resolved by the validator's findings + the design
text; no further questions to the human.

## Quality gates

- [x] `npm run typecheck` passed (clean — no errors, no output).
- [x] `npm run lint` passed (only the pre-existing `router.d.ts` warning; 0
  errors). The new route auto-extends `router.d.ts` on next `expo` build, so
  the warning count is unaffected by this PR.
- [x] Unit tests pass — `npm run test:unit` → 51/51 (6 files).
- [x] No new `any` (grep clean in both touched files).
- [x] No new `// @ts-ignore` (grep clean).
- [x] No stray `console.log` (grep clean).

E2E `tests/e2e/weekly-volume-strip.spec.ts` was not modified and remains a
read-only assertion of the strip's render (it doesn't tap the bars). The new
route is exercised by manual smoke + Reviewer/Tester rounds.

## Notes for Reviewer / Tester

- **Visual parity of the strip.** The biggest visual risk is column-width
  evenness now that each bar lives inside a `<Pressable className="flex-1">`
  instead of being a bare `<View className="flex-1">` inside a single
  `flex-row`. On RN/web/iOS this should render identically because `flex-1`
  on a `Pressable` distributes the same as on a `View`. Tester: eyeball-check
  the bar widths against a screenshot of the pre-change strip. If they differ,
  wrap each `<Pressable>` in `<View className="flex-1">` and remove `flex-1`
  from the `<Pressable>` (MINOR-2 fallback).

- **Touch-target HIG miss is intentional.** Column width on a 390pt iPhone is
  ~39pt — under Apple's 44pt minimum. Vertical extent (~120pt) more than
  compensates. Documented in design §Riscos and validator MINOR-4. Don't
  widen via padding; that would distort the visual.

- **Headline-vs-strip-bar number contract.** The week-detail headline reads
  from the *same* TanStack Query cache key as the strip
  (`["stats", "weekly-volume", sinceUtc.slice(0,10)]`). Reviewer: confirm
  that no new query was added and that `useWeeklyVolume()` is called once
  on the week screen (it is).

- **Out-of-window guard.** For deep links / bookmarked URLs / time-shift past
  Monday midnight, the week-detail screen falls into the "outside visible
  range" empty state. The user sees a clear copy explaining why and a hint
  to go back to History. Tester: deep-link to
  `/(app)/history/week/2025-01-06` (any Monday >8 weeks ago) and confirm the
  empty-state copy renders.

- **In-progress session in the per-week list.** Matches `history/index.tsx`
  behavior — in-progress sessions appear with the orange chip; tap through
  navigates to `history/[id]`. The "Sessions" row counts only ended sessions
  for the primary number; in-progress are surfaced via the `(incl. N in
  progress)` suffix so the headline-vs-list divergence is self-labeled.

- **DST edge case in body header.** The "MMM d – MMM d" body header is
  computed by adding 6 × 86_400_000 ms to the Monday. Safe for BRT
  (no DST since 2019). Flagged in Deviations above for any future locale.
  Reviewer: not a blocker; document as a known scope cap.
