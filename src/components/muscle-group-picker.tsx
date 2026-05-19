import { Pressable, Text, View } from "react-native";

import { MUSCLE_GROUPS, type MuscleGroup } from "~/db/types";

type Props = {
  label?: string;
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
};

export function MuscleGroupPicker({ label, value, onChange, error }: Props) {
  const toggle = (m: MuscleGroup) => {
    if (value.includes(m)) {
      onChange(value.filter((v) => v !== m));
    } else {
      onChange([...value, m]);
    }
  };

  return (
    <View className="mb-4">
      {label ? (
        <Text className="mb-2 text-sm text-gray-700 dark:text-gray-300">
          {label}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {MUSCLE_GROUPS.map((m) => {
          const selected = value.includes(m);
          return (
            <Pressable
              key={m}
              onPress={() => toggle(m)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={m}
              className={`rounded-full px-4 py-2 ${
                selected
                  ? "bg-black dark:bg-white"
                  : "border border-gray-300 dark:border-gray-700"
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  selected
                    ? "text-white dark:text-black"
                    : "text-black dark:text-white"
                }`}
              >
                {m}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text className="mt-2 text-sm text-red-500">{error}</Text>
      ) : null}
    </View>
  );
}
