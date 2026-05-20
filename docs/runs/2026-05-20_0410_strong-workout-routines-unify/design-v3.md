# Design v3 — 2026-05-20_0410_strong-workout-routines-unify

## Goal (1 sentence)
Collapse the Routines tab into the Workout tab so the Workout home becomes a Strong-style unified entry point — Quick start CTA on top, user's routines listed below as tap-to-start cards with an edit affordance — while keeping all data plumbing untouched.

## Approach
Carry forward **Reading B** (drop the Routines tab; Workout becomes the unified hub) and **Option 1 for routes** (keep create/edit at `/(app)/routines/...`, no file moves). Hide the Routines tab via `<Tabs.Screen name="routines" options={{ href: null }} />` — Expo Router v6 auto-mounts directory routes under a `Tabs` parent, so bare removal would re-mount it with default options (BLK-1, v1). Replace the Workout home's auto-redirect-to-live-session with a sticky `<ActiveSessionBanner />` mounted in `(app)/_layout.tsx`, visible across every tab. Guard the new start CTAs against orphaning a second in-progress `sessions` row: both `startAdHocWorkout` and `startFromRoutine` short-circuit to the live screen when `useActiveSession().data` is non-null, **and** the Workout home early-returns an `<ActivityIndicator />` while `active.isLoading` is true so the guard's settled-value check has no race window (MAJ-NEW-1, v2). Routine cards dim to `opacity-60` when an active session exists. A two-line `<Redirect>` forwarder at `/(app)/routines/index.tsx` absorbs saved web bookmarks. `RoutineListItem` grows an `onEditPress` prop for the inline Edit pill; tap on the row body starts the session. The **only** intentional changes to `app/(app)/_layout.tsx` are `href: null` on the routines tab, dropping the unused `ListChecks` import, and wrapping `<Tabs>` in a `<View>` to mount the banner — all existing tab titles ("Workout", "Exercises", "History", "Measurements", "Profile") and icons (`Dumbbell`, `Wrench`, `History`, `Ruler`, `User`) are preserved verbatim (MAJ-NEW-2, v2). No schema, no API, no hook signature change.

