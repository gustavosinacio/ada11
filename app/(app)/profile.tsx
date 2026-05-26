import { useRouter } from "expo-router";
import { ChevronRight, Ruler, Shield } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Button } from "~/components/ui/button";
import { useIsAdmin } from "~/hooks/use-admin";
import {
  MAX_VOLUME_WINDOW_OPTIONS,
  type LengthUnit,
  type MaxVolumeWindowWeeks,
  type WeightUnit,
} from "~/db/types";
import { useAuth } from "~/lib/auth-context";
import {
  usePreferences,
  useSetLengthUnit,
  useSetMaxVolumeWindowWeeks,
  useSetWeightUnit,
} from "~/hooks/use-preferences";

/**
 * Label map for the max-volume-window segmented control. "All" stands in for
 * `0` (lifetime) so the four segments fit the 54pt-per-segment budget on a
 * 320pt screen (MAJ-2 in design-v2). The legend caption directly below the
 * row clarifies the abbreviation for first-time users.
 */
const MAX_VOLUME_WINDOW_LABELS: Record<MaxVolumeWindowWeeks, string> = {
  0: "All",
  10: "10w",
  20: "20w",
  30: "30w",
  40: "40w",
  50: "50w",
};

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const prefs = usePreferences();
  const setUnit = useSetWeightUnit();
  const setLength = useSetLengthUnit();
  const setMaxVolumeWindow = useSetMaxVolumeWindowWeeks();

  const currentUnit: WeightUnit = prefs.data?.weight_unit ?? "kg";
  const currentLengthUnit: LengthUnit = prefs.data?.length_unit ?? "cm";
  const currentMaxVolumeWindow: MaxVolumeWindowWeeks =
    prefs.data?.max_volume_window_weeks ?? 0;

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="px-6 pt-16 pb-12"
    >
      <Text className="mb-2 text-2xl font-semibold text-black dark:text-white">
        Profile
      </Text>
      <Text className="mb-8 text-base text-gray-500">{user?.email ?? "—"}</Text>

      <Text className="mb-2 text-sm font-medium uppercase text-gray-500">
        Preferences
      </Text>
      <View className="mb-8 rounded-lg border border-gray-200 dark:border-gray-800">
        <View className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <Text className="mb-2 text-sm text-gray-500">Weight unit</Text>
          <View className="flex-row gap-2">
            {(["kg", "lbs"] as const).map((u) => {
              const active = currentUnit === u;
              return (
                <Pressable
                  key={u}
                  onPress={() => {
                    if (active) return;
                    setUnit.mutate(u);
                  }}
                  disabled={setUnit.isPending}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={`flex-1 rounded-md py-2 ${
                    active
                      ? "bg-black dark:bg-white"
                      : "border border-gray-300 dark:border-gray-700"
                  }`}
                >
                  <Text
                    className={`text-center text-base font-medium ${
                      active
                        ? "text-white dark:text-black"
                        : "text-black dark:text-white"
                    }`}
                  >
                    {u}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {setUnit.isError ? (
            <Text className="mt-2 text-sm text-red-500">
              {setUnit.error instanceof Error
                ? setUnit.error.message
                : "Failed to save"}
            </Text>
          ) : null}
        </View>
        <View className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <Text className="mb-2 text-sm text-gray-500">Length unit</Text>
          <View className="flex-row gap-2">
            {(["cm", "in"] as const).map((u) => {
              const active = currentLengthUnit === u;
              return (
                <Pressable
                  key={u}
                  onPress={() => {
                    if (active) return;
                    setLength.mutate(u);
                  }}
                  disabled={setLength.isPending}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={`flex-1 rounded-md py-2 ${
                    active
                      ? "bg-black dark:bg-white"
                      : "border border-gray-300 dark:border-gray-700"
                  }`}
                >
                  <Text
                    className={`text-center text-base font-medium ${
                      active
                        ? "text-white dark:text-black"
                        : "text-black dark:text-white"
                    }`}
                  >
                    {u}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {setLength.isError ? (
            <Text className="mt-2 text-sm text-red-500">
              {setLength.error instanceof Error
                ? setLength.error.message
                : "Failed to save"}
            </Text>
          ) : null}
        </View>
        <View className="px-4 py-3">
          <Text className="mb-2 text-sm text-gray-500">
            Max-volume window
          </Text>
          <View className="flex-row gap-2">
            {MAX_VOLUME_WINDOW_OPTIONS.map((w) => {
              const active = currentMaxVolumeWindow === w;
              return (
                <Pressable
                  key={w}
                  onPress={() => {
                    if (active) return;
                    setMaxVolumeWindow.mutate(w);
                  }}
                  disabled={setMaxVolumeWindow.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={
                    w === 0
                      ? "Lifetime — compare against your entire history"
                      : `Last ${w} weeks — compare against the trailing ${w} ISO weeks`
                  }
                  accessibilityState={{ selected: active }}
                  className={`flex-1 rounded-md py-2 ${
                    active
                      ? "bg-black dark:bg-white"
                      : "border border-gray-300 dark:border-gray-700"
                  }`}
                >
                  <Text
                    className={`text-center text-base font-medium ${
                      active
                        ? "text-white dark:text-black"
                        : "text-black dark:text-white"
                    }`}
                  >
                    {MAX_VOLUME_WINDOW_LABELS[w]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Max-volume window — how many recent weeks to compare against.
          </Text>
          {setMaxVolumeWindow.isError ? (
            <Text className="mt-2 text-sm text-red-500">
              {setMaxVolumeWindow.error instanceof Error
                ? setMaxVolumeWindow.error.message
                : "Failed to save"}
            </Text>
          ) : null}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Measurements"
        onPress={() => router.push("/(app)/measurements")}
        className="mb-6 flex-row items-center justify-between rounded-lg border border-gray-200 px-4 py-4 dark:border-gray-800"
      >
        <View className="flex-row items-center">
          <Ruler color="#9ca3af" size={20} />
          <Text className="ml-3 text-base text-black dark:text-white">Measurements</Text>
        </View>
        <ChevronRight color="#9ca3af" size={20} />
      </Pressable>

      <AdminLink />

      <Text className="mb-2 text-sm font-medium uppercase text-gray-500">
        About
      </Text>
      <View className="mb-8 rounded-lg border border-gray-200 dark:border-gray-800">
        <Row label="Version" value="0.1.0" />
        <Row label="Account" value={user?.email ?? "—"} last />
      </View>

      <Button label="Sign out" variant="destructive" onPress={signOut} />
    </ScrollView>
  );
}

function AdminLink() {
  const router = useRouter();
  const { data: isAdmin } = useIsAdmin();
  if (!isAdmin) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Admin"
      onPress={() => router.push("/(app)/admin")}
      className="mb-6 flex-row items-center justify-between rounded-lg border border-gray-200 px-4 py-4 dark:border-gray-800"
    >
      <View className="flex-row items-center">
        <Shield color="#9ca3af" size={20} />
        <Text className="ml-3 text-base text-black dark:text-white">Admin</Text>
      </View>
      <ChevronRight color="#9ca3af" size={20} />
    </Pressable>
  );
}

function Row({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center justify-between px-4 py-3 ${last ? "" : "border-b border-gray-200 dark:border-gray-800"}`}
    >
      <Text className="text-base text-black dark:text-white">{label}</Text>
      <View className="flex-row items-center">
        <Text className="text-base text-gray-500">{value}</Text>
        <View className="ml-2 opacity-0">
          <ChevronRight color="#9ca3af" size={18} />
        </View>
      </View>
    </View>
  );
}
