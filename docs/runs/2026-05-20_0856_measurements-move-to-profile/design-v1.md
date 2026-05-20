# Design v1 — 2026-05-20_0856_measurements-move-to-profile

## Goal (1 sentence)
Move the Measurements entry point off the bottom tab bar and into the Profile screen as a bordered single-row card (Ruler icon + "Measurements" + ChevronRight), while keeping `/(app)/measurements` and its child routes fully resolvable.

## Approach
Replicate the just-shipped Routines hide-pattern verbatim — `<Tabs.Screen name="measurements" options={{ href: null }} />` in `app/(app)/_layout.tsx`, plus dropping the now-unused `Ruler` import (which migrates to `profile.tsx`). Diverge from the Routines precedent in exactly one place: `measurements/index.tsx` stays as the list/history screen (no `<Redirect>`), because the brief explicitly preserves the Measurements feature behind the new entry point. Add a single bordered card on Profile between the existing "Preferences" and "About" sections, hand-rolled with the same primitives already in `profile.tsx` (`Pressable`, `View`, `Text`, lucide icons) — no new component, no extension of the read-only `<Row>` helper. The card mirrors the visual treatment of the Preferences/About cards (`rounded-lg border border-gray-200 dark:border-gray-800 mb-8`) and pushes `/(app)/measurements` on press. Tab order after the change: Workout / Exercises / History / Profile (4 visible; 2 hidden: Routines + Measurements). Test impact: rewrite the `goToMeasurements` helper, flip one tab-count test from "5 tabs render" to "4 tabs render", and rewrite the banner-across-tabs Measurements arm in `probe-strong-unify.spec.ts`.

## Decisions on unknowns (from Discovery)

