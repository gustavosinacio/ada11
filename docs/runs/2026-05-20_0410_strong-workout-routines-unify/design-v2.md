# Design v2 — 2026-05-20_0410_strong-workout-routines-unify

## Goal (1 sentence)
Collapse the Routines tab into the Workout tab so the Workout home becomes a Strong-style unified entry point — Quick start CTA on top, user's routines listed below as tap-to-start cards with an edit affordance — while keeping all data plumbing untouched.

## Approach
We carry forward **Reading B** (drop the Routines tab from the bar; Workout becomes the unified hub) and **Option 1 for routes** (keep create/edit at `/(app)/routines/...`, no file moves). The hide-the-tab mechanism is now committed: we **keep** `<Tabs.Screen name="routines" />` in `app/(app)/_layout.tsx` and pass `options={{ href: null }}` — Expo Router v6 auto-mounts directory routes under a `Tabs` parent, so a bare removal of the line would leave the tab visible with default options (this was BLK-1 in v1). We **replace the Workout home's auto-redirect** to the live session with a sticky `<ActiveSessionBanner />` mounted in `(app)/_layout.tsx`, visible across every tab (Strong parity, and it lets the user start/edit routines while paused). We **guard the new start CTAs** against orphaning a second in-progress `sessions` row: both `startAdHocWorkout` and `startFromRoutine` short-circuit to the live screen when `useActiveSession().data` is non-null, and the routine cards dim to `opacity-60` to communicate the blocked state (Strong's behavior). A one-line `<Redirect>` forwarder at `/(app)/routines/index.tsx` absorbs saved web bookmarks. The shared `RoutineListItem` grows an `onEditPress` prop for the inline Edit pill; tap on the row body starts the session. No schema, no API, no hook signature change.

