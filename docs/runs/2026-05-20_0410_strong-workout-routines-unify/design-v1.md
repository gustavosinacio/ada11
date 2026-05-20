# Design v1 — 2026-05-20_0410_strong-workout-routines-unify

## Goal (1 sentence)
Collapse the Routines tab into the Workout tab so the Workout home becomes a Strong-style unified entry point — Quick start CTA on top, user's routines listed below as tap-to-start cards with an edit affordance — while keeping all data plumbing untouched.

## Approach
We pick **Reading B** (drop the Routines tab; Workout becomes the unified hub). The prompt's "unificada" + explicit "como no strong" + the existing modal-picker pattern on Workout (already lists routines) make B the natural read; Reading A only delays the same outcome. We **keep routine create/edit routes at their current paths** (`/(app)/routines/new`, `/(app)/routines/[id]`) to minimise diff and avoid moving four files — they survive as a hidden stack reachable via `router.push` from the unified Workout home. We **replace the Workout home's auto-redirect** to the live session with a sticky "Resume workout" banner mounted in `(app)/_layout.tsx` so it is visible across every tab (Strong parity, and it lets a user start/edit routines mid-session). We **add a one-line web forwarder** `/(app)/routines/index.tsx → <Redirect href="/(app)/workout" />` to absorb saved bookmarks on the production web build. Tap on a routine card starts the session; a chevron-styled "Edit" affordance on the right of the card pushes into the builder. No schema, no API, no hooks change.

