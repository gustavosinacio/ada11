import { Pressable, Text, View } from "react-native";

import { useAuth } from "~/lib/auth-context";

export default function ProfileScreen() {
  const { user, signOut } = useAuth();

  return (
    <View className="flex-1 bg-white px-6 pt-16 dark:bg-black">
      <Text className="mb-2 text-2xl font-semibold text-black dark:text-white">Profile</Text>
      <Text className="mb-8 text-base text-gray-500">{user?.email ?? "—"}</Text>

      <Pressable
        onPress={signOut}
        className="rounded-lg border border-red-500 py-3"
      >
        <Text className="text-center text-base font-medium text-red-500">Sign out</Text>
      </Pressable>
    </View>
  );
}
