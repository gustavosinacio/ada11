import { PlatformPressable } from "@react-navigation/elements";
import {
  StackActions,
  useNavigation,
  useRoute,
  type NavigationProp,
  type ParamListBase,
} from "@react-navigation/native";
import { Tabs, router, useSegments, type Href } from "expo-router";
import {
  Dumbbell,
  History,
  TrendingUp,
  User,
  Wrench,
} from "lucide-react-native";
import { View } from "react-native";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";

import { ActiveSessionBanner } from "~/components/active-session-banner";

/**
 * Custom `tabBarButton` that implements the "Strong / Instagram" tab-tap-to-pop
 * convention. When a focused tab is re-tapped and its child Stack has at least
 * one nested route on top of the index, dispatch `StackActions.popToTop()`
 * targeted at the child Stack.
 *
 * Round 1 of this feature wired a `screenListeners.tabPress` handler at the
 * `<Tabs>` level — its `tabPress` listener never fired on focused re-tap on
 * web (per `docs/runs/2026-05-26_0307_bottom-tab-home-link/test-report-v1.md`).
 * Owning the press at the button level instead of relying on the framework's
 * tab-press event chain is empirically reliable on web (runtime-verified via
 * an instrumented probe that captured exactly one button-press event on the
 * focused re-tap, followed by the URL popping from /exercises/<id>/progress
 * to /exercises).
 *
 * Rendering notes:
 * - Uses `PlatformPressable` (the same primitive the framework's default
 *   `tabBarButton` uses — see `node_modules/@react-navigation/bottom-tabs/src/views/BottomTabItem.tsx:146-148`)
 *   to preserve the same styling/hover-effect/accessibility behaviour.
 * - The `href` prop from `BottomTabBarButtonProps` is intentionally stripped
 *   before forwarding to `PlatformPressable`. With `href`, react-native-web
 *   renders the underlying element as an `<a>` whose browser-native click
 *   semantics can mask the synthetic-event `onPress`. Stripping `href` lets
 *   the press resolve as a plain button on web, eliminating that interference
 *   path. Cross-tab navigation still works because non-pop paths delegate to
 *   `props.onPress` (the BottomTabBar's onPress which emits tabPress +
 *   dispatches the navigate action).
 *
 * Branches:
 * - `isFocused === false` (different tab) → delegate to `props.onPress`
 *   (default cross-tab navigation).
 * - `isFocused === true` and child Stack has `index > 0` AND a hydrated
 *   `type === "stack"` + string `key` (the click-through "live stack" fast
 *   path) → dispatch popToTop on the child Stack via its `state.key`. Skip the
 *   framework's onPress so we don't also emit tabPress (which would trigger the
 *   expo-router fork's RAF auto-pop on native — harmless but redundant — and
 *   any web-side race).
 * - `isFocused === true` but the keyed fast path did NOT fire (the child Stack
 *   was rehydrated from the URL: deep-link / browser refresh / cross-tab
 *   arrival from a live workout) → navigate to the focused tab's root via
 *   `router.navigate(TAB_ROOTS[route.name])`, gated on `useSegments()` showing
 *   a nested route under the focused tab. Why the URL (`segments`) and not the
 *   Tabs child-Stack state is the gate: that child state is unreliable on these
 *   paths (runtime-verified for this run) — on a deep-link it is a single-route
 *   PartialState (`type`/`key`/`index` undefined), and on a cross-tab arrival
 *   it is `undefined` entirely, the SAME shape a genuine at-root cross-tab
 *   arrival produces. So the Tabs child state cannot distinguish "nested, must
 *   pop" from "at root, no-op", but `segments` always reflects the real URL:
 *   `["(app)", tab]` at a tab root, deeper on a nested route. The fix plan's
 *   PRIMARY mechanism (`router.dismissAll()` guarded by `router.canDismiss()`)
 *   was tried first but no-ops on both shapes (`canDismiss()` is `false`
 *   because the un-hydrated stack reports no dismissable depth). We use
 *   `navigate` (a pop toward an existing route in the stack), NOT
 *   `router.replace` — `replace` swaps the current history entry and its
 *   `historyDelta` interaction with `backBehavior="history"` risks the per-tab
 *   browser-back invariant (see the comment block on the <Tabs> below). This
 *   still does NOT route the pop through `props.onPress`/`href`, preserving the
 *   plain-button press model — it is an imperative `router` call.
 *   (Runtime-verified Paths A/B/C on web, run
 *   2026-05-27_2144_navbar-tab-pop-to-root.)
 * - `isFocused === true` and the focused tab is genuinely at its root (segments
 *   length 2, e.g. `/exercises`) or is a leaf tab (Profile) → the segments gate
 *   is false, so we fall through to `props.onPress` (a no-op on the
 *   BottomTabBar side for focused taps). That gate is what keeps an at-root
 *   re-tap a clean no-op with no spurious history mutation.
 */

/**
 * Tab-name → tab-root `Href` map for the visible bottom tabs. The
 * URL-rehydration fallback in `HomeLinkTabBarButton` uses it to navigate the
 * focused tab back to its root (`router.navigate(TAB_ROOTS[route.name])`). Kept
 * as explicit typed-route string literals (not a `` `/(app)/${route.name}` ``
 * template) because `typedRoutes` is enabled (`app.json` experiments) and only
 * literals satisfy the `Href` type. Hidden tabs (`routines`, `measurements`,
 * `admin` — all `href: null`) are intentionally absent: they have no tab-bar
 * button so no re-tap event.
 */
