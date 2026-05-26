import { PlatformPressable } from "@react-navigation/elements";
import {
  StackActions,
  useNavigation,
  useRoute,
  type NavigationProp,
  type ParamListBase,
} from "@react-navigation/native";
import { Tabs } from "expo-router";
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
 * - `isFocused === true` and child Stack has `index > 0` → dispatch popToTop
 *   on the child Stack via its `state.key`. Skip the framework's onPress so we
 *   don't also emit tabPress (which would trigger the expo-router fork's RAF
 *   auto-pop on native — harmless but redundant — and any web-side race).
 * - `isFocused === true` and child Stack is at root (or no child Stack) →
 *   delegate to `props.onPress` (which is a no-op on the BottomTabBar side for
 *   focused taps, but keeps the framework consistent).
 */
function HomeLinkTabBarButton(props: BottomTabBarButtonProps) {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute();
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
