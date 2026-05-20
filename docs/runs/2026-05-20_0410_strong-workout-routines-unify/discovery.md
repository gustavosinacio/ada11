# Discovery — 2026-05-20_0410_strong-workout-routines-unify

## Feature prompt
> "Tela de iniciar treino pode ser unificada com a tela de rotinas, como no strong"
> (PT-BR; translates to: "The 'start workout' screen can be unified with the routines screen, like in Strong.")

Strong's pattern (for reference, not yet verified by Designer):
- Single "Workout" tab combines quick-start + routines list.
- "Quick start" button at top → ad-hoc empty workout.
- Routines listed below as tappable cards → tap to start a session pre-filled with that routine.
- Routine create/edit reachable via a "+" affordance on the same screen (no separate top-level tab).

## Scope summary
The repo currently has **two separate tabs** for what Strong unifies: `workout/` (Ready-to-lift home → modal picker → live session) and `routines/` (list → builder → new). The data plumbing already supports starting a session from a routine (`startSession({ routine_id })` → `useStartSession()`); the live workout screen already hydrates routine exercises from `routine_id`. So this feature is fundamentally **IA + UI consolidation**, not a data-model or backend change.

The prompt strongly implies "Reading B" (full unify — drop the Routines tab, fold its contents under Workout). "Reading A" (keep Routines tab, add routine cards on Workout home) is a softer interpretation and worth surfacing to the Designer.

## Affected files (verified)

### Tab shell + entrypoints
- `app/(app)/_layout.tsx:11-58` — declares the 6 bottom tabs in order: `workout`, `routines`, `exercises`, `history`, `measurements`, `profile`. Removing the Routines tab is a deletion of `Tabs.Screen name="routines"` here (+ unused icon import `ListChecks`).
- `app/index.tsx:6` — root redirect `<Redirect href="/(app)/workout" />` (unchanged target).
- `app/_layout.tsx:25` — auth gate lands signed-in users on `/(app)/workout` (unchanged target).

### Workout tab (today)
- `app/(app)/workout/_layout.tsx:1-5` — Stack with `headerShown: false`. Empty shell; will need to host nested routine routes if we move them under `/workout/`.
- `app/(app)/workout/index.tsx:1-142` — "Ready to lift" home. Renders two buttons ("Start from routine", "Start ad-hoc workout") and a modal `Pressable` list of routines. Auto-replaces to `/(app)/workout/[sessionId]` when `useActiveSession()` returns a row (`useEffect` at lines 25-29). This is the screen the prompt is collapsing into.
- `app/(app)/workout/[sessionId].tsx:1-303` — Live workout screen. Reads `session.data.routine_id` and hydrates `useRoutineExercises(routine_id)` to build the ordered exercise list and rest-timer mapping (lines 40, 56-64, 77-83). On finish, replaces to `/(app)/workout` (line 165). **Not directly affected**, but its "home" target stays.

### Routines tab (today)
- `app/(app)/routines/_layout.tsx:1-5` — Stack with `headerShown: false`. Will be deleted (Reading B) or kept (Reading A).
- `app/(app)/routines/index.tsx:1-73` — Routines list. Header `+` opens `/(app)/routines/new`. Empty state has "Create routine" CTA. List items push `/(app)/routines/[id]`.
- `app/(app)/routines/new.tsx:1-107` — Create form (name + notes via `useCreateRoutine`). On save, `router.back()`.
- `app/(app)/routines/[id]/index.tsx:1-277` — Builder: edit name/notes, add/reorder/remove `routine_exercises`, delete routine. On delete, `router.back()`.

### Data layer (no changes needed; already wired)
- `src/api/sessions.ts:38-60` — `startSession({ routine_id, name, notes })` already accepts a routine reference. Confirmed used at `app/(app)/workout/index.tsx:42-45`.
- `src/hooks/use-sessions.ts:35-40` — `useActiveSession()` polls `sessions` where `ended_at IS NULL`. Used by the Workout home today.
- `src/hooks/use-sessions.ts:42-51` — `useStartSession()` mutation; sets active cache on success.
- `src/api/routines.ts:9-71` — full list/get/create/update/softDelete.
- `src/hooks/use-routines.ts:1-63` — query + mutation hooks.
- `src/hooks/use-routine-exercises.ts:1-58` — `useRoutineExercises(routineId)`, plus add/update/remove/reorder.

### Component reuse candidates
- `src/components/routine-list-item.tsx:1-29` — exactly the card shape we'd want for the unified Workout home. Currently used only by `routines/index.tsx`.

