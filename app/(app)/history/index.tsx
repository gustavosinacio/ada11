import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Text, View } from "react-native";

import { SessionSummaryRow } from "~/components/session-summary-row";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useSessions } from "~/hooks/use-sessions";

export default function HistoryList() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch, isRefetching } = useSessions();
  const unit = useWeightUnit();

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen options={{ title: "History", headerShown: true }} />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-base text-red-500">
            {error instanceof Error ? error.message : "Failed to load history"}
          </Text>
        </View>
      ) : !data || data.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-base text-gray-500">
            No sessions yet. Finish your first workout and it will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <SessionSummaryRow
              session={item}
              unit={unit}
              onPress={() => router.push(`/(app)/history/${item.id}`)}
            />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
        />
      )}
    </View>
  );
}