## Decisions on unknowns (from Discovery)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Reading A vs B | **B** — drop the Routines tab; Workout home unifies both. | Prompt wording ("unificada" + "como no strong") is unambiguous; A is a half-measure that still leaves two screens. |
| 2 | Where do `new` / `[id]` routine routes live? | **Option 1** — keep at `app/(app)/routines/...`; hide the Tabs entry with `href: null`. | Cheapest diff (no file moves, no import-path churn). Routes still resolve via direct `router.push`. Path string is internal — users don't see it. |
| 3 | Active-session takeover | **Sticky "Workout in progress" banner** in `(app)/_layout.tsx`, visible across all tabs. Drop the auto-`router.replace` from Workout home. Client-side guard on start CTAs **plus** `active.isLoading` early return on the Workout home to prevent orphan rows during the initial query settle. | Strong parity. Banner lets the user create/edit routines while a session is paused. Single-redirect-on-mount was hostile to the new IA. Guard + loading gate closes the latent "start while active" hole exposed by removing the redirect. |
| 4 | Quick-start CTA shape | **Full-width primary `<Button label="Quick start workout">`** rendered as a `ListHeaderComponent` above the routines FlatList. | Matches existing `measurements/history` precedent. Same `<Button>` component already in use. |
| 5 | Empty state (zero routines) | Centered text + Quick-start primary button + secondary "Create routine" button. Copy: **"No routines yet. Quick start a workout, or create your first routine below."** | Both paths usable from empty state; the labelled button is more discoverable than the header `+`. |
| 6 | Tab count + order | **5 tabs**: Workout / Exercises / History / Measurements / Profile. **Titles and icons unchanged from current code**: Workout (`Dumbbell`), Exercises (`Wrench`), History (`History`), Measurements (`Ruler`), Profile (`User`). | Workout first (entry point), then library (Exercises), past (History), body (Measurements), Profile last. Matches sign-in landing target. Title rename or icon swap is out of scope for this run (MAJ-NEW-2). |
| 7 | Routine-card affordance | **Single tap = start session with this routine.** Edit reached via a small "Edit" pill on the right (Pencil icon + "Edit" label, with `e.stopPropagation?.()` before `router.push`). | Strong-style start-on-tap is the primary affordance. Long-press is invisible on web; an explicit edit button is discoverable and platform-neutral. |
| 8 | Drop `ListChecks` import | Yes. | Mechanical cleanup; the icon is no longer rendered (tab is hidden, not styled). |
| 9 | Bookmark forwarder for `/routines` | **Yes** — `/(app)/routines/index.tsx` becomes a named `RoutinesRedirect` default export rendering `<Redirect href="/(app)/workout" />` (MIN-NEW-1). | One line of logic, eliminates the broken-bookmark class for the web prod app. Naming the export avoids the `import/no-anonymous-default-export` lint warning. |
| 10 | E2E test rewrite | Rewrite `tests/e2e/crud.spec.ts:81-129` to drive from the Workout home. Update copy literal `"Start ad-hoc workout"` → `"Quick start workout"` at `crud.spec.ts:170`, `crud.spec.ts:175`, and `exercise-progress-ia.spec.ts:182`. Rewrite `measurements.spec.ts:320-330` (rename + negative assertion). | Tests must exercise the new IA. No DB plumbing changes, so the rest of each spec is intact. |
| 11 | Routine ordering | **`created_at DESC`** — preserved from `src/api/routines.ts:14`. No `display_order` column today; no change. | Avoid schema scope creep; existing order is acceptable. |
| 12 | Zero-exercise routine starts a session? | **Yes** — `startSession({ routine_id })` runs and the live screen's existing empty state handles a routine with no `routine_exercises`. No client-side guard. | Matches current `routines/index.tsx` semantics; live screen already renders an empty state and allows ad-hoc exercise adds. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/_layout.tsx` | edited | Three surgical changes only: (1) add `options={{ href: null }}` to `<Tabs.Screen name="routines" />`; (2) drop the `ListChecks` import from `lucide-react-native`; (3) wrap the existing `<Tabs>` in a `<View className="flex-1">` and mount `<ActiveSessionBanner />` as a sibling above the `<Tabs>`. **Every other line — titles ("Workout", "Exercises", "History", "Measurements", "Profile") and icons (`Dumbbell`, `Wrench`, `History`, `Ruler`, `User`) — is preserved verbatim.** Verbatim post-change snippet in §UI spec. One responsibility: rewire tab IA + mount the global banner shell. |
| `app/(app)/workout/index.tsx` | edited | Rewrite as the unified hub. (1) Add `import { useColorScheme } from "react-native"` and `const colorScheme = useColorScheme()` (MIN-NEW-3; precedent `routines/index.tsx:3,10`). (2) Compute `const active = useActiveSession();` once at the top of the component. (3) **Loading gate**: immediately after hooks, branch on `if (active.isLoading) return <ActivityIndicator className="mt-12" />;` — this prevents the start handlers from inserting a second `sessions` row during the brief window where `active.data === undefined` (MAJ-NEW-1). The snippet matches the current `workout/index.tsx:53-58` precedent. (4) Drop the auto-redirect `useEffect` (lines 25-29) — the banner replaces it. (5) Delete the modal picker block (lines 88-139) and `pickerOpen` state (line 22). (6) FlatList of routines with a `ListHeaderComponent` containing the "Quick start workout" button + "Your routines" section header. (7) `Stack.Screen` `headerRight` renders a `+` button that opens `/(app)/routines/new`. (8) Both start handlers (`startAdHocWorkout`, `startFromRoutine`) check `active.data` and, if non-null, route to `/(app)/workout/${active.data.id}` instead of calling `startSession.mutateAsync`. (9) Routine cards render at `opacity-60` when `active.data` is non-null. (10) Tap routine card = `startFromRoutine`. (11) Each row renders `<RoutineListItem>` with the new `onEditPress` prop wired to `router.push('/(app)/routines/[id]')`. (12) Empty state per decision 5. |
| `src/components/routine-list-item.tsx` | edited | Two surgical changes. (1) Imports: extend the existing `lucide-react-native` import to `import { ChevronRight, Pencil } from "lucide-react-native"` (MIN-NEW-2). (2) Add optional `onEditPress?: () => void` and `disabled?: boolean` props. When `onEditPress` is set, render a right-aligned `<Pressable accessibilityLabel="Edit routine: ${name}">` with the `Pencil` icon + "Edit" label **instead of** the passive `<ChevronRight>`. The edit Pressable's `onPress` calls `e.stopPropagation?.()` before `onEditPress()` to prevent the outer row press from also firing on web. When `disabled` is true, the outer row Pressable becomes no-op and the row renders at `opacity-60`. When `onEditPress` is unset, keep current chevron-only behavior (backward compatible). The edit Pressable has `hitSlop={8}`. |
| `src/components/active-session-banner.tsx` | new | Sticky banner that reads `useActiveSession()` and renders a row pinned above the tab bar when a row is returned. Uses `<ChevronRight />` from `lucide-react-native` (not the U+203A glyph). Tap → `router.push('/(app)/workout/${active.id}')`. Returns `null` when `active.data` is null (covers `isLoading` and "no active" alike). |
| `app/(app)/routines/_layout.tsx` | unchanged | No code change. Stack stays; under `href: null` the parent Tabs still registers the segment so child routes resolve normally. |
| `app/(app)/routines/index.tsx` | edited | Replace entire body with a named redirect. New file body: `import { Redirect } from "expo-router"; export default function RoutinesRedirect() { return <Redirect href="/(app)/workout" />; }` (MIN-NEW-1). Drop all other imports. |
| `app/(app)/routines/new.tsx` | unchanged | No code edit. Reachable via `router.push("/(app)/routines/new")` from the Workout home header `+`. On save, `router.back()` at line 38 returns to `/workout`. |
| `app/(app)/routines/[id]/index.tsx` | unchanged | No code edit. Reachable via the "Edit" pill on each routine card. On delete, `router.back()` returns to `/workout`. |
| `tests/e2e/crud.spec.ts` | edited | (a) Lines 81-129 — remove the `getByText("Routines")` tab navigation; after sign-in lands on `/workout`, click the header `+` via `getByLabel("New routine")`, assert `/routines/new`, fill + save, assert URL returns to `/workout$` (not `/routines$`), assert the new routine name visible in the list, click the row's `Edit routine: <name>` pill, assert `/routines/[uuid]`, delete, assert URL back to `/workout$`, assert the routine is gone. (b) Line 170 — rename literal `"Start ad-hoc workout"` → `"Quick start workout"`. (c) Line 175 — same literal rename. |
| `tests/e2e/exercise-progress-ia.spec.ts` | edited | Line 182 — rename literal `"Start ad-hoc workout"` → `"Quick start workout"`. |
| `tests/e2e/measurements.spec.ts` | edited | Lines 320-330 — rename the test from `"regression: 6 tabs render, Profile shows weight + length unit toggles"` to `"regression: 5 tabs render, no Routines tab, Profile shows weight + length unit toggles"`. Remove the line-326 positive assertion that "Routines" is visible. Add a negative assertion: `await expect(page.getByText("Routines", { exact: true })).not.toBeVisible();`. |

