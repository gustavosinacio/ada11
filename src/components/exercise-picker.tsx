import { Search, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { CreatedByYouChip } from "~/components/created-by-you-chip";
import type { ExerciseRow } from "~/db/types";
import { useExercises } from "~/hooks/use-exercises";

type Props = {
  visible: boolean;
  onClose: () => void;
  /**
   * Called when the user picks an exercise. May return a Promise — the picker
   * tracks in-flight state per row and disables further taps until it resolves,
   * preventing races on the next-position computation downstream.
   */
  onPick: (exercise: ExerciseRow) => void | Promise<void>;
  /** Hide these (already in routine) — still searchable visually but greyed out. */
  excludeIds?: string[];
};

export function ExercisePicker({ visible, onClose, onPick, excludeIds }: Props) {
  const [query, setQuery] = useState("");
  const [pickingId, setPickingId] = useState<string | null>(null);
  const { data, isLoading } = useExercises();
  const exclude = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data ?? [];
    if (!q) return list;
    return list.filter((e) => {
      return (
        e.name.toLowerCase().includes(q) ||
        (e.muscles ?? []).some((m) => m.toLowerCase().includes(q)) ||
        (e.equipment ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, query]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onShow={() => {
        // RN-Web: blur whatever DOM element retained focus from the prior screen
        // so it doesn't end up trapped inside the modal's aria-hidden backdrop.
        if (typeof document !== "undefined") {
          (document.activeElement as HTMLElement | null)?.blur();
        }
      }}
    >
      <View className="flex-1 bg-white dark:bg-black">
        <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <Text className="text-lg font-semibold text-black dark:text-white">
            Pick exercise
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="p-1"
          >
            <X color="#6b7280" size={22} />
          </Pressable>
        </View>

        <View className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <View className="flex-row items-center rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700">
            <Search color="#9ca3af" size={18} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name, muscle, equipment"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              className="ml-2 flex-1 text-base text-black dark:text-white"
            />
          </View>
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(e) => e.id}
            ListEmptyComponent={
              <View className="px-6 py-10">
                <Text className="text-center text-base text-gray-500">
                  No exercises match. Add one from the Exercises tab.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const already = exclude.has(item.id);
              const isPicking = pickingId === item.id;
              const isBusy = pickingId !== null;
              const muscles = item.muscles ?? [];
              return (
                <Pressable
                  onPress={async () => {
                    if (already || isBusy) return;
                    setPickingId(item.id);
                    try {
                      await onPick(item);
                    } finally {
                      setPickingId(null);
                    }
                  }}
                  disabled={already || isBusy}
                  accessibilityRole="button"
                  className={`flex-row items-center justify-between border-b border-gray-100 px-4 py-3 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950 ${
                    isBusy && !already ? "opacity-50" : ""
                  }`}
                >
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center">
                      <Text
                        className={`text-base ${already ? "text-gray-400" : "text-black dark:text-white"}`}
                      >
                        {item.name}
                      </Text>
                      {item.user_id !== null ? <CreatedByYouChip /> : null}
                    </View>
                    {(muscles.length > 0 || item.equipment) && (
                      <Text className="mt-0.5 text-sm text-gray-500">
                        {[
                          muscles.length > 0
                            ? muscles.join(", ")
                            : null,
                          item.equipment,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    )}
                  </View>
                  {isPicking ? (
                    <ActivityIndicator />
                  ) : already ? (
                    <Text className="text-xs text-gray-400">added</Text>
                  ) : null}
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}
