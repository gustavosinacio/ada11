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