### Other tabs (referenced for IA precedent only)
- `app/(app)/exercises/index.tsx:1-73` — header `+` pattern → `/(app)/exercises/new`.
- `app/(app)/measurements/index.tsx:1-91` — header `+` + empty-state CTA pattern; also renders a `ListHeaderComponent` strip above the FlatList — useful precedent for a "Quick start" header above the routine list.
- `app/(app)/history/index.tsx:1-62` — same `ListHeaderComponent` precedent (`WeeklyVolumeStrip`).

### Tests touching the affected routes
- `tests/e2e/crud.spec.ts:81-129` — "routines: create, see in list, open detail, delete". Tests click the `Routines` tab label, `waitForURL(/\/routines/)`, push `Create routine`, expect `/routines/new`, then `/routines$`, then `/routines/[uuid]`, then back to `/routines$`. **Will need rewrite** if routes move under `/workout/`.
- `tests/e2e/crud.spec.ts:162-202` — "workout: start ad-hoc". Asserts "Start ad-hoc workout" button + `waitForURL(/\/workout$/)` after finish. The "Start ad-hoc workout" label is the current copy on `workout/index.tsx:80` — design may change it (e.g. "Quick start"). Test will likely need a label tweak.
- No other e2e references the `routines` URL.

## Relevant conventions (verified by reading code)

- **Tab screens**: each top-level tab has `app/(app)/<tab>/_layout.tsx` (Stack with `headerShown: false`) and renders its own `<Stack.Screen options={{ title: ..., headerShown: true }} />` per route. Header `+` button via `headerRight`. Empty states use a single body CTA. (Pattern across `routines/`, `exercises/`, `measurements/`.)
- **Theme tokens**: `bg-white dark:bg-black`, body text `text-black dark:text-white`, muted `text-gray-500`, borders `border-gray-100/200 dark:border-gray-800/900`, active row `active:bg-gray-50 dark:active:bg-gray-950`. (`routine-list-item.tsx`, `exercises/index.tsx`, all list screens.)
- **Routing**: absolute `/(app)/<tab>/...` strings on `router.push` / `router.replace`. No deep links from external sources today (no scheme-based routes besides the root redirect).
- **TanStack Query**: queryKeys namespaced as `[entity]`, `[entity, "active"]`, `[entity, id]`. Invalidations on mutations target both lists and details.
- **Auth-aware data**: every Supabase call relies on the JWT; no `user_id` is passed by the client to reads (RLS filters). Writes inject `auth.user.id` server-side via Supabase JS.
- **Confirmations**: `confirmDelete()` from `src/components/confirm-delete.tsx` (web uses `window.confirm`). Used for finishing workouts and deleting routines.
- **Active session redirect**: `useActiveSession()` + `useEffect` → `router.replace("/(app)/workout/[id]")` lives only on `workout/index.tsx`. Other tabs do not redirect when a session is active.

## Constraints