| # | Unknown | Decision | Rationale |
|---|---|---|---|
| 1 | Entry-point shape on Profile (Row helper / dedicated card / standalone Button) | **Dedicated single-row bordered card** with `Ruler` icon (left) + "Measurements" label + `ChevronRight` (right). Hand-rolled `Pressable`, no new component. | Brief constraint: no new component just for this entry-point; match Preferences/About visual rhythm. The existing `<Row>` helper renders `ChevronRight` at `opacity-0` — extending it with `onPress` would couple a read-only helper to nav semantics. Hand-rolled `Pressable` keeps `Row` untouched (one-responsibility per file). |
| 2 | Placement inside the Profile screen | **Between Preferences and About.** | Settings (unit toggles) → feature affordance (Measurements) → metadata (About) → destructive (Sign out). Groups affordances together. Specified in brief. |
| 3 | Label string | **"Measurements"** (verbatim). | Matches the just-removed tab title + route name; preserves existing E2E selectors verbatim (`measurements.spec.ts:75` and similar). Brief-pinned. |
| 4 | Section header above the card | **None** — bare card with no uppercase header. | The card is a single navigation row, not a settings group. Adding a "Tracking"/"Body" header for one row reads heavier than the row itself. The Pressable's left-side icon + label are already a self-describing affordance. |
| 5 | `/measurements` URL behavior | **Stays a working list screen.** No `<Redirect>` forwarder. | Explicit brief constraint and explicit divergence from the Routines precedent. Web bookmarks of `/measurements` continue to land on the list. Expo Router v6 still registers the segment under `href: null`, so direct `router.push` and direct URL entry both resolve. |
| 6 | `_layout.tsx` non-changes | **Preserve verbatim**: titles "Workout", "Exercises", "History", "Profile"; icons `Dumbbell`, `Wrench`, `History`, `User`; routines `<Tabs.Screen>` hidden line untouched; `ActiveSessionBanner` wrapper untouched. | Only two intentional changes: (a) `href: null` on Measurements `<Tabs.Screen>`; (b) drop `Ruler` import. Brief-pinned. |
| 7 | Tab order / count after change | **4 visible tabs**: Workout / Exercises / History / Profile. **2 hidden**: Routines + Measurements. | Mechanical consequence of (6). |
| 8 | `Ruler` import destination | **Move from `_layout.tsx` to `profile.tsx`.** | Confirmed in Discovery (Unknown 8): `Ruler` is only consumed in `_layout.tsx` today; after this run, only `profile.tsx` needs it. |
| 9 | Active session banner during Profile→Measurements nav | **No code change.** Banner mounts globally above `<Tabs>`; persists across all screens including Measurements reached via Profile. | Sanity check from Discovery (Unknown 5); flagged only to avoid over-thinking. |
| 10 | E2E coverage of the new IA — add a dedicated probe? | **No new spec file.** Adjust `tests/e2e/measurements.spec.ts:74-77` helper + `:320-342` regression + `probe-strong-unify.spec.ts:66-78` + `:128-131`. The combined coverage already asserts (a) no Measurements tab visible, (b) Profile exposes the entry-point, (c) tapping lands on `/measurements`. | Discovery (Unknown 7) recommended optional new file. Existing specs already cover all three properties via the helper rewrite — a third file would duplicate. |
| 11 | Profile-mediated nav helper shape (two clicks: Profile tab → row) | **Two-step helper.** Click `Profile` tab text, then click the new `Measurements` row via `getByRole("button", { name: "Measurements" })` (or `getByText` if role assertion is fragile on web). | One-liner helper grows to ~3 lines. Used transparently by 7 callers — no per-test churn beyond the helper rewrite. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/_layout.tsx` | edited | Two surgical changes only: (1) replace the Measurements `<Tabs.Screen name="measurements">` block (lines 43-49) with the hidden form `<Tabs.Screen name="measurements" options={{ href: null }} />` (verbatim mirror of the Routines line at 25-28); (2) drop `Ruler` from the `lucide-react-native` import block (line 5). **Every other line — `<View>` wrapper, `<ActiveSessionBanner />` mount, routines `href: null` line, and all other tab titles + icons — is preserved verbatim.** One responsibility: hide the Measurements tab. |
| `app/(app)/profile.tsx` | edited | Two surgical changes only: (1) extend the `lucide-react-native` import from `{ ChevronRight }` to `{ ChevronRight, Ruler }`; add `import { useRouter } from "expo-router";`. (2) Insert a new bordered card between the existing "Preferences" card (closes at line 120) and the "About" header (line 122). The card is a single `<Pressable>` styled like the Preferences/About cards (`rounded-lg border border-gray-200 dark:border-gray-800 mb-8`) with internal `flex-row items-center justify-between px-4 py-3` row containing left-aligned `Ruler` icon + "Measurements" `<Text>`, and right-aligned `ChevronRight`. `onPress` calls `router.push("/(app)/measurements")`. Accessibility: `accessibilityRole="button"`, `accessibilityLabel="Measurements"`. **The `<Row>` helper at lines 135-157 is NOT touched** — single-responsibility, no read-only helper coupled to nav semantics. |
| `app/(app)/measurements/_layout.tsx` | unchanged | Bare `<Stack screenOptions={{ headerShown: false }} />`. Under `href: null` the parent Tabs still registers the segment, so child routes resolve. |
| `app/(app)/measurements/index.tsx` | unchanged | Stays as the list/history screen. **Explicit divergence from the Routines precedent**: no `<Redirect>` forwarder. Web bookmarks of `/measurements` continue to land here. |
| `app/(app)/measurements/new.tsx` | unchanged | Reachable via `router.push("/(app)/measurements/new")` from inside the list screen (existing call at `measurements/index.tsx:33,63`). |
| `app/(app)/measurements/[id]/index.tsx` | unchanged | Reachable via existing internal nav. |
| `app/(app)/measurements/[id]/edit.tsx` | unchanged | Existing `router.replace("/(app)/measurements")` (lines 96, 115) still resolves because the route file remains mounted. |
| `tests/e2e/measurements.spec.ts` | edited | (a) Lines 74-77 — rewrite `goToMeasurements` helper from `page.getByText("Measurements", { exact: true }).first().click()` to a two-step: click `page.getByText("Profile", { exact: true }).first()` (tab), then click the new Measurements entry-point row via `page.getByRole("button", { name: "Measurements" })` (or `getByText` fallback). All 7 call sites (lines 93, 171, 198, 214, 242, 263, 281) consume the helper transparently. (b) Lines 320-342 — rename the test from `"5 tabs render, no Routines tab, ..."` to `"4 tabs render, no Routines/Measurements tab, Profile shows weight + length unit toggles + Measurements entry"`. Drop the positive `getByText("Measurements")` tab assertion if present; add a negative `await expect(page.getByRole("tab", { name: "Measurements" })).not.toBeVisible();` (or, if the project uses text selectors for tabs, a `page.locator(...)` form that scopes to the tab bar). Optionally add an assertion that, on Profile, the Measurements row is visible. |
| `tests/e2e/probe-strong-unify.spec.ts` | edited | (a) Lines 66-78 — rewrite the test currently named `"5-tab IA: tab bar shows Workout/Exercises/History/Measurements/Profile (no Routines)"` to `"4-tab IA: tab bar shows Workout/Exercises/History/Profile (no Routines, no Measurements)"`. Drop the positive Measurements tab assertion; add a negative assertion on the tab bar. (b) Lines 128-131 — the banner-across-tabs test arm that clicks the Measurements tab to assert the banner persists: rewrite to navigate Profile → Measurements row instead (mirrors the helper rewrite), or drop that specific Measurements arm because Profile is already covered at lines 133-135 in the same test. Recommend drop — the banner-across-tabs property is already exercised by Workout/Exercises/History/Profile arms in the same test. |

## Contratos de I/O

### Profile entry-point — exact snippet

```tsx
// app/(app)/profile.tsx — inserted between the Preferences card (closes line 120)
// and the About header (line 122). Uses primitives + icons already imported.