## Contratos de I/O

### Component props

```ts
// src/components/routine-list-item.tsx
type Props = {
  routine: RoutineRow;
  onPress?: () => void;        // tap on the row body — starts a session (new caller contract)
  onEditPress?: () => void;    // tap on the Edit pill — pushes into the builder
  disabled?: boolean;          // when true, row renders dimmed (opacity-60) and outer Pressable is no-op
};
```

```ts
// src/components/active-session-banner.tsx
type Props = Record<string, never>; // no props — reads useActiveSession() internally
export function ActiveSessionBanner(): JSX.Element | null;
```

### Active-session guard contract (Workout home)

```ts
// Inside app/(app)/workout/index.tsx
const active = useActiveSession();

// MAJ-NEW-1 fix: gate the entire render branch until the active query settles,
// so the start handlers' `active.data` check has no race window.
if (active.isLoading) {
  return <ActivityIndicator className="mt-12" />;
}

const startAdHocWorkout = async () => {
  if (active.data) {
    router.push(`/(app)/workout/${active.data.id}`);
    return;
  }
  const row = await startSession.mutateAsync({});
  router.replace(`/(app)/workout/${row.id}`);
};

const startFromRoutine = async (r: RoutineRow) => {
  if (active.data) {
    router.push(`/(app)/workout/${active.data.id}`);
    return;
  }
  const row = await startSession.mutateAsync({ routine_id: r.id, name: r.name });
  router.replace(`/(app)/workout/${row.id}`);
};
```

