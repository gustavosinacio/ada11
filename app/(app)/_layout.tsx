import { Tabs } from "expo-router";
import {
  Dumbbell,
  History,
  User,
  Wrench,
} from "lucide-react-native";
import { View } from "react-native";

import { ActiveSessionBanner } from "~/components/active-session-banner";

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
      <Tabs backBehavior="history" screenOptions={{ headerShown: false }}>
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