import { ChevronRight, Ruler } from "lucide-react-native"; // extended import
import { useRouter } from "expo-router";                   // new import

// Inside ProfileScreen, after the existing Preferences <View> card closes:
const router = useRouter();

<Pressable
  onPress={() => router.push("/(app)/measurements")}
  accessibilityRole="button"
  accessibilityLabel="Measurements"
  className="mb-8 flex-row items-center justify-between rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800"
>
  <View className="flex-row items-center">
    <Ruler color="#9ca3af" size={18} />
    <Text className="ml-3 text-base text-black dark:text-white">Measurements</Text>
  </View>
  <ChevronRight color="#9ca3af" size={18} />
</Pressable>
```

### Component / hook signatures touched
None. No new component file. No new hook. No prop additions to existing components (the `<Row>` helper is left untouched).

### Route map after change

| URL | File | Behavior |
|---|---|---|
| `/(app)/workout` | `app/(app)/workout/index.tsx` | Unchanged — unified Workout home. |
| `/(app)/exercises` | `app/(app)/exercises/index.tsx` | Unchanged. |
| `/(app)/history` | `app/(app)/history/index.tsx` | Unchanged. |
| `/(app)/profile` | `app/(app)/profile.tsx` | **Edited** — Measurements entry-point inserted between Preferences and About. |
| `/(app)/measurements` | `app/(app)/measurements/index.tsx` | **Unchanged** — list/history screen. Reached via Profile row or direct URL. **Not** a redirect. |
| `/(app)/measurements/new` | `app/(app)/measurements/new.tsx` | Unchanged. |
| `/(app)/measurements/[id]` | `app/(app)/measurements/[id]/index.tsx` | Unchanged. |
| `/(app)/measurements/[id]/edit` | `app/(app)/measurements/[id]/edit.tsx` | Unchanged. `router.replace("/(app)/measurements")` on save/delete still lands on the list screen. |

### DB / queries / hooks / RLS
Zero touch. No file under `supabase/`, `src/api/`, `src/db/`, or `src/hooks/` changes. `useMeasurements` and all measurement mutations unchanged.

## UI spec

### Verbatim `app/(app)/_layout.tsx` post-change snippet

The diff is exactly two things: drop `Ruler` from the lucide import, replace the Measurements `<Tabs.Screen>` block with the `href: null` form. Everything else (the `<View>` wrapper, `<ActiveSessionBanner />` mount, the routines `href: null` line, all other tabs) is identical to the current file.

```tsx
import { Tabs } from "expo-router";
import {
  Dumbbell,   // unchanged — Workout tab icon
  History,    // unchanged — History tab icon
  // Ruler   — REMOVED (was Measurements tab icon; migrates to profile.tsx)
  User,       // unchanged — Profile tab icon
  Wrench,     // unchanged — Exercises tab icon
} from "lucide-react-native";
import { View } from "react-native";

import { ActiveSessionBanner } from "~/components/active-session-banner";

