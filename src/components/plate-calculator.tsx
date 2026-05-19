import { X } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

import type { WeightUnit } from "~/db/types";
import { kgToLbs, lbsToKg } from "~/utils/units";

type Props = {
  visible: boolean;
  onClose: () => void;
  unit: WeightUnit;
  initialWeight?: string;
};

const BAR_KG = 20;

const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

const PLATE_COLORS: Record<number, string> = {
  25: "bg-red-500",
  20: "bg-blue-500",
  15: "bg-yellow-400",
  10: "bg-green-500",
  5: "bg-white border border-gray-300",
  2.5: "bg-red-300",
  1.25: "bg-gray-400",
};

const PLATE_WIDTHS: Record<number, string> = {
  25: "w-8",
  20: "w-7",
  15: "w-6",
  10: "w-5",
  5: "w-4",
  2.5: "w-3",
  1.25: "w-2.5",
};

function computePlates(totalKg: number): { plates: number[]; remainder: number } {
  let perSide = (totalKg - BAR_KG) / 2;
  if (perSide <= 0) return { plates: [], remainder: totalKg <= BAR_KG ? 0 : perSide * 2 };
  const plates: number[] = [];
  for (const p of PLATES_KG) {
    while (perSide >= p - 0.001) {
      plates.push(p);
      perSide -= p;
    }
  }
  return { plates, remainder: Math.round(perSide * 100) / 100 };
}

function displayWeight(kg: number, unit: WeightUnit): string {
  const v = unit === "kg" ? kg : kgToLbs(kg);
  return Number.isInteger(v) ? v.toString() : v.toFixed(1);
}

export function PlateCalculator({ visible, onClose, unit, initialWeight }: Props) {
  const [input, setInput] = useState(initialWeight ?? "");

  const inputKg = (() => {
    const v = parseFloat(input.replace(",", "."));
    if (!Number.isFinite(v) || v < 0) return null;
    return unit === "kg" ? v : lbsToKg(v);
  })();

  const result = inputKg != null && inputKg >= BAR_KG ? computePlates(inputKg) : null;
  const barDisplay = displayWeight(BAR_KG, unit);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 justify-end bg-black/50">
        <View className="rounded-t-2xl bg-white px-6 pb-10 pt-6 dark:bg-gray-900">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-black dark:text-white">
              Plate Calculator
            </Text>
            <Pressable onPress={onClose} accessibilityLabel="Close" accessibilityRole="button">
              <X color="#6b7280" size={22} />
            </Pressable>
          </View>

          <Text className="mb-1 text-sm text-gray-500">
            Target weight ({unit}) — bar is {barDisplay} {unit}
          </Text>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={`e.g. ${displayWeight(100, unit)}`}
            placeholderTextColor="#9ca3af"
            keyboardType="decimal-pad"
            autoFocus
            className="mb-4 rounded-lg border border-gray-300 px-4 py-3 text-lg text-black dark:border-gray-700 dark:text-white"
          />

          {inputKg != null && inputKg < BAR_KG ? (
            <Text className="text-center text-base text-gray-500">
              Weight is less than the bar ({barDisplay} {unit})
            </Text>
          ) : null}

          {result ? (
            <View>
              <Text className="mb-3 text-center text-sm text-gray-500">
                Each side:
              </Text>

              {result.plates.length === 0 ? (
                <Text className="text-center text-base text-gray-500">
                  Empty bar
                </Text>
              ) : (
                <>
                  <View className="mb-4 flex-row items-end justify-center gap-0.5">
                    {result.plates.map((p, i) => (
                      <View
                        key={`${p}-${i}`}
                        className={`${PLATE_COLORS[p]} ${PLATE_WIDTHS[p]} items-center justify-center rounded-sm`}
                        style={{ height: 24 + (p / 25) * 40 }}
                      >
                        <Text className="text-[8px] font-bold text-black">
                          {displayWeight(p, unit)}
                        </Text>
                      </View>
                    ))}
                    <View className="h-3 w-16 rounded-r bg-gray-400" />
                  </View>

                  <View className="flex-row flex-wrap justify-center gap-2">
                    {result.plates.map((p, i) => (
                      <View
                        key={`label-${p}-${i}`}
                        className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-800"
                      >
                        <Text className="text-sm text-black dark:text-white">
                          {displayWeight(p, unit)} {unit}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {result.remainder > 0.001 ? (
                <Text className="mt-3 text-center text-xs text-yellow-600">
                  +{displayWeight(result.remainder, unit)} {unit} per side cannot
                  be plated with standard plates
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