### Route map after change

| URL | File | Behavior |
|---|---|---|
| `/(app)/workout` | `app/(app)/workout/index.tsx` | Unified home — Quick start CTA + routines list. |
| `/(app)/workout/[sessionId]` | `app/(app)/workout/[sessionId].tsx` | Unchanged. Live workout screen. |
| `/(app)/routines` | `app/(app)/routines/index.tsx` | **Redirect** → `/(app)/workout` (named `RoutinesRedirect` export). |
| `/(app)/routines/new` | `app/(app)/routines/new.tsx` | Unchanged. Create form. On save, `router.back()` returns to `/workout`. |
| `/(app)/routines/[id]` | `app/(app)/routines/[id]/index.tsx` | Unchanged. Builder. On delete, `router.back()` returns to `/workout`. |

### Hooks reused as-is (no signature change)

```ts
useActiveSession(): UseQueryResult<SessionRow | null, Error>;
useStartSession(): UseMutationResult<SessionRow, Error, StartInput, unknown>;
useRoutines(): UseQueryResult<RoutineRow[], Error>;
// (StartInput = { routine_id?: string|null; name?: string|null; notes?: string|null })
```

### DB / queries
No DB schema change. No new query. No new mutation. RLS untouched. Routine list order remains `created_at DESC` (`src/api/routines.ts:14`).

## UI spec

### Verbatim `app/(app)/_layout.tsx` post-change snippet

The diff is exactly three things: `href: null` on routines, drop `ListChecks` import, wrap `<Tabs>` in `<View>` for the banner. Everything else is identical to the current file.

```tsx
import { Tabs } from "expo-router";
import { View } from "react-native";
import {
  Clock,        // unchanged — used by History tab
  Dumbbell,     // unchanged — used by Workout tab
  Ruler,        // unchanged — used by Measurements tab
  User,         // unchanged — used by Profile tab
  Wrench,       // unchanged — used by Exercises tab
  History,      // unchanged — used by History tab (current import)
  // ListChecks — REMOVED (was routines tab icon)
} from "lucide-react-native";
import { ActiveSessionBanner } from "../../src/components/active-session-banner";

export default function AppLayout() {
  return (
    <View className="flex-1">
      <ActiveSessionBanner />
      <Tabs screenOptions={{ headerShown: false }}>
        <Tabs.Screen
          name="workout"
          options={{
            title: "Workout",
            tabBarIcon: ({ color, size }) => <Dumbbell color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="routines"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="exercises"
          options={{
            title: "Exercises",
            tabBarIcon: ({ color, size }) => <Wrench color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: "History",
            tabBarIcon: ({ color, size }) => <History color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="measurements"
          options={{
            title: "Measurements",
            tabBarIcon: ({ color, size }) => <Ruler color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
          }}
        />
      </Tabs>
    </View>
  );
}
```

**MAJ-NEW-2 explicit non-changes**: title stays `"Measurements"` (NOT "Body"); Exercises icon stays `Wrench` (NOT `Library`); History icon stays `History` (NOT `Clock`). Implementer must consult the current `app/(app)/_layout.tsx` for the exact import order — the lucide imports above mirror current usage; only `ListChecks` is removed.

### Unified Workout home (`app/(app)/workout/index.tsx`)