export default function AppLayout() {
  return (
    <View className="flex-1 bg-white dark:bg-black">
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
          options={{ href: null }}
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

### Profile screen — post-change layout pseudo-code

```
┌─────────────────────────────────────────────┐
│  • Workout in progress         Resume  ▶    │  ← ActiveSessionBanner (when active)
├─────────────────────────────────────────────┤
│                                             │
│  Profile                                    │  ← title (text-2xl font-semibold)
│  user@example.com                           │  ← subtitle (text-gray-500)
│                                             │
│  PREFERENCES                                │  ← uppercase section header
│  ┌───────────────────────────────────────┐  │
│  │ Weight unit    [kg] [lbs]             │  │
│  ├───────────────────────────────────────┤  │
│  │ Length unit    [cm] [in]              │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌───────────────────────────────────────┐  │  ← NEW: bordered card, no header
│  │ 📏 Measurements                     › │  │     Pressable → /(app)/measurements
│  └───────────────────────────────────────┘  │
│                                             │
│  ABOUT                                      │
│  ┌───────────────────────────────────────┐  │
│  │ Version                       0.1.0   │  │
│  ├───────────────────────────────────────┤  │
│  │ Account              user@example.com │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  [ Sign out ]                               │  ← destructive button
│                                             │
└─────────────────────────────────────────────┘
        [Workout] [Exercises] [History] [Profile]
```

### Profile screen — post-change render-branch pseudo-code

```tsx
import { ChevronRight, Ruler } from "lucide-react-native"; // extended
import { useRouter } from "expo-router";                   // new

export default function ProfileScreen() {
  const router = useRouter();                              // new
  const { user, signOut } = useAuth();
  const prefs = usePreferences();
  const setUnit = useSetWeightUnit();
  const setLength = useSetLengthUnit();

  const currentUnit: WeightUnit = prefs.data?.weight_unit ?? "kg";
  const currentLengthUnit: LengthUnit = prefs.data?.length_unit ?? "cm";

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="px-6 pt-16 pb-12"
    >
      <Text className="mb-2 text-2xl font-semibold text-black dark:text-white">
        Profile
      </Text>
      <Text className="mb-8 text-base text-gray-500">{user?.email ?? "—"}</Text>

      <Text className="mb-2 text-sm font-medium uppercase text-gray-500">
        Preferences
      </Text>
      <View className="mb-8 rounded-lg border border-gray-200 dark:border-gray-800">
        {/* ... existing weight + length unit toggle rows, unchanged ... */}
      </View>

      {/* NEW — Measurements entry-point. No section header. */}
      <Pressable
        onPress={() => router.push("/(app)/measurements")}
        accessibilityRole="button"
        accessibilityLabel="Measurements"
        className="mb-8 flex-row items-center justify-between rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800"
      >
        <View className="flex-row items-center">
          <Ruler color="#9ca3af" size={18} />
          <Text className="ml-3 text-base text-black dark:text-white">Measurements</Text>
        </View>
        <ChevronRight color="#9ca3af" size={18} />
      </Pressable>

      <Text className="mb-2 text-sm font-medium uppercase text-gray-500">
        About
      </Text>
      <View className="mb-8 rounded-lg border border-gray-200 dark:border-gray-800">
        <Row label="Version" value="0.1.0" />
        <Row label="Account" value={user?.email ?? "—"} last />
      </View>

      <Button label="Sign out" variant="destructive" onPress={signOut} />
    </ScrollView>
  );
}
```

### Dark mode token check
- Border: `border-gray-200 dark:border-gray-800` — verbatim match with Preferences/About cards (lines 35, 125).
- Label text: `text-black dark:text-white` — verbatim match with existing `<Row>` label color (line 148).
- Icon tint: `color="#9ca3af"` (gray-400) — verbatim match with existing `ChevronRight` color in `<Row>` (line 152) and active-session-banner usage.

### `useColorScheme()` decision
Not needed. Both `Ruler` and `ChevronRight` use the same `#9ca3af` constant tint that the existing `<Row>` helper uses for `ChevronRight`. Adding `useColorScheme()` for dynamic icon tint would diverge from current Profile screen conventions for no visual gain.

## Riscos

### Data integrity
- **No schema change, no RLS change, no query change.** All measurement plumbing is read-only from this run's perspective. `useMeasurements` (`src/hooks/use-measurements.ts:17`) and all measurement mutations untouched. **Risk: none.**

### UX regressions
- **Discoverability**: First-day-after-deploy users who reached Measurements via the bottom tab need to learn it's now under Profile. Mitigation: the Profile card has the `Ruler` icon (same glyph as the old tab) + a `ChevronRight` affordance, both visually consistent with the page's existing rows. **Risk: medium first-day, decays.**
- **Web bookmarks**: explicit non-regression — `/measurements` continues to resolve to the list screen (no redirect). **Risk: none.**
- **Existing flows that share `<Row>`**: zero — the `<Row>` helper is deliberately untouched (one-responsibility). The new entry-point is a parallel hand-rolled `Pressable`. **Risk: none.**
- **Existing flows under `measurements/`**: zero behavioral change. `router.push`, `router.replace`, internal nav all resolve identically. The `[id]/edit.tsx` post-save `router.replace("/(app)/measurements")` lands on the same list screen as before. **Risk: none.**
- **Profile vertical density**: adds one card (~52px). Profile is a `ScrollView`; no clipping risk. **Risk: none.**
- **Tap target size**: `px-4 py-3` = roughly 44px tall — matches existing `<Row>` rows and meets accessibility minimums. **Risk: none.**

### Platform-specific
- **Expo Router v6 tab visibility**: bare removal of the Measurements `<Tabs.Screen>` line would re-mount the tab with default options and a default label. Committed fix: `options={{ href: null }}`, verbatim mirror of the Routines line shipped in `2026-05-20_0410_strong-workout-routines-unify`. **Mitigated.**
- **Web bookmarks of `/measurements`**: continue to resolve. Expo Router still registers the segment under `href: null`. Direct URL entry, direct `router.push`, and `router.replace` all work. **Mitigated by design (no redirect needed).**
- **iOS tab bar layout**: 4 visible tabs (down from 5). Standard React Native Tabs handles count changes automatically; no `tabBarStyle` overrides in `_layout.tsx`. **Risk: none.**
- **Android back button**: from the Measurements list reached via Profile, back returns to Profile (because Profile pushed via `router.push`). Previously, back from Measurements returned to whatever tab was last visited. Slight behavioral change but matches user mental model (entered Measurements from Profile → back goes to Profile). **Risk: low.**
- **Browser back/forward on web**: same as Android — back from `/measurements` lands on `/(app)/profile` when arrived via the Profile row. Direct-URL entry to `/measurements` still works; back goes to whatever the previous history entry was. **Risk: low.**
- **`router.push` vs `router.navigate` semantics**: project consistently uses `router.push` (verified in `measurements/index.tsx:33,63,82`). Match. **Risk: none.**

### Performance
- **No new queries.** No additional `useQuery` calls on Profile. `useMeasurements` is invoked only on the Measurements screen itself (no change). **Risk: none.**
- **Render cost**: one extra `<Pressable>` on Profile. Negligible. **Risk: none.**
- **Bundle cost**: zero. `Ruler` import is removed from `_layout.tsx` and added to `profile.tsx` — net change in unique imports = 0. `ChevronRight` already imported in `profile.tsx`. `useRouter` already used across the codebase (no new dependency). **Risk: none.**

## Alternativas descartadas

1. **Extend the existing `<Row>` helper with an optional `onPress` and un-fade the `ChevronRight`** — Discovery's Unknown 1 option (a). Descartada porque o helper hoje é read-only por contrato (renderiza chevron a `opacity-0` para alinhamento visual). Acoplar semântica de navegação ao mesmo componente que descreve "Version / 0.1.0" mistura duas responsabilidades em um arquivo. A hand-rolled Pressable é literalmente 8 linhas de JSX e mantém o helper intocado.
2. **Standalone full-width primary `<Button label="Measurements">` below About** — Discovery's Unknown 1 option (c). Descartada porque quebra o ritmo visual da página (sequências de cards bordered + um único Button destrutivo no fim). Um botão primário no meio confunde a hierarquia.
3. **Place the entry-point above Preferences (top of page)** — Discovery's Unknown 2 option (a). Descartada porque empurra as preferências de unidades para baixo no scroll, e Preferences é a interação mais frequente do Profile hoje (toggle de kg/lbs). Posicionar Measurements entre Preferences e About preserva o ranking de uso.
4. **Place the entry-point below About, above Sign out** — Discovery's Unknown 2 option (c). Descartada porque cola um affordance de feature ao botão destrutivo, aumentando risco de tap acidental no Sign out.
5. **Label "Body measurements" instead of "Measurements"** — Discovery's Unknown 3 alternative. Descartada porque (a) E2E selectors (`measurements.spec.ts:75,329` e outros) verificam o literal `"Measurements"`; mudar o label propaga churn de teste sem ganho funcional; (b) o título da rota e tela continuam `"Measurements"` — divergir só no Profile cria inconsistência.
6. **Add a section header ("Tracking" / "Body") above the Measurements card** — Discovery's Unknown 4. Descartada porque o card é uma única linha de navegação, não um grupo de settings. Um header uppercase para um único row pesa mais visualmente que o próprio row. Preferences e About têm headers porque agrupam múltiplas linhas.
7. **Make `/measurements` a `<Redirect>` to `/(app)/profile`** (mirror the Routines pattern verbatim) — Descartada porque o brief explicitamente preserva `/measurements` como a tela de lista/histórico. Routines virou redirect porque Workout absorveu o entry point; Measurements continua dono do entry point (apenas mudou onde o entry point fica acessível). Web bookmarks de `/measurements` precisam continuar funcionando.
8. **Bare removal of `<Tabs.Screen name="measurements" />`** — Descartada porque Expo Router v6 auto-mounts directory routes sob um `Tabs` parent. Removal silenciosa re-mounta a aba com `title` default ("measurements" minúsculo) e ícone default. Fix correto é `options={{ href: null }}` (Routines precedent).
9. **Create a new `<SettingsLinkRow>` component to encapsulate the icon+label+chevron+onPress pattern** — Descartada porque o brief explicitamente proíbe novo componente só para este entry point. Uma Pressable hand-rolled é mais barata e o ROI de generalizar para 1 instância é negativo.
10. **Add a dedicated `tests/e2e/probe-measurements-move.spec.ts`** — Discovery's Unknown 7 recommendation. Descartada porque a coverage combinada de `measurements.spec.ts` (helper rewrite + tab-count regression) + `probe-strong-unify.spec.ts` (IA assertion) já cobre as três propriedades (sem tab, Profile expõe entry-point, tap resolve em `/measurements`). Terceiro arquivo duplicaria.
11. **Use `useColorScheme()` for the Ruler/ChevronRight icon tint** — Descartada porque o `<Row>` helper existente fixa `color="#9ca3af"` sem `useColorScheme`. Divergir aqui criaria inconsistência sem ganho visual (gray-400 funciona em ambos os temas).

## Out of scope

- **Server-side guard, RLS, or schema changes** — none implied; zero data-layer touch in this run.
- **Renaming any `measurements/*` route file or screen title** — brief preserves routes; titles unchanged.
- **Adding new content to Profile beyond the Measurements entry-point** — no avatar, no "Edit profile", no new sections (brief constraint).
- **Modifying the Measurements feature** — no edits to list, new, view, or edit screens.
- **Extracting `<SettingsLinkRow>` (or similar) as a reusable component** — defer until a second nav-row instance materializes.
- **Tab title rename / icon swap on the remaining 4 visible tabs** — none requested; not in scope.
- **Banner safe-area refinement on iOS** — deferred from the Routines run; not in scope here.
- **Reordering Profile sections** (brief constraint).
- **Adding "Tracking" section header above the Measurements entry-point** — see Alternativa #6.
- **Bookmark forwarder for `/measurements`** — not needed; route stays resolvable.

## Open questions for Validator

1. **Two-step E2E helper selector robustness**: does `page.getByRole("button", { name: "Measurements" })` reliably distinguish the new Profile entry-point from any residual on-screen "Measurements" text? If the Validator flags this as fragile, fallback is `page.locator('[aria-label="Measurements"]').click()` or `page.getByText("Measurements", { exact: true }).first()` scoped to a non-tab region. Default plan: try `getByRole` first, fall back to scoped `getByText` if Playwright web role mapping is unreliable for `Pressable`.
2. **Tab-bar negative assertion shape**: the Validator should confirm whether the project's prior negative tab assertions (e.g. the Routines `not.toBeVisible()`) target a `role=tab` selector or a plain text selector. The design defaults to mirroring whatever pattern is already in use in `measurements.spec.ts:320-342` after the v0410 run.
3. **`probe-strong-unify.spec.ts:128-131` Measurements arm**: design recommends dropping that specific arm rather than rewriting it. If the Validator prefers keeping a "banner persists when navigating to Measurements via Profile" arm, the rewrite is straightforward (click Profile tab → click Measurements row → assert banner visible). Either resolution is acceptable.

---

Status: **done**.
Recommendation to Conductor: invoke **Validator**.
