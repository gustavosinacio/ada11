# Discovery — 2026-05-20_0856_measurements-move-to-profile

## Feature prompt
From `docs/features.md:3`:

> "Measurements screen does not need to live on the bottom bar. It can be moved to the profile page as a button in the page itself"

## Scope summary
Drop the Measurements bottom-tab entry; add a navigation row on the Profile screen that pushes into `/(app)/measurements`. File-routed pages (`measurements/index.tsx`, `new.tsx`, `[id]/index.tsx`, `[id]/edit.tsx`) must stay reachable via `router.push` and from the web URL bar. Structurally identical to the Routines→Workout collapse shipped in run `2026-05-20_0410_strong-workout-routines-unify` (`docs/runs/2026-05-20_0410_strong-workout-routines-unify/design-v3.md:46-50`).

## Affected files (verified)

### Code — must change
- `app/(app)/_layout.tsx:5,29-49` — owns the tab bar. Today (committed at baseline `7d494dd`) lists 5 tabs in this exact order: Workout (`Dumbbell`), Routines (hidden via `href: null`), Exercises (`Wrench`), History (`History`), Measurements (`Ruler`), Profile (`User`). The Measurements `<Tabs.Screen>` at lines 43-49 needs `options={{ href: null }}`. The `Ruler` import at line 5 becomes unused and should be dropped (only consumer is the icon at line 47 — confirmed by `grep -rn "Ruler"` returning only `_layout.tsx:5,47`).
- `app/(app)/profile.tsx:1-157` — sectioned `<ScrollView>` with `<Text className="...uppercase...">` section headers and bordered rounded cards. Currently has two sections: "Preferences" (Weight unit toggle + Length unit toggle rows, lines 32-120) and "About" (Version + Account rows via `<Row>` helper, lines 122-128), followed by a destructive "Sign out" `<Button>` (line 130). The `<Row>` helper at lines 135-157 already imports and renders `ChevronRight` (at `opacity-0` for visual alignment) — a tappable variant is a minimal extension. Needs: an entry-point Pressable that calls `router.push("/(app)/measurements")` (or a Link).
- `tests/e2e/measurements.spec.ts:74-77` — `goToMeasurements` helper currently `page.getByText("Measurements", { exact: true }).first().click()` — that clicks the tab. After this run, the helper must navigate Profile tab → tap the Measurements entry-point row. Called by 7 tests (lines 93, 171, 198, 214, 242, 263, 281).
- `tests/e2e/measurements.spec.ts:320-342` — the "regression" test currently named `"5 tabs render, no Routines tab, Profile shows weight + length unit toggles"`. After this run: rename to "4 tabs render" (or similar), drop the `Measurements` tab assertion at line 329, add a negative `not.toBeVisible` on Measurements at the tab-bar level, optionally add an assertion that the Profile screen exposes a "Measurements" entry-point.
- `tests/e2e/probe-strong-unify.spec.ts:66-78` — test `"5-tab IA: tab bar shows Workout/Exercises/History/Measurements/Profile (no Routines)"` asserts Measurements visible in the bar (line 74). Becomes 4-tab IA without Measurements.
- `tests/e2e/probe-strong-unify.spec.ts:128-131` — the "active session: banner visible across tabs" test clicks the Measurements tab (line 129) to assert the banner persists across IA. After this run, that arm of the test must navigate Profile → Measurements row instead, or be dropped (Profile already covered at lines 133-135).

### Code — unchanged (confirmed by reading)
- `app/(app)/measurements/_layout.tsx:1-5` — bare `<Stack screenOptions={{ headerShown: false }} />`. Mirrors `app/(app)/routines/_layout.tsx:1-5` exactly. Stays as-is; under `href: null` the parent Tabs still registers the segment so child routes resolve via `router.push` (proven by the routines pattern in `app/(app)/_layout.tsx:25-28` shipping today).
- `app/(app)/measurements/index.tsx:17-91` — measurement list/history screen. Three internal `router.push` callers at lines 33, 63, 82 (all to `/(app)/measurements/new` or `/(app)/measurements/${item.id}`). Self-referential — no external file pushes into `/(app)/measurements` today (verified: `grep -rn "router.push.*measurements"` returns only the four hits inside `measurements/index.tsx` and `measurements/[id]/index.tsx:150`).
- `app/(app)/measurements/new.tsx`, `app/(app)/measurements/[id]/index.tsx`, `app/(app)/measurements/[id]/edit.tsx` — read-only verified; no edits expected. The `[id]/edit.tsx` post-save/delete `router.replace("/(app)/measurements")` calls (lines 96, 115) still resolve because the route file is still mounted.

## Relevant conventions (verified by reading code)