## Decisions on unknowns (from Discovery)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Reading A vs B | **B** — drop the Routines tab; Workout home unifies both. | Prompt wording ("unificada" + "como no strong") is unambiguous; A is a half-measure that still leaves two screens. |
| 2 | Where do `new` / `[id]` routine routes live? | **Option 1** — keep at `app/(app)/routines/...`; hide the Tabs entry with `href: null`. | Cheapest diff (no file moves, no import-path churn). Routes still resolve via direct `router.push`. Path string is internal — users don't see it. |
| 3 | Active-session takeover | **Sticky "Workout in progress" banner** in `(app)/_layout.tsx`, visible across all tabs. Drop the auto-`router.replace` from Workout home. Client-side guard on start CTAs to prevent orphan rows. | Strong parity. Banner lets the user create/edit routines while a session is paused. Single-redirect-on-mount was hostile to the new IA. Guard closes the latent "start while active" hole exposed by removing the redirect. |
| 4 | Quick-start CTA shape | **Full-width primary `<Button label="Quick start workout">`** rendered as a `ListHeaderComponent` above the routines FlatList. | Matches existing `measurements/history` precedent. Same `<Button>` component already in use. |
| 5 | Empty state (zero routines) | Centered text + Quick-start primary button + secondary "Create routine" button. Copy: **"No routines yet. Quick start a workout, or create your first routine below."** (drop the "tap +" wording; the inline button is the discoverable path — MIN-2.) | Both paths usable from empty state; the labelled button is more discoverable than the header `+`. |
| 6 | Tab count + order | **5 tabs**: Workout / Exercises / History / Measurements / Profile. | Workout first (entry point), then library (Exercises), past (History), body (Measurements), Profile last. Matches sign-in landing target. |
| 7 | Routine-card affordance | **Single tap = start session with this routine.** Edit reached via a small "Edit" pill on the right (Pencil icon + "Edit" label, with `e.stopPropagation?.()` before `router.push`). | Strong-style start-on-tap is the primary affordance. Long-press is invisible on web; an explicit edit button is discoverable and platform-neutral. |
| 8 | Drop `ListChecks` import | Yes. | Mechanical cleanup; the icon is no longer rendered (tab is hidden, not styled). |
| 9 | Bookmark forwarder for `/routines` | **Yes** — `/(app)/routines/index.tsx` becomes a two-line `<Redirect href="/(app)/workout" />` (MIN-9). | One line of logic, eliminates the broken-bookmark class for the web prod app. |
| 10 | E2E test rewrite | Rewrite `tests/e2e/crud.spec.ts:81-129` to drive from the Workout home (tap header `+` for create; tap the row's "Edit" pill for the delete path). Update copy literal `"Start ad-hoc workout"` → `"Quick start workout"` at **`crud.spec.ts:170`, `crud.spec.ts:175`, AND `exercise-progress-ia.spec.ts:182`** (MAJ-1). Rewrite `measurements.spec.ts:320-330` (MAJ-2). | Tests must exercise the new IA. No DB plumbing changes, so the rest of each spec is intact. |
| 11 | Routine ordering | **`created_at DESC`** — preserved from `src/api/routines.ts:14`. No `display_order` column today; no change in v2 (MIN-3). | Avoid schema scope creep; existing order is acceptable. |
| 12 | Zero-exercise routine starts a session? | **Yes** — `startSession({ routine_id })` runs and the live screen's existing empty state handles a routine with no `routine_exercises`. No client-side guard (MIN-4). | Matches current `routines/index.tsx` semantics; live screen already renders an empty state and allows ad-hoc exercise adds. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/_layout.tsx` | edited | **Keep** `<Tabs.Screen name="routines" />` but pass `options={{ href: null }}` — hides it from the tab bar while leaving `app/(app)/routines/...` resolvable via `router.push`. Drop the `ListChecks` import. Wrap the `<Tabs>` in a `<View className="flex-1">` and mount `<ActiveSessionBanner />` above the Tabs so it floats persistently across tab screens (above-Tabs placement is the accepted v1 position — MIN-8). One responsibility: rewire tab IA + mount the global banner shell (single concern: "the app chrome"). |
| `app/(app)/workout/index.tsx` | edited | Rewrite as the unified hub: FlatList of routines with a `ListHeaderComponent` containing the "Quick start workout" button + "Your routines" section header. `Stack.Screen` `headerRight` renders a `+` button that opens `/(app)/routines/new`. Delete the modal picker block (lines 88-139) and `pickerOpen` state (line 22). Drop the auto-redirect `useEffect` (lines 25-29) — the banner replaces it. Both start handlers (`startAdHocWorkout`, `startFromRoutine`) first check `useActiveSession().data` and, if non-null, route to `/(app)/workout/${active.data.id}` instead of calling `startSession.mutateAsync` (MAJ-3). Routine cards render at `opacity-60` when `active.data` is non-null (MAJ-3 / MIN-10). Tap routine card = `startFromRoutine`. Each row renders `<RoutineListItem>` with a new `onEditPress` prop wired to `router.push('/(app)/routines/[id]')`. Empty state per decision (5). |
| `src/components/routine-list-item.tsx` | edited | Add optional `onEditPress?: () => void` prop. When set, render a right-aligned `<Pressable accessibilityLabel="Edit routine ...">` with a `Pencil` (lucide) icon + "Edit" label **instead of** the passive `<ChevronRight>`. The edit Pressable's `onPress` calls `e.stopPropagation?.()` before `onEditPress()` (MIN-5) to prevent the outer row press from also firing on web. When unset, keep current chevron-only behavior (backward compatible). The outer row Pressable keeps the start-session tap target; the edit Pressable has `hitSlop={8}`. |
| `src/components/active-session-banner.tsx` | new | Sticky banner that reads `useActiveSession()` and renders a row pinned above the tab bar when a row is returned. Uses `<ChevronRight />` from `lucide-react-native` (not the U+203A glyph — MIN-7). Tap → `router.push('/(app)/workout/${active.id}')`. Hidden when `active.data` is null. |
| `app/(app)/routines/_layout.tsx` | unchanged | No code change (MIN-1). Stack stays; under `href: null` the parent Tabs still registers the segment so child routes resolve normally. |
| `app/(app)/routines/index.tsx` | edited | Replace entire body with the two-line redirect: `import { Redirect } from "expo-router"; export default function () { return <Redirect href="/(app)/workout" />; }` (MIN-9). Drop all other imports. |
| `app/(app)/routines/new.tsx` | unchanged | No code edit. Reachable via `router.push("/(app)/routines/new")` from the Workout home header `+`. On save, `router.back()` at line 38 returns to `/workout` (MIN-6). |
| `app/(app)/routines/[id]/index.tsx` | unchanged | No code edit. Reachable via the "Edit" pill on each routine card. On delete, `router.back()` returns to `/workout`. |
| `tests/e2e/crud.spec.ts` | edited | (a) Lines 81-129 — remove the `getByText("Routines")` tab navigation; after sign-in lands on `/workout`, click the header `+` via `getByLabel("New routine")`, assert `/routines/new`, fill + save, assert URL returns to `/workout$` (not `/routines$`), assert the new routine name visible in the list, click the row's `Edit routine: <name>` pill, assert `/routines/[uuid]`, delete, assert URL back to `/workout$`, assert the routine is gone. (b) Line 170 — rename literal `"Start ad-hoc workout"` → `"Quick start workout"`. (c) Line 175 — same literal rename (MAJ-1). |
| `tests/e2e/exercise-progress-ia.spec.ts` | edited | Line 182 — rename literal `"Start ad-hoc workout"` → `"Quick start workout"` (MAJ-1). |
| `tests/e2e/measurements.spec.ts` | edited | Lines 320-330 — rename the test from `"regression: 6 tabs render, Profile shows weight + length unit toggles"` to `"regression: 5 tabs render, no Routines tab, Profile shows weight + length unit toggles"`. Remove the line-326 positive assertion that "Routines" is visible. Add a negative assertion: `await expect(page.getByText("Routines", { exact: true })).not.toBeVisible();` (MAJ-2). |

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
| `/(app)/routines` | `app/(app)/routines/index.tsx` | **Redirect** → `/(app)/workout`. |
| `/(app)/routines/new` | `app/(app)/routines/new.tsx` | Unchanged. Create form. On save, `router.back()` returns to `/workout` (MIN-6). |
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
const routines = useRoutines();
const active = useActiveSession();
const startSession = useStartSession();
const router = useRouter();
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
      <ActivityIndicator … />
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

Wrapping in `_layout.tsx`:

```tsx
return (
  <View className="flex-1">
    <ActiveSessionBanner />
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="workout" options={{ title: "Workout", tabBarIcon: ({ color, size }) => <Dumbbell color={color} size={size} /> }} />
      <Tabs.Screen name="routines" options={{ href: null }} />
      <Tabs.Screen name="exercises" options={{ title: "Exercises", tabBarIcon: ({ color, size }) => <Library color={color} size={size} /> }} />
      <Tabs.Screen name="history" options={{ title: "History", tabBarIcon: ({ color, size }) => <Clock color={color} size={size} /> }} />
      <Tabs.Screen name="measurements" options={{ title: "Body", tabBarIcon: ({ color, size }) => <Ruler color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
    </Tabs>
  </View>
);
```

### Edit-affordance variant of `RoutineListItem`

```tsx
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

## Riscos & mitigações

### Data integrity
- **No schema migration, no RLS change.** `sessions.routine_id`, `routines`, `routine_exercises` untouched. All writes still go through hooks that inject `auth.user.id` server-side.
- **Orphan active sessions** — `src/api/sessions.ts:38-60` has no DB unique-partial-index on `(user_id) WHERE ended_at IS NULL`. Removing the home's auto-redirect would expose a path where the user starts a second session while one is active. **Mitigated** by the client-side guard in both `startAdHocWorkout` and `startFromRoutine` (see Contratos) — when `active.data` is non-null, the handlers route to the live screen instead of inserting. The `disabled`/`opacity-60` state on routine cards reinforces this at the UI layer. **A server-side guard remains a follow-up** (Out of scope below).

### UX regressions
- **`routines/index.tsx` previously used tap = builder.** No external caller besides itself; the new behavior (tap = start) is documented on the new home and the redirect makes the old URL unreachable interactively. **Risk: low.**
- **Auto-redirect on Workout home removed.** Returning to `/workout` while a session is live no longer snaps to the live screen; banner adds one tap to resume. Banner is sticky across tabs (better than the old behavior for users browsing routines while paused). **Acceptable.**
- **Tap on a routine card now starts a session immediately** with no confirmation. Strong's behavior; reversible via Finish + History soft-delete. **Risk: low.**
- **Header `+` semantics change.** First-day-after-deploy users who knew the Routines tab need to learn `+` lives on the Workout header. Mitigation: empty state copy + the inline "Create routine" button. **Risk: medium first-day, decays.**
- **Mid-session tap on a routine** — `opacity-60` + the guard re-routes to the live screen. No silent failure. **Risk: low.**

### Platform-specific
- **Expo Router v6 tab visibility** — A `Tabs.Screen` declared in the parent layout still auto-mounts the corresponding directory route as a tab unless `options={{ href: null }}` is set. This is the v6 behavior (`expo-router ~6.0.23`); bare removal of the `Tabs.Screen` line would re-mount with default options and a default label. The committed fix is `<Tabs.Screen name="routines" options={{ href: null }} />`, which hides the tab while keeping `app/(app)/routines/new` and `app/(app)/routines/[id]` resolvable via `router.push`. **Mitigated.**
- **Web bookmarks of `/routines`** — handled by the two-line `<Redirect>` forwarder (MIN-9). **Mitigated.**
- **Banner safe-area on iOS** — Banner mounts above `<Tabs>` inside `(app)/_layout.tsx`, sitting between the system status bar and each tab's per-screen `Stack.Screen` header. **Accepted v1 position** (MIN-8); follow-up if visual review flags it.
- **Android back button on `/routines/new` and `/routines/[id]`** — `router.back()` returns to `/workout` because that's the push origin. Verified for both `new.tsx:38` and `[id]/index.tsx`. **Risk: none.**
- **Browser back/forward on web** — pressing back after creating a routine lands on `/workout`. The `<Redirect>` at `/routines/index.tsx` is not in the back-stack (Expo Router replaces during redirect). **Risk: low.**
- **Nested Pressable bubbling on web** — Without `stopPropagation`, tapping the Edit pill on web could also fire the outer row's `onPress` (start-session). Edit pill `onPress` calls `e.stopPropagation?.()` before delegating (MIN-5). **Mitigated.**

### Performance
- **No new queries.** `useRoutines()` was already called unconditionally on the old Workout home (`workout/index.tsx:20`). `useActiveSession()` is now called once globally (in the banner) and once on the Workout home — react-query dedupes by key. **Risk: none.**
- **FlatList vs. ScrollView** — same render cost as the old modal-ScrollView for ≤50 routines per user. **Risk: none.**

## Alternativas descartadas

1. **Reading A (keep Routines tab + add routine cards on Workout home)** — descartada porque o prompt em PT-BR ("unificada") + "como no strong" não comportam manter duas telas. Reading A entrega metade do pedido e mantém duas listas duplicadas do mesmo recurso.
2. **Move `new.tsx` and `[id]/index.tsx` under `app/(app)/workout/routines/...`** (Option 2) — descartada porque move 3 arquivos e altera todas as `router.push` strings por benefício cosmético. A URL não é exposta ao usuário; o ganho de "mental model limpo" não paga o churn.
3. **Bare removal of `<Tabs.Screen name="routines" />`** (v1 plan) — descartada porque Expo Router v6 auto-mounts directory routes under a `Tabs` parent unless explicitly hidden. The bare deletion leaves the tab visible with default options. Fixed via `options={{ href: null }}`.
4. **Long-press on the routine card to enter the builder** — descartada porque long-press é invisível na web e tem descoberta zero em mobile sem hint visual.
5. **Sticky FAB (floating "Quick start")** — descartada porque o padrão atual da base não usa FAB e o Strong usa botão full-width no topo.
6. **Drop the bookmark forwarder (`/routines` becomes 404)** — descartada porque o app web está em produção (`deploy:web pushes straight to production`). O custo da forwarder é uma linha; o custo de quebrar bookmarks é silencioso.
7. **Auto-redirect to live session when banner exists** (keep `router.replace` AND add the banner) — descartada porque dobra o mecanismo. O banner já comunica "há sessão ativa, toque para retomar" e permite ao usuário continuar editando rotinas.
8. **Confirmation modal on routine-card tap** ("Start workout: Push Day? [Cancel/Start]") — descartada porque Strong não pede confirmação e a ação é reversível (Finish + soft-delete).
9. **Server-side unique partial index on `sessions(user_id) WHERE ended_at IS NULL`** — descartada para v2 (schema change, RLS impact). Out of scope; tracked below.

## Out of scope
- **Server-side unique partial index** on `sessions(user_id) WHERE ended_at IS NULL` — proper fix for the orphan-session class; v2 uses a client-side guard only.
- Routine reordering / drag-to-sort (no `display_order` column today).
- Multi-select / bulk delete on the routines list.
- Routine duplication ("Copy routine").
- Auto-progression, smart rest timers, periodised programs.
- Calendar / scheduled workouts.
- Public sharing of routines.
- Search/filter over the routines list (defer until count justifies it).
- Banner copy showing elapsed time (e.g. "Workout in progress · 12:34") — v2 ships static "Workout in progress".
- Toast/snackbar on the "active session blocks start" path — v2 relies on the routing + dim state; toast is a follow-up if user feedback warrants it.

## Resposta a issues do Validator

| Issue | Severity | Where addressed in v2 |
|---|---|---|
| **BLK-1** Removing `<Tabs.Screen name="routines" />` does not hide the tab in Expo Router v6 | Blocker | `Mudanças por arquivo` row for `app/(app)/_layout.tsx`: keep the line, add `options={{ href: null }}`. Drop `ListChecks` import. Cited in `Riscos > Platform-specific > Expo Router v6 tab visibility`. Also covered in `Alternativas descartadas #3`. |
| **MAJ-1** Three test lines reference `"Start ad-hoc workout"` literal | Major | `Mudanças por arquivo` rows for `tests/e2e/crud.spec.ts` (lines 170 + 175) and `tests/e2e/exercise-progress-ia.spec.ts` (line 182). All three changed to `"Quick start workout"`. |
| **MAJ-2** `measurements.spec.ts:320-330` asserts 6 tabs + Routines visible | Major | New `Mudanças por arquivo` row for `tests/e2e/measurements.spec.ts`: rename test, remove positive assertion, add negative assertion `await expect(page.getByText("Routines", { exact: true })).not.toBeVisible();`. |
| **MAJ-3** No client-side guard against starting a second active session | Major | New `Contratos de I/O > Active-session guard contract` section. Both `startAdHocWorkout` and `startFromRoutine` check `useActiveSession().data` first and route to live screen if present. Routine cards dim to `opacity-60`. `RoutineListItem` gains a `disabled` prop. `Riscos > Data integrity` documents the gap and the mitigation; server-side index tracked in `Out of scope`. |
| **MIN-1** Confirm `routines/_layout.tsx` stays unchanged | Minor | `Mudanças por arquivo` row marks it `unchanged` with explicit "No code change" note. |
| **MIN-2** Pick one signal for create-routine in empty state | Minor | Decision row 5 — keep the inline "Create routine" button; copy drops the "tap +" wording. New copy: "No routines yet. Quick start a workout, or create your first routine below." |
| **MIN-3** Pin routine list order | Minor | Decision row 11 — `created_at DESC` preserved from `src/api/routines.ts:14`. Reiterated in `DB / queries`. |
| **MIN-4** Zero-exercise routine behavior | Minor | Decision row 12 — starts a session; live screen's empty state handles it; no client-side guard. |
| **MIN-5** Nested Pressable bubbling | Minor | Edit pill `onPress` calls `e.stopPropagation?.()` before `onEditPress()`. Shown in `Edit-affordance variant of RoutineListItem` snippet. Listed in `Riscos > Platform-specific`. |
| **MIN-6** Pin route map for `routines/new.tsx:38` | Minor | `Route map after change` table — explicit `router.back()` returns to `/workout` note for `/(app)/routines/new` and `/(app)/routines/[id]`. |
| **MIN-7** Banner chevron is a U+203A glyph | Minor | Banner snippet now imports `ChevronRight` from `lucide-react-native` and renders `<ChevronRight color="#fff" size={16} />`. |
| **MIN-8** Banner placement | Minor | Decision recorded in `Mudanças por arquivo` (`_layout.tsx` row) and `Riscos > Platform-specific`: above-Tabs placement accepted as v1; sits between status bar and per-screen `Stack.Screen` header on iOS. |
| **MIN-9** Reduce `routines/index.tsx` to two lines | Minor | `Mudanças por arquivo` row gives the exact two-line file body. |
| **MIN-10** Dim routine cards when active session exists | Minor | Rolled into MAJ-3 — `RoutineListItem` gains `disabled` prop, rendered at `opacity-60` and Pressable becomes no-op when `hasActive` is true. |

---

Status: **done**.
Recommendation to Conductor: invoke **Validator**.