```
┌─────────────────────────────────────────────┐
│  Workout                              [ + ] │  ← Stack header. + = New routine.
├─────────────────────────────────────────────┤
│  • Workout in progress         Resume  ▶    │  ← ActiveSessionBanner (only when active.data)
├─────────────────────────────────────────────┤
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │       Quick start workout             │  │  ← <Button variant="primary"> full-width
│  └───────────────────────────────────────┘  │     starts ad-hoc (no routine_id).
│                                             │
│  Your routines                              │  ← section header text-gray-500 uppercase.
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ Push Day                    [✏ Edit]  │  │  ← RoutineListItem with onEditPress.
│  │ Heavy bench focus                     │  │     Row tap = start session.
│  ├───────────────────────────────────────┤  │     opacity-60 when active.data exists.
│  │ Pull Day                    [✏ Edit]  │  │
│  └───────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
        [Workout] [Exercises] [History] [Meas] [Profile]
```

#### Render-branch pseudo-code

```tsx
import { useColorScheme } from "react-native"; // MIN-NEW-3

export default function WorkoutHome() {
  const colorScheme = useColorScheme();        // MIN-NEW-3
  const routines = useRoutines();
  const active = useActiveSession();
  const startSession = useStartSession();
  const router = useRouter();

  // MAJ-NEW-1: gate the render branch on active.isLoading so the start handlers'
  // `active.data` check has no race window. Matches workout/index.tsx:53-58 precedent.
  if (active.isLoading) {
    return <ActivityIndicator className="mt-12" />;
  }

  const hasActive = !!active.data;

  // NO useEffect router.replace — that responsibility moves to ActiveSessionBanner.

  const startAdHocWorkout = async () => {
    if (active.data) { router.push(`/(app)/workout/${active.data.id}`); return; }
    const row = await startSession.mutateAsync({});
    router.replace(`/(app)/workout/${row.id}`);
  };

  const startFromRoutine = async (r: RoutineRow) => {
    if (active.data) { router.push(`/(app)/workout/${active.data.id}`); return; }
    const row = await startSession.mutateAsync({ routine_id: r.id, name: r.name });
    router.replace(`/(app)/workout/${row.id}`);
  };

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen
        options={{
          title: "Workout",
          headerShown: true,
          headerRight: () => (
            <Pressable onPress={() => router.push("/(app)/routines/new")} accessibilityLabel="New routine" className="px-3 py-1">
              <Plus color={colorScheme === "dark" ? "#fff" : "#000"} size={22} />
            </Pressable>
          ),
        }}
      />

      {routines.isLoading ? (
        <ActivityIndicator className="mt-12" />
      ) : !routines.data || routines.data.length === 0 ? (
        // Empty state — Quick start + Create routine (secondary).
        <View className="flex-1 items-center justify-center px-6">
          <Text className="mb-4 text-center text-base text-gray-500">
            No routines yet. Quick start a workout, or create your first routine below.
          </Text>
          <View className="w-full gap-3">
            <Button label="Quick start workout" onPress={startAdHocWorkout} loading={startSession.isPending} />
            <Button label="Create routine" variant="secondary" onPress={() => router.push("/(app)/routines/new")} />
          </View>
        </View>
      ) : (
        <FlatList
          data={routines.data}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={
            <View className="gap-3 px-4 py-4">
              <Button label="Quick start workout" onPress={startAdHocWorkout} loading={startSession.isPending} />
              <Text className="mt-2 text-xs uppercase tracking-wide text-gray-500">Your routines</Text>
            </View>
          }
          renderItem={({ item }) => (
            <RoutineListItem
              routine={item}
              onPress={() => startFromRoutine(item)}
              onEditPress={() => router.push(`/(app)/routines/${item.id}`)}
              disabled={hasActive}
            />
          )}
          refreshing={routines.isRefetching}
          onRefresh={routines.refetch}
        />
      )}
    </View>
  );
}
```

### Sticky active-session banner (`src/components/active-session-banner.tsx`)

```tsx
import { ChevronRight } from "lucide-react-native";

export function ActiveSessionBanner() {
  const active = useActiveSession();
  const router = useRouter();
  if (!active.data) return null;
  return (
    <Pressable
      onPress={() => router.push(`/(app)/workout/${active.data.id}`)}
      accessibilityRole="button"
      accessibilityLabel="Resume workout in progress"
      className="flex-row items-center justify-between bg-gray-900 px-4 py-2 dark:bg-gray-100"
    >
      <Text className="text-sm font-medium text-white dark:text-black">
        Workout in progress
      </Text>
      <View className="flex-row items-center gap-1">
        <Text className="text-sm text-white dark:text-black">Resume</Text>
        <ChevronRight color="#fff" size={16} />
      </View>
    </Pressable>
  );
}
```