- **Tab visibility under Expo Router v6**: hide an auto-mounted directory segment with `<Tabs.Screen name="..." options={{ href: null }} />`. Precedent in `app/(app)/_layout.tsx:25-28` (Routines). Bare removal of the `<Tabs.Screen>` line would re-mount the tab with default options — explicit `href: null` is required. Documented in `docs/runs/2026-05-20_0410_strong-workout-routines-unify/design-v3.md:393-394`.
- **Bookmark/redirect forwarder for hidden directory routes**: precedent in `app/(app)/routines/index.tsx:1-5` — when a directory tab is hidden, the index can be replaced by a `<Redirect href="/(app)/workout" />` named export to absorb saved web bookmarks. **For Measurements this is NOT the desired pattern** — the brief is explicit that `/measurements` remains the list/history screen reached via Profile, not a redirect. So `app/(app)/measurements/index.tsx` stays the list screen (Option 1 in the brief).
- **Profile section conventions** (`app/(app)/profile.tsx:32-128`): uppercase `text-sm font-medium uppercase text-gray-500` section headers with `mb-2`; bordered card `rounded-lg border border-gray-200 dark:border-gray-800` containing rows; row dividers `border-b border-gray-200 dark:border-gray-800`. Last row drops the bottom border via a `last` prop. The `<Row>` helper at lines 135-157 already accepts a `ChevronRight` element (rendered at `opacity-0` for non-navigation rows); making it tappable means adding an `onPress` prop and bumping the chevron to full opacity for navigation rows.
- **`router.push` to `(app)` route group**: project consistently uses `router.push("/(app)/measurements")` form (parenthesised group + segment) — `measurements/index.tsx:33,63,82`, `measurements/[id]/index.tsx:150`. Same in `routines/index.tsx` (pre-redirect) and many other files. Match this exact form for the new Profile entry-point.
- **Icon source**: `lucide-react-native`. Available icons used in profile/measurements vicinity: `Ruler` (already imported for the tab today), `ChevronRight` (already in profile.tsx). For a Measurements entry-point row, `Ruler` is the obvious carry-over.
- **Accessibility labels on Pressables**: project consistently sets `accessibilityRole="button"` + `accessibilityLabel="<verb-phrase>"` on icon-only or terse Pressables. Examples: `measurements/index.tsx:35-37` ("New measurement"), `active-session-banner.tsx:20-21` ("Resume workout in progress"), `profile.tsx` weight/length toggle Pressables.
- **E2E navigation helper pattern**: `measurements.spec.ts:74-77` is a one-liner. Inverse pattern in `probe-strong-unify.spec.ts:80-89` (`/routines` URL → `/workout` redirect probe). The new Profile-mediated nav helper will be slightly more verbose (two clicks: Profile tab, then Measurements row).

## Constraints

- **Data**: zero schema / RLS / query changes. No file under `supabase/`, `src/api/`, `src/db/`, or `src/hooks/` is touched. Confirmed by reading the brief and verifying the measurements pages own all data plumbing (e.g. `useMeasurements` at `src/hooks/use-measurements.ts:17`).
- **UI**: NativeWind tailwind classes; dark-mode pairs (e.g. `bg-white dark:bg-black`). The Profile screen scrolls; the Measurements entry-point row must live inside the existing `<ScrollView contentContainerClassName="px-6 pt-16 pb-12">` so it scrolls with the rest of the page.
- **Platform**: native + web (Expo Router v6, `~6.0.23` per the design-v3 notes). The web app is in production (`deploy:web pushes straight to production`, see `chore: deploy:web pushes straight to production` commit `a555868`). Any user with `/measurements` bookmarked must still land on the list screen — this is preserved by **not** turning `measurements/index.tsx` into a redirect.
- **Auth**: unchanged — measurements routes are under `app/(app)/` which is already auth-guarded.
- **Performance**: zero hot-path impact. One additional Pressable on the Profile screen; no extra queries.

## Existing precedents

1. **Routines tab hidden + route preserved** — `app/(app)/_layout.tsx:25-28` is the exact one-line pattern this run replicates for Measurements. The Routines run differs from this one in two places: (a) Routines's `index.tsx` became a `<Redirect>` (because Workout absorbed the entry point); Measurements stays as the list screen. (b) Routines added an `ActiveSessionBanner`; this run doesn't touch the banner — it already mounts globally above `<Tabs>` (`app/(app)/_layout.tsx:11,17`) and persists across all tabs and pages, including the (still-mounted-by-router) Measurements screens.
2. **Tappable navigation row inside a sectioned ScrollView** — no perfect intra-repo precedent for "tap row → push route" on the Profile page itself. Closest precedent: `app/(app)/history/index.tsx` or any list row component with an `onPress` (e.g. `routine-list-item.tsx`, `measurement-list-item.tsx`). The Profile page's existing `<Row>` helper at lines 135-157 is structured to render a chevron — extending it with an `onPress` and removing the `opacity-0` wrapper is the cheapest path. Alternative (also acceptable): hand-roll a `Pressable` row inside its own card block, mirroring the bordered card style used in Preferences and About.
3. **`active-session-banner.tsx:17-32`** as the shape template for a tappable row with `<Text>` label + `<ChevronRight>` affordance — exact same DOM shape we want for the entry-point.