## Decisions on unknowns (from Discovery)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Reading A vs B | **B** — drop the Routines tab; Workout home unifies both. | Prompt wording ("unificada" + "como no strong") is unambiguous; A is a half-measure that still leaves two screens. |
| 2 | Where do `new` / `[id]` routine routes live? | **Option 1** — keep at `app/(app)/routines/...`; remove the Tabs.Screen entry only. | Cheapest diff (no file moves, no import-path churn). Routes still resolve via direct `router.push`. Path string is internal — users don't see it. |
| 3 | Active-session takeover | **Sticky "Resume workout" banner** in `(app)/_layout.tsx`, visible across all tabs. Drop the auto-`router.replace` from Workout home. | Strong parity. Banner lets the user create/edit routines while a session is paused. Single-redirect-on-mount was hostile to the new IA. |
| 4 | Quick-start CTA shape | **Full-width primary `<Button label="Quick start workout">`** rendered as a `ListHeaderComponent` above the routines FlatList. | Matches existing `measurements/history` precedent for header-above-list. Same `<Button>` component already in use. |
| 5 | Empty state (zero routines) | Centered text + Quick-start primary button + secondary "Create routine" button. Copy: "No routines yet. Quick start a workout, or tap + to create your first routine." | Both paths usable from empty state; explicit pointer to the header `+`. |
| 6 | Tab count + order | **5 tabs**: Workout / Exercises / History / Measurements / Profile. | Workout first (entry point), then library (Exercises), past (History), body (Measurements), Profile last. Matches sign-in landing target. |
| 7 | Routine-card affordance | **Single tap = start session with this routine.** Edit reached via a small "Edit" chevron pill on the right (visible, discoverable). Long-press not used (poor web parity). | Strong-style start-on-tap is the primary affordance. Long-press is invisible on web; an explicit edit button on the row is discoverable and platform-neutral. Inverts the current `routines/index.tsx` tap behavior (tap = builder) — that is the intended UX change. |
| 8 | Drop `ListChecks` import | Yes. | Mechanical cleanup. |
| 9 | Bookmark forwarder for `/routines` | **Yes** — `/(app)/routines/index.tsx` becomes `<Redirect href="/(app)/workout" />`. The file stays; only its body changes. | One line, eliminates the broken-bookmark class for the web prod app. Same file we'd otherwise gut. |
| 10 | E2E test rewrite | Rewrite `tests/e2e/crud.spec.ts:81-129` to drive from the Workout home (tap header `+` for create; tap card for start? No — for the **delete-routine** path, tap the row's "Edit" affordance to enter the builder). Update `tests/e2e/crud.spec.ts:170` literal "Start ad-hoc workout" → "Quick start workout". | Tests must exercise the new IA. No DB plumbing changes, so the rest of the spec is intact. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/_layout.tsx` | edited | Remove `<Tabs.Screen name="routines" ... />`. Drop the `ListChecks` import. Wrap the `<Tabs>` in a `<View className="flex-1">` (or fragment) and mount the new `<ActiveSessionBanner />` above the Tabs so it floats persistently across tab screens. |
| `app/(app)/workout/index.tsx` | edited | Rewrite as the unified hub: FlatList of routines with a `ListHeaderComponent` containing the "Quick start workout" button + "Your routines" section header. Header `+` (via `Stack.Screen options.headerRight`) opens `/(app)/routines/new`. Delete the modal picker block (lines 88-139) and the `pickerOpen` state. Drop the auto-redirect `useEffect` (lines 25-29) — the banner replaces it. Tap routine card = `startFromRoutine`. Each row renders the existing `<RoutineListItem>` with a new `onEditPress` prop wired to `router.push('/(app)/routines/[id]')`. Empty state per decision (5). |
| `src/components/routine-list-item.tsx` | edited | Add optional `onEditPress?: () => void` prop. When set, render a right-aligned `<Pressable accessibilityLabel="Edit routine">` with a `Pencil` (lucide) icon **instead of** the current passive `<ChevronRight>`. When unset, keep current chevron-only behavior (backward compatible — but no remaining caller after this change). The outer `<Pressable onPress={onPress}>` keeps the start-session tap target; the edit `<Pressable>` is a nested press target with `hitSlop` so taps land cleanly. |
| `src/components/active-session-banner.tsx` | new | Sticky banner that reads `useActiveSession()` and renders a row pinned above the tab bar (or below the safe-area top — see UI spec) when a row is returned. Tap → `router.push('/(app)/workout/${active.id}')`. Hidden when there is no active session. |
| `app/(app)/routines/_layout.tsx` | edited | No structural change — keep the Stack — but now it hosts a hidden nested stack (the parent Tabs no longer mounts it as a tab). No code edit required if Expo Router auto-resolves it. **Verify with Validator**: if removing the Tabs.Screen entry causes routes under `app/(app)/routines/` to no longer resolve, we must register them via a `<Stack.Screen>` somewhere. Most likely Expo Router resolves these as group routes anyway. If not, fallback is to move `new.tsx` and `[id]/index.tsx` under `app/(app)/workout/routines/...` (Option 2 fallback). |
| `app/(app)/routines/index.tsx` | edited | Replace entire body with `<Redirect href="/(app)/workout" />`. Keeps URL `/routines` resolvable on the web build (bookmark forwarder). Drop unused imports. |
| `app/(app)/routines/new.tsx` | unchanged | No code edit. Continues to be reachable via `router.push("/(app)/routines/new")` from the unified Workout home header `+`. `router.back()` on save returns to `/workout`. |
| `app/(app)/routines/[id]/index.tsx` | unchanged | No code edit. Reachable via the "Edit routine" affordance on each routine card. `router.back()` on delete returns to `/workout`. |
| `tests/e2e/crud.spec.ts` | edited | Two test rewrites: (a) lines 81-129 — remove the `getByText("Routines")` tab navigation; instead, after sign-in lands on `/workout`, click the header `+` (`getByLabel("New routine")`), assert `/routines/new`, fill + save, assert URL returns to `/workout$` (not `/routines$`), assert the new routine name is visible in the list, click the row's `Edit routine` button (new `accessibilityLabel`), assert `/routines/[uuid]`, delete, assert URL back to `/workout$`, assert the routine is gone. (b) Line 170 — rename literal `"Start ad-hoc workout"` → `"Quick start workout"`. |

## Contratos de I/O

### Component props

```ts
// src/components/routine-list-item.tsx
type Props = {
  routine: RoutineRow;
  onPress?: () => void;        // tap on the row body — starts a session (new caller contract)
  onEditPress?: () => void;    // tap on the Edit affordance — pushes into builder
};
```

```ts
// src/components/active-session-banner.tsx
type Props = Record<string, never>; // no props — reads useActiveSession() internally
export function ActiveSessionBanner(): JSX.Element | null;
```

### Route map after change

| URL | File | Behavior |
|---|---|---|
| `/(app)/workout` | `app/(app)/workout/index.tsx` | Unified home — Quick start CTA + routines list. |
| `/(app)/workout/[sessionId]` | `app/(app)/workout/[sessionId].tsx` | Unchanged. Live workout screen. |
| `/(app)/routines` | `app/(app)/routines/index.tsx` | **Redirect** → `/(app)/workout`. |
| `/(app)/routines/new` | `app/(app)/routines/new.tsx` | Unchanged. Create form. |
| `/(app)/routines/[id]` | `app/(app)/routines/[id]/index.tsx` | Unchanged. Builder. |

### Hooks reused as-is (no signature change)

```ts
useActiveSession(): UseQueryResult<SessionRow | null, Error>;
useStartSession(): UseMutationResult<SessionRow, Error, StartInput, unknown>;
useRoutines(): UseQueryResult<RoutineRow[], Error>;
// (StartInput = { routine_id?: string|null; name?: string|null; notes?: string|null })
```

### DB / queries
No DB schema change. No new query. No new mutation. RLS untouched.

## UI spec

### Unified Workout home (`app/(app)/workout/index.tsx`)

```
┌─────────────────────────────────────────────┐
│  Workout                              [ + ] │  ← Stack header. + = New routine.
├─────────────────────────────────────────────┤
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │       Quick start workout             │  │  ← <Button variant="primary"> full-width
│  └───────────────────────────────────────┘  │     starts ad-hoc (no routine_id).
│                                             │
│  Your routines                              │  ← section header text-gray-500 uppercase.
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ Push Day                       [Edit] │  │  ← RoutineListItem with onEditPress.
│  │ Heavy bench focus                     │  │     Row tap = start session.
│  ├───────────────────────────────────────┤  │
│  │ Pull Day                       [Edit] │  │
│  └───────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
        [Workout] [Exercises] [History] [Meas] [Profile]
```

#### Render-branch pseudo-code

```tsx
const routines = useRoutines();           // unchanged
const active = useActiveSession();        // still queried — informs the global banner
const start = useStartSession();

// NO useEffect router.replace — that responsibility moves to ActiveSessionBanner.

const startAdHoc = async () => { const row = await start.mutateAsync({}); router.replace(`/(app)/workout/${row.id}`); };
const startFromRoutine = async (r: RoutineRow) => { const row = await start.mutateAsync({ routine_id: r.id, name: r.name }); router.replace(`/(app)/workout/${row.id}`); };

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
          No routines yet. Quick start a workout, or tap + to create your first routine.
        </Text>
        <View className="w-full gap-3">
          <Button label="Quick start workout" onPress={startAdHoc} loading={start.isPending} />
          <Button label="Create routine" variant="secondary" onPress={() => router.push("/(app)/routines/new")} />
        </View>
      </View>
    ) : (
      <FlatList
        data={routines.data}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={
          <View className="gap-3 px-4 py-4">
            <Button label="Quick start workout" onPress={startAdHoc} loading={start.isPending} />
            <Text className="mt-2 text-xs uppercase tracking-wide text-gray-500">Your routines</Text>
          </View>
        }
        renderItem={({ item }) => (
          <RoutineListItem
            routine={item}
            onPress={() => startFromRoutine(item)}
            onEditPress={() => router.push(`/(app)/routines/${item.id}`)}
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

```
┌──────────────────────────────────────────────┐
│ • Workout in progress         Resume  ›      │  ← visible when useActiveSession().data exists
└──────────────────────────────────────────────┘
   [Workout] [Exercises] [History] [Meas] [Profile]
```

Mounted above the `<Tabs>` in `app/(app)/_layout.tsx`. Tap → `router.push('/(app)/workout/${active.id}')`. When user is **already** on `/(app)/workout/[sessionId]`, the banner still renders but the tap is a no-op visually (it's the same destination); for v1 we keep it visible everywhere for simplicity. Hidden when `active.data` is null. Dark-mode tokens: `bg-gray-900 dark:bg-gray-100` (inverted contrast against the page) to draw attention; text inverted accordingly.

```tsx
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
      <Text className="text-sm text-white dark:text-black">Resume ›</Text>
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
      {/* 5 Tabs.Screen — no Routines */}
    </Tabs>
  </View>
);
```

### Edit-affordance variant of `RoutineListItem`

```tsx
return (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`Start workout: ${routine.name}`}
    className="flex-row items-center justify-between border-b border-gray-100 px-4 py-4 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950"
  >
    <View className="flex-1 pr-3">
      <Text className="text-base text-black dark:text-white">{routine.name}</Text>
      {routine.notes ? (
        <Text className="mt-0.5 text-sm text-gray-500" numberOfLines={2}>{routine.notes}</Text>
      ) : null}
    </View>
    {onEditPress ? (
      <Pressable
        onPress={onEditPress}
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
- **No schema migration, no RLS change.** Zero risk on this axis. `sessions.routine_id`, `routines`, `routine_exercises` untouched. All writes still go through hooks that inject `auth.user.id` server-side.

### UX regressions
- **`routines/index.tsx` previously used the start-on-tap-inverse contract** (tap = builder). No external caller besides itself; the new behavior (tap = start) is documented in the new home and the redirect makes the old URL unreachable interactively. Mitigation: the redirect ensures no user keeps landing on the old list. **Risk: low**.
- **Auto-redirect on Workout home removed.** Today, returning to `/workout` while a session is live snapped you straight into the live screen. Replacing with a banner adds one tap. Mitigation: banner is sticky across tabs (better than the old behavior for users browsing routines while paused). **Acceptable tradeoff.**
- **Tap on a routine card now starts a session immediately** with no confirmation. If a user accidentally taps, they get a started session row. Mitigation: starting a session is reversible — the live screen has Finish (and the session is soft-deletable from History). Strong has the same behavior; no confirmation. **Risk: low**.
- **Header `+` semantics change.** On the old Workout home there was no `+`; on the old Routines home `+` created a routine. The unified screen reuses the routine-creation `+`. Discoverability of the routine-create entry: a user who previously navigated via the Routines tab now needs to learn the `+` lives on the Workout header. Mitigation: empty state copy points at the `+` explicitly ("tap + to create your first routine"). **Risk: medium for first-day-after-deploy.**

### Platform-specific
- **Web bookmarks of `/routines`** — handled by the redirect forwarder. **Mitigated.**
- **Banner safe-area on iOS** — must NOT extend into the status bar / notch. Wrap in a `<View>` outside `SafeAreaView` boundaries means it must sit below the native iOS top inset. The current `(app)/_layout.tsx` does not apply SafeAreaView; the tabs handle their own insets per-screen. **Mitigation**: position the banner so it sits between the screen header and the page body, not above the header — i.e., the banner appears at the top of the *content area*, below each tab's `Stack.Screen` header. **Validator should confirm by reading where `(app)/_layout.tsx` sits in the SafeArea tree.** If the simpler "above Tabs" position causes iOS layout glitches, fallback is to render the banner *inside* each tab's screen wrapper (more code duplication). Recommend Validator flag this for the Implementer.
- **Android back button on `/routines/new` and `/routines/[id]`** — `router.back()` returns to the previous URL. From Workout home this returns to `/workout`. Verified: `router.back()` after save in `new.tsx:38` and after delete in `[id]/index.tsx` works regardless of which screen pushed. **Risk: none.**
- **Browser back/forward on web** — pressing back after creating a routine should land on `/workout`. Since we push from `/workout` → `/routines/new`, `router.back()` lands on `/workout`. The `<Redirect>` at `/routines/index.tsx` is **not** in the back-stack (Expo Router replaces during redirect). **Risk: low.**

### Performance
- **No new queries.** `useRoutines()` was already called unconditionally on the old Workout home (`workout/index.tsx:20`). `useActiveSession()` is now called once **globally** (in the banner) and once on the Workout home — same as today (the home still wants it for any future logic; we keep it for consistency, no perf hit since react-query dedupes by key). **Risk: none.**
- **FlatList vs. ScrollView** — the new home uses FlatList (current Routines screen pattern). For ≤50 routines per user this is the same render cost as the old ScrollView-in-modal. **Risk: none.**

## Alternativas descartadas

1. **Reading A (keep Routines tab + add routine cards on Workout home)** — descartada porque o prompt em PT-BR ("unificada") + a comparação explícita "como no strong" não comportam manter duas telas. A leitura A entrega metade do que o usuário pediu e gera dois locais com listas duplicadas do mesmo recurso.
2. **Move `new.tsx` and `[id]/index.tsx` under `app/(app)/workout/routines/...`** (Option 2) — descartada porque move 3 arquivos e altera todas as URLs internas/strings de `router.push` por benefício cosmético. A URL não é exposta ao usuário; o ganho de "mental model limpo" não paga o churn. Mantida como fallback caso o Expo Router não resolva o stack órfão (ver "risco" na linha do `routines/_layout.tsx`).
3. **Long-press on the routine card to enter the builder** — descartada porque long-press é invisível na web (sem cursor hover state, sem affordance) e tem descoberta zero em mobile sem hint visual. O botão "Edit" lateral resolve discoverability + paridade de plataforma.
4. **Sticky FAB (floating "Quick start")** — descartada porque o padrão atual da base não usa FAB em nenhuma tela, e o Strong (referência citada) usa botão full-width no topo, não FAB.
5. **Drop the bookmark forwarder (`/routines` becomes 404)** — descartada porque o app web está em produção (`deploy:web pushes straight to production`, recent commit a555868). O custo da forwarder é uma linha; o custo de quebrar bookmarks é silencioso e impossível de medir.
6. **Auto-redirect to live session when banner exists** (keep the `router.replace` AND add the banner) — descartada porque dobra o mecanismo. O banner já comunica "há sessão ativa, toque para retomar" e permite ao usuário continuar editando rotinas. O redirect automático era hostil ao novo IA.

## Out of scope
- Routine reordering / drag-to-sort (no `display_order` column today; defer).
- Multi-select / bulk delete on the routines list.
- Routine duplication ("Copy routine").
- Auto-progression, smart rest timers, periodised programs.
- Calendar / scheduled workouts.
- Public sharing of routines.
- Search/filter over the routines list (defer until count justifies it).
- Customising the banner copy per-context (e.g. show elapsed time inside the banner) — v1 ships static "Workout in progress".

## Open questions for Validator

1. **Does Expo Router resolve `app/(app)/routines/new.tsx` and `app/(app)/routines/[id]/index.tsx` when the parent group has no `Tabs.Screen` entry?** I believe yes (Expo Router resolves all file-based routes regardless of Tabs registration — Tabs only controls what shows in the tab bar). Validator: verify by grep on Expo Router docs / similar precedents in the repo (e.g., `/sign-in` resolves without being a tab). If no, fall back to Option 2 (move files under `app/(app)/workout/routines/...`).
2. **Banner placement vs. SafeArea on iOS** — confirm whether mounting `<ActiveSessionBanner />` above `<Tabs>` inside `(app)/_layout.tsx` collides with the native header inset on iOS. If the per-tab Stack headers are rendered *below* the banner, the banner ends up between the system status bar and the screen header — visually clean but potentially odd. Validator should propose a concrete placement (above Stack headers, between header and content, or above tab bar at the bottom) or defer to Implementer with a flag.
3. **Tap-targets on `RoutineListItem` with nested Pressables** — the row-level `<Pressable onPress={startFromRoutine}>` wraps an inner `<Pressable onPress={onEditPress}>`. React Native handles this via event bubbling (inner Pressable consumes the tap); confirm web does the same. If web bubbles to both, mitigation is `onPress={(e) => { e.stopPropagation?.(); onEditPress(); }}`.

---

Status: **done**.
Recommendation to Conductor: invoke **Validator**.