- **Data**: no schema changes. `sessions.routine_id` is already nullable FK; `routines`/`routine_exercises` already RLS-protected per-user. Soft-delete via `deleted_at` everywhere — list queries already filter (`api/routines.ts:14`, `api/sessions.ts:8`).
- **UI**: NativeWind only (no design system). Bottom tab bar is the only persistent chrome — losing one tab makes the remaining tabs each ~20% wider on phone (5 vs 6 columns). Headers per-screen.
- **Platform**: web + iOS + Android from one tree. Modal `presentationStyle="pageSheet"` works on iOS; web falls back gracefully (see current `workout/index.tsx:91`).
- **Auth**: AuthGate redirects to `/(app)/workout` on sign-in (`app/_layout.tsx:25`) — already correct for the unified destination.
- **Performance**: `useRoutines()` is a single `SELECT * FROM routines` per visit. The Workout home would also call `useActiveSession()` (already does). Adding `useRoutines()` permanently to the Workout home (today it only fetches when the modal opens? No — verified at `workout/index.tsx:20`: it's already called unconditionally) means no new query load.

## Existing precedents

- **`workout/index.tsx:104-138`** — already renders a routine list inside a modal. Picking a routine calls `startFromRoutine(id, name)`. Reading B can collapse that modal into the page body.
- **`measurements/index.tsx:73-87`** + **`history/index.tsx:45-58`** — FlatList with `ListHeaderComponent` above rows. Drop-in pattern for "Quick start CTA card on top, routines list below".
- **`routines/index.tsx:42-56`** + **`exercises/index.tsx:42-56`** + **`measurements/index.tsx:56-71`** — uniform empty-state shape (centered text + black/white CTA button).
- **Header `+` button**: 3 screens use it (`routines`, `exercises`, `measurements`). Strongest precedent for putting "New routine" as a `headerRight` `+` on the unified Workout home.
- **`routine-list-item.tsx`** — already styled exactly like Strong's routine cards (name + notes preview + chevron). Reusable as-is.

## Unknowns (require Designer judgment or human decision)

1. **Reading A vs B** — does the user want (A) keep Routines tab + show routine cards on Workout home, or (B) full Strong-style: drop the Routines tab? The prompt's "unificada" + "como no strong" lean B; Designer should explicitly confirm and document.
2. **Routine sub-routes' destination if Reading B** — three options for `new` and `[id]`:
   - (a) keep at `app/(app)/routines/new.tsx` + `routines/[id]/index.tsx` and just remove the tab entry (routes survive as a hidden stack reachable only via `router.push`).
   - (b) move physically under `app/(app)/workout/routines/...` (more conventional with the new IA; longer push paths).
   - (c) leave Routines tab visible but consolidate the entry-point UI under Workout (hybrid).
   Each has different e2e-test diff impact.
3. **Active-session takeover** — today, `workout/index.tsx` auto-redirects to the live session on mount (line 27). If the unified screen is also the routines hub, is that still correct (user can't see/edit routines while a session is live)? Or should we replace the redirect with a sticky "Resume workout" banner that links to the live session and leaves the routines list visible? Strong shows a "Resume Workout" sticky banner — strong precedent for the banner approach.
4. **Quick-start CTA shape** — full-width button at top? Inline card? Sticky FAB? Current copy is "Start ad-hoc workout" / "Start from routine"; Strong uses "Start an Empty Workout" + routine cards. Designer picks copy + visual weight.
5. **Empty state** — when user has zero routines, the unified screen should still expose "Quick start (ad-hoc)" + "Create routine". The current modal shows "No routines yet. Create one from the Routines tab." (line 111) — that text becomes nonsensical if we kill the tab.
6. **Tab count + ordering** — 6 → 5 if Reading B. Confirm proposed order: `workout (unified) / exercises / history / measurements / profile`. The free slot does not need filling.
7. **Routine-card secondary affordance** — Strong shows "..." on each routine for edit/delete without entering the builder. Out of scope, but worth flagging: today, tapping a routine on the modal **starts a workout** (`startFromRoutine`); tapping in the list **opens the builder**. Same gesture, different meaning across screens. Unified screen must pick one — likely "tap = start, long-press or chevron-icon = edit", or "tap = start, ... menu = edit/delete".
8. **Routine icon in tab bar** — if Reading B, drop `ListChecks` import (`app/(app)/_layout.tsx:5`). Trivial.
9. **Deep links / saved URLs** — no external deep links to `/routines` today (no scheme entries, no shared URLs documented). Reading B without preserving `/routines` is safe in the current state — but the **web build** (EAS Hosting) means a user could have bookmarked `/routines`. Designer/Validator should decide whether to add a forwarder route (`/routines/index.tsx` → `<Redirect href="/(app)/workout" />`) for the URL graveyard.
10. **E2E migration** — `tests/e2e/crud.spec.ts:81-129` clicks the literal "Routines" tab label. Reading B breaks this. Implementer must update the spec to either (a) navigate to the unified screen and tap a "+" or "Manage routines" affordance, or (b) update the URL pattern (`/workout$` instead of `/routines`). Plan this in implementation, not after.

## Out-of-scope flags

- **Routine sharing / public templates** — not in the prompt; not in roadmap as a "next" item (roadmap.md:139 lists it as long-term).
- **Multi-week / periodized programs (mesocycles)** — roadmap.md:128 says "if owner does structured programming"; not now.
- **Auto-progression / smart suggested weights** — separate feature.
- **Calendar / scheduled workouts** — separate feature.
- **Routine reorder via drag** — out of scope unless trivial; current builder already uses up/down arrows.
- **Bulk routine import** — separate feature (CSV import is its own pipeline run already).
- **Sticky active-session banner across all tabs** — useful (Strong does it) but adds scope beyond "unify two screens". Recommend Designer flag it as a follow-up unless the user wants it bundled.
- **Routine search/filter** — not implied; defer until routine count justifies it.