## Unknowns (require Designer judgment or human decision)

1. **Entry-point shape on Profile** — three viable shapes:
   - (a) **Reuse the `<Row>` helper** by extending it with an optional `onPress` and a non-faded chevron. Cheapest; matches existing visual rhythm of the "About" card.
   - (b) **Dedicated single-row card** styled like the Preferences/About cards (bordered, rounded), with a left-side `Ruler` icon + "Measurements" label + right-side `ChevronRight`. Slightly more discoverable; one extra layout block.
   - (c) **Standalone full-width primary `<Button>`** below "About". Loud but breaks the visual rhythm of the page (sections of bordered cards + one destructive button at the bottom).
   Recommend (b) — it's the most discoverable while still matching the page's visual language.

2. **Placement inside the Profile screen** — three slots:
   - (a) Above "Preferences" (top of page after header). Most prominent.
   - (b) Between "Preferences" and "About". Middle of the flow.
   - (c) Below "About", above "Sign out". Bottom of the flow.
   Recommend (b) — Preferences are settings (unit toggles), Measurements is a feature entry-point, About is metadata, Sign out is destructive. (b) groups feature affordances together. (a) is also defensible.

3. **Label string** — "Measurements" (matches the route name and the just-removed tab title; preserves existing E2E selectors) vs "Body measurements" (more descriptive). Recommend **"Measurements"** — keeps continuity, smaller test churn.

4. **Section header** — does the entry-point sit under its own section header (e.g. "Body" or "Tracking") or as a bare card without a header? If (b) above, a header gives visual symmetry with "Preferences" and "About". Recommend a single-word header **"Tracking"** if a header is wanted, or no header if Designer prefers to minimize.

5. **Active-session banner during Measurements navigation** — banner is independent of the tab bar (mounted at `app/(app)/_layout.tsx:11`, above `<Tabs>`). It already overlays every screen inside `(app)/`. After this run, when the user is on the Measurements list reached via Profile, the banner still renders. Behavior unchanged. (Sanity-checked, not a real unknown; just flagging it for the Designer to not over-think.)

6. **E2E test impact magnitude** — confirmed call sites:
   - `tests/e2e/measurements.spec.ts:74-77` — `goToMeasurements` helper (called by 7 tests).
   - `tests/e2e/measurements.spec.ts:320-342` — tab-count regression test (rename + adjust assertions).
   - `tests/e2e/probe-strong-unify.spec.ts:66-78` — 5-tab IA assertion (becomes 4-tab).
   - `tests/e2e/probe-strong-unify.spec.ts:128-131` — banner-across-tabs test (the Measurements click arm).
   Total: 2 spec files, ~4 distinct edit spots (the helper change covers 7 test consumers transparently).

7. **Should the Designer add a regression e2e that exercises Profile → Measurements navigation explicitly?** Recommend yes — one short test in `probe-measurements-move.spec.ts` (or appended to `measurements.spec.ts`) that asserts (a) no Measurements tab, (b) Profile screen exposes a Measurements row, (c) tapping it lands on `/measurements`. Cheap and decisively probes the new IA.

8. **`Ruler` import cleanup** — confirmed `Ruler` is only consumed in `app/(app)/_layout.tsx:5,47`. After this run it can be dropped from the imports there. If the Designer chooses option (b) for the entry-point shape (icon row), the icon import migrates to `app/(app)/profile.tsx`.

## Out-of-scope flags

- **Renaming or moving any `app/(app)/measurements/*` route file** — the brief explicitly preserves the routes.
- **Schema, RLS, query, hook, or mutation changes** — zero data-layer touch.
- **Adding new content to the Profile page beyond the Measurements entry-point** — no new sections, no "Edit profile" affordance, no avatar, etc.
- **Changing the Measurements feature itself** — no edits to the list, new, view, or edit screens beyond what falls out of this re-IA (none expected).
- **Tab icon polish elsewhere** — no other tab loses its icon or label in this run.
- **Tab title rename** ("Measurements" → "Body") — not requested; keep route + screen titles as-is.
- **Server-side or RLS-level changes to enforce anything new** — none implied.
- **Banner safe-area / position adjustments on iOS** — already deferred in the routines run (`docs/runs/2026-05-20_0410_strong-workout-routines-unify/design-v3.md:396`); not in scope here either.