### Edit-affordance variant of `RoutineListItem`

```tsx
import { ChevronRight, Pencil } from "lucide-react-native"; // MIN-NEW-2

// ...inside the component:
return (
  <Pressable
    onPress={disabled ? undefined : onPress}
    accessibilityRole="button"
    accessibilityLabel={`Start workout: ${routine.name}`}
    className={`flex-row items-center justify-between border-b border-gray-100 px-4 py-4 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950 ${disabled ? "opacity-60" : ""}`}
  >
    <View className="flex-1 pr-3">
      <Text className="text-base text-black dark:text-white">{routine.name}</Text>
      {routine.notes ? (
        <Text className="mt-0.5 text-sm text-gray-500" numberOfLines={2}>{routine.notes}</Text>
      ) : null}
    </View>
    {onEditPress ? (
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          onEditPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Edit routine: ${routine.name}`}
        hitSlop={8}
        className="flex-row items-center gap-1 rounded-md border border-gray-200 px-2 py-1 active:bg-gray-100 dark:border-gray-800 dark:active:bg-gray-900"
      >
        <Pencil color="#9ca3af" size={14} />
        <Text className="text-xs text-gray-500">Edit</Text>
      </Pressable>
    ) : (
      <ChevronRight color="#9ca3af" size={18} />
    )}
  </Pressable>
);
```

### Verbatim `app/(app)/routines/index.tsx` post-change body

```tsx
import { Redirect } from "expo-router";