const TAB_ROOTS: Record<string, Href> = {
  workout: "/(app)/workout",
  exercises: "/(app)/exercises",
  history: "/(app)/history",
  progress: "/(app)/progress",
  profile: "/(app)/profile",
};

function HomeLinkTabBarButton(props: BottomTabBarButtonProps) {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute();
  // `segments` is the current URL split into route segments — the reliable
  // source of truth for "is the focused tab on a nested route". The Tabs
  // navigator's child Stack state is NOT reliable here (see fallback comment),
  // but the URL always reflects the real position. At any tab root the
  // segments are exactly `["(app)", "<tabName>"]` (length 2); any nested route
  // is deeper. Used by the PartialState fallback below.
  const segments = useSegments();
  const ariaSelected = props["aria-selected"];
  // Strip `href` so PlatformPressable renders as <div role="button"> instead of
  // <a>. See header comment for why this is load-bearing on web.
  const { href: _href, onPress, ...rest } = props;
  void _href;

  const handlePress = (
    e: Parameters<NonNullable<BottomTabBarButtonProps["onPress"]>>[0],
  ) => {
    const isFocused = ariaSelected === true;
    if (isFocused) {
      const tabsState = navigation.getState();
      const focusedRoute = tabsState?.routes.find((r) => r.key === route.key);
      const childState = focusedRoute?.state;
      if (
        childState &&
        childState.type === "stack" &&
        typeof childState.index === "number" &&
        childState.index > 0 &&
        typeof childState.key === "string"
      ) {
        // Pop the child Stack back to its root. Skip `props.onPress` so we
        // don't also emit `tabPress` (which would trigger the expo-router
        // fork's RAF auto-pop on native — harmless but redundant — and on web
        // the routingQueue `linkTo` race that round 1 fought against).
        navigation.dispatch({
          ...StackActions.popToTop(),
          target: childState.key,
        });
        return;
      }
      // PartialState / URL-rehydration fallback. The keyed fast path above only
      // fires when the focused tab's child Stack is a fully-hydrated, live
      // navigator (the same-tab click-through path). On deep-link / refresh /
      // cross-tab arrival the child Stack is rehydrated from the URL and its
      // shape is NOT usable for a keyed pop — runtime-verified on web for this
      // run (2026-05-27_2144_navbar-tab-pop-to-root):
      //   - deep-link (Path B): `childState` is a single-route PartialState
      //     (`{ routes: [{ name: "[id]/progress" }] }`) — `type`/`key`/`index`
      //     all undefined, so no keyed `popToTop` target and
      //     `router.canDismiss()` is `false` (so `router.dismissAll()`, the fix
      //     plan's primary mechanism, no-ops);
      //   - cross-tab from a live workout (Path C): `childState` is `undefined`
      //     entirely (the freshly-focused tab's nested state has not been built
      //     at press time), and `canDismiss()` is `false` too.
      // Critically, a *genuine* at-root cross-tab arrival ALSO yields
      // `childState === undefined`, so the Tabs child state cannot distinguish
      // "nested, must pop" from "already at root, no-op". The reliable
      // discriminator is the URL itself: `useSegments()` is `["(app)", tab]`
      // (length 2) at any tab root and deeper on a nested route. So: if the
      // focused tab is on a nested route, navigate to its root.
      //
      // We use `router.navigate(TAB_ROOTS[route.name])` (a pop toward an
      // existing route in the stack), NOT `router.replace` — `replace` swaps
      // the current history entry and its `historyDelta` interaction with
      // `backBehavior="history"` risks the per-tab browser-back invariant (see
      // the comment block on the <Tabs> below). The press still does NOT route
      // through `props.onPress`/`href`; it is an imperative `router` call,
      // preserving the plain-button model that round 1 established.
      const tabRoot = TAB_ROOTS[route.name];
      const onNestedRoute =
        segments[0] === "(app)" &&
        segments[1] === route.name &&
        segments.length > 2;
      if (tabRoot && onNestedRoute) {
        router.navigate(tabRoot);
        return;
      }
    }
    // Default path: cross-tab nav, leaf-tab re-tap, or focused-at-root re-tap.
    onPress?.(e);
  };

  return <PlatformPressable {...rest} onPress={handlePress} />;
}

export default function AppLayout() {
  return (
    <View className="flex-1 bg-white dark:bg-black">
      <ActiveSessionBanner />
      {/*
        backBehavior="history": each tab focus change appends to the Tabs
        navigator's `history` array, so expo-router's web linking layer sees a
        positive `historyDelta` and calls `history.pushState` (not
        `replaceState`). Without this, navigating from one non-zero tab to
        another non-zero tab (e.g. /history/[id] → /exercises/[id]/progress)
        leaves history.length unchanged and the linking layer treats the push
        as a REPLACE — browser back then skips past the source detail screen.
        See run docs/runs/2026-05-21_1554_tap-exercise-name-to-progress.
      */}
      <Tabs
        backBehavior="history"
        screenOptions={{ headerShown: false, tabBarButton: HomeLinkTabBarButton }}
      >
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
          name="progress"
          options={{
            title: "Progress",
            tabBarIcon: ({ color, size }) => <TrendingUp color={color} size={size} />,
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
        {/*
          Admin page lives outside the bottom-tab visible set (href: null
          mirrors routines / measurements). Reachable from the Profile
          screen via a conditionally-rendered link when useIsAdmin() is
          true. Server-side RLS + the admin_list_users() function guard
          are the authoritative gate; this is just a navigation hint.
        */}
        <Tabs.Screen name="admin" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
