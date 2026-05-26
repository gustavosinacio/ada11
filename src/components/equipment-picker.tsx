import { Pressable, Text, View } from "react-native";

import { EQUIPMENT_OPTIONS, equipmentLabel, type Equipment } from "~/db/types";

type Props = {
  label?: string;
  value: string | null;
  onChange: (next: string | null) => void;
  error?: string;
};

export function EquipmentPicker({ label, value, onChange, error }: Props) {
  const toggle = (e: Equipment) => {
    onChange(value === e ? null : e);
  };

  return (
    <View className="mb-4">
      {label ? (
        <Text className="mb-2 text-sm text-gray-700 dark:text-gray-300">
          {label}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {EQUIPMENT_OPTIONS.map((e) => {
          const selected = value === e;
          return (
            <Pressable
              key={e}
              onPress={() => toggle(e)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={equipmentLabel(e)}
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
                {equipmentLabel(e)}
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