export default function RoutinesRedirect() {
  return <Redirect href="/(app)/workout" />;
}
```

## Riscos & mitigações

### Data integrity
- **No schema migration, no RLS change.** `sessions.routine_id`, `routines`, `routine_exercises` untouched. All writes still go through hooks that inject `auth.user.id` server-side.
- **Orphan active sessions** — `src/api/sessions.ts:38-60` has no DB unique-partial-index on `(user_id) WHERE ended_at IS NULL`. Removing the home's auto-redirect would expose a path where the user starts a second session while one is active. **Mitigated** by two layers: (a) the `active.isLoading` early-return gate on the Workout home blocks every start CTA until the query settles (closes the race window from MAJ-NEW-1); (b) the client-side `active.data` guard in both `startAdHocWorkout` and `startFromRoutine` routes to the live screen instead of inserting. The `disabled`/`opacity-60` state on routine cards reinforces this at the UI layer. **A server-side guard remains a follow-up** (Out of scope below).

### UX regressions
- **`routines/index.tsx` previously used tap = builder.** No external caller besides itself; the new behavior (tap = start) is documented on the new home and the redirect makes the old URL unreachable interactively. **Risk: low.**
- **Auto-redirect on Workout home removed.** Returning to `/workout` while a session is live no longer snaps to the live screen; banner adds one tap to resume. Banner is sticky across tabs (better than the old behavior for users browsing routines while paused). **Acceptable.**
- **Brief spinner on Workout home cold-load.** The `active.isLoading` gate replaces the prior `useEffect`-driven redirect; users now see an `ActivityIndicator` for the same window of time `useActiveSession()` is in flight. Existing precedent at `workout/index.tsx:53-58` shows this is already the pattern in the live screen. **Risk: low.**
- **Tap on a routine card now starts a session immediately** with no confirmation. Strong's behavior; reversible via Finish + History soft-delete. **Risk: low.**
- **Header `+` semantics change.** First-day-after-deploy users who knew the Routines tab need to learn `+` lives on the Workout header. Mitigation: empty state copy + the inline "Create routine" button. **Risk: medium first-day, decays.**
- **Mid-session tap on a routine** — `opacity-60` + the guard re-routes to the live screen. No silent failure. **Risk: low.**

### Platform-specific
- **Expo Router v6 tab visibility** — A `Tabs.Screen` declared in the parent layout still auto-mounts the corresponding directory route as a tab unless `options={{ href: null }}` is set. This is the v6 behavior (`expo-router ~6.0.23`); bare removal of the `Tabs.Screen` line would re-mount with default options and a default label. Committed fix: `<Tabs.Screen name="routines" options={{ href: null }} />`. **Mitigated.**
- **Web bookmarks of `/routines`** — handled by the two-line `<Redirect>` forwarder, with a named `RoutinesRedirect` default export to avoid the `import/no-anonymous-default-export` lint rule (MIN-NEW-1). **Mitigated.**
- **Banner safe-area on iOS** — Banner mounts above `<Tabs>` inside `(app)/_layout.tsx`, sitting between the system status bar and each tab's per-screen `Stack.Screen` header. **Accepted v1 position** (MIN-NEW-4 / v1 MIN-8); follow-up if visual review flags it.
- **Android back button on `/routines/new` and `/routines/[id]`** — `router.back()` returns to `/workout` because that's the push origin. Verified for both `new.tsx:38` and `[id]/index.tsx`. **Risk: none.**
- **Browser back/forward on web** — pressing back after creating a routine lands on `/workout`. The `<Redirect>` at `/routines/index.tsx` is not in the back-stack (Expo Router replaces during redirect). **Risk: low.**
- **Nested Pressable bubbling on web** — Without `stopPropagation`, tapping the Edit pill on web could also fire the outer row's `onPress` (start-session). Edit pill `onPress` calls `e.stopPropagation?.()` before delegating. **Mitigated.**

### Performance
- **No new queries.** `useRoutines()` was already called unconditionally on the old Workout home (`workout/index.tsx:20`). `useActiveSession()` is now called once globally (in the banner) and once on the Workout home — react-query dedupes by key. **Risk: none.**
- **FlatList vs. ScrollView** — same render cost as the old modal-ScrollView for ≤50 routines per user. **Risk: none.**

## Alternativas descartadas

1. **Reading A (keep Routines tab + add routine cards on Workout home)** — descartada porque o prompt em PT-BR ("unificada") + "como no strong" não comportam manter duas telas. Reading A entrega metade do pedido e mantém duas listas duplicadas do mesmo recurso.
2. **Move `new.tsx` and `[id]/index.tsx` under `app/(app)/workout/routines/...`** (Option 2) — descartada porque move 3 arquivos e altera todas as `router.push` strings por benefício cosmético. A URL não é exposta ao usuário; o ganho de "mental model limpo" não paga o churn.
3. **Bare removal of `<Tabs.Screen name="routines" />`** (v1 plan) — descartada porque Expo Router v6 auto-mounts directory routes under a `Tabs` parent unless explicitly hidden. The bare deletion leaves the tab visible with default options. Fixed via `options={{ href: null }}`.
4. **`disabled={active.isLoading}` on Quick start + dim cards while loading** (instead of an early return) — descartada porque mistura dois estados visuais ("loading" e "active session") no mesmo affordance. The full-screen `ActivityIndicator` early-return matches the existing in-app precedent (`workout/index.tsx:53-58`) and is clearer to read.
5. **Long-press on the routine card to enter the builder** — descartada porque long-press é invisível na web e tem descoberta zero em mobile sem hint visual.
6. **Sticky FAB (floating "Quick start")** — descartada porque o padrão atual da base não usa FAB e o Strong usa botão full-width no topo.
7. **Drop the bookmark forwarder (`/routines` becomes 404)** — descartada porque o app web está em produção (`deploy:web pushes straight to production`). O custo da forwarder é uma linha; o custo de quebrar bookmarks é silencioso.
8. **Auto-redirect to live session when banner exists** (keep `router.replace` AND add the banner) — descartada porque dobra o mecanismo. O banner já comunica "há sessão ativa, toque para retomar" e permite ao usuário continuar editando rotinas.
9. **Confirmation modal on routine-card tap** ("Start workout: Push Day? [Cancel/Start]") — descartada porque Strong não pede confirmação e a ação é reversível (Finish + soft-delete).
10. **Title rename "Measurements" → "Body" and icon swaps (`Wrench → Library`, `History → Clock`)** — descartada porque (a) o prompt não pede; (b) `measurements.spec.ts:75,329` ainda assertam o título "Measurements"; (c) cosmetic icon polish é um run separado. Pinned as out of scope.
11. **Server-side unique partial index on `sessions(user_id) WHERE ended_at IS NULL`** — descartada para v3 (schema change, RLS impact). Out of scope; tracked below.

## Out of scope
- **Server-side unique partial index** on `sessions(user_id) WHERE ended_at IS NULL` — proper fix for the orphan-session class; v3 uses a client-side guard + loading gate only.
- **Tab title rename** (e.g. "Measurements" → "Body") and **tab icon polish** (Exercises/History glyph changes) — explicitly deferred; this run preserves current titles and icons verbatim.
- Routine reordering / drag-to-sort (no `display_order` column today).
- Multi-select / bulk delete on the routines list.
- Routine duplication ("Copy routine").
- Auto-progression, smart rest timers, periodised programs.
- Calendar / scheduled workouts.
- Public sharing of routines.
- Search/filter over the routines list (defer until count justifies it).
- Banner copy showing elapsed time (e.g. "Workout in progress · 12:34") — v3 ships static "Workout in progress".
- Toast/snackbar on the "active session blocks start" path — v3 relies on the routing + dim state; toast is a follow-up if user feedback warrants it.
- Banner safe-area refinement on iOS — accepted at the above-Tabs position.

## Resposta a issues do Validator v2

| Issue | Severity | Where addressed in v3 |
|---|---|---|
| **MAJ-NEW-1** Active-session guard race window — `active.data === undefined` while loading lets a second `startSession.mutateAsync` slip through | Major | Workout home now early-returns `<ActivityIndicator />` when `active.isLoading` is true. Snippet in `Contratos de I/O > Active-session guard contract` and in `UI spec > Render-branch pseudo-code`. Matches the existing `workout/index.tsx:53-58` precedent. The settled-value `active.data` guard in both handlers stays as the second layer. `Riscos > Data integrity` documents the two-layer mitigation. |
| **MAJ-NEW-2** Undeclared `_layout.tsx` snippet changes (title rename "Measurements" → "Body", icon swaps `Wrench → Library`, `History → Clock`) | Major | The verbatim post-change `_layout.tsx` snippet in `UI spec` preserves all five current tab titles ("Workout", "Exercises", "History", "Measurements", "Profile") and all current icons (`Dumbbell`, `Wrench`, `History`, `Ruler`, `User`). The **only** intentional `_layout.tsx` changes are enumerated explicitly: (1) add `options={{ href: null }}` to the routines tab; (2) drop the `ListChecks` import; (3) wrap `<Tabs>` in a `<View>` and mount `<ActiveSessionBanner />` as a sibling. Decision row 6 reiterates this. `Alternativas descartadas #10` explicitly pins the rename/icon-swap as out of scope. |
| **MIN-NEW-1** Anonymous default export in `routines/index.tsx` may trigger `import/no-anonymous-default-export` | Minor | `Mudanças por arquivo` row for `routines/index.tsx` + verbatim post-change body snippet in `UI spec` name the export `RoutinesRedirect`. Reflected in Decision row 9 and Route map. |
| **MIN-NEW-2** `Pencil` import must be added to `routine-list-item.tsx` | Minor | `Mudanças por arquivo` row spells out `import { ChevronRight, Pencil } from "lucide-react-native"` as a surgical extension of the existing import. The `Edit-affordance variant` snippet in `UI spec` shows the import line verbatim. |
| **MIN-NEW-3** Workout home `headerRight` snippet uses `colorScheme` — add `useColorScheme` import + hook call | Minor | `Mudanças por arquivo` row for `workout/index.tsx` lists `import { useColorScheme } from "react-native"` + `const colorScheme = useColorScheme()` as item (1) of the rewrite, citing the `routines/index.tsx:3,10` precedent. The `Render-branch pseudo-code` snippet shows both. |
| **MIN-NEW-4** Banner safe-area on iOS — accepted as v1 deferred | Minor | Pinned as accepted in `Riscos > Platform-specific > Banner safe-area on iOS` and listed in `Out of scope`. |

---

Status: **done**.
Recommendation to Conductor: invoke **Validator**.
