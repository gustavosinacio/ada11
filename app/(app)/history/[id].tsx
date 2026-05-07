import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import type { ExerciseRow, SetRow, WeightUnit } from "~/db/types";
import { useExercises } from "~/hooks/use-exercises";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useSession } from "~/hooks/use-sessions";
import { useSetsForSession } from "~/hooks/use-sets";
import { formatWeight } from "~/utils/units";

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const SET_TYPE_LABEL: Record<SetRow["set_type"], string> = {
  warmup: "W",
  working: "•",
  dropset: "↓",
};

const SET_TYPE_COLOR: Record<SetRow["set_type"], string> = {
  warmup: "bg-yellow-100 text-yellow-800",
  working: "bg-gray-200 text-gray-800",
  dropset: "bg-purple-100 text-purple-800",
};

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession(id);
  const setsQ = useSetsForSession(id);
  const exercisesQ = useExercises();
  const unit = useWeightUnit();

  // Group sets by exercise, preserving first-occurrence order.
  const grouped = useMemo(() => {
    const exMap = new Map((exercisesQ.data ?? []).map((e) => [e.id, e]));
    const order: string[] = [];
    const byExercise = new Map<string, SetRow[]>();
    for (const s of setsQ.data ?? []) {
      if (!byExercise.has(s.exercise_id)) {
        byExercise.set(s.exercise_id, []);
        order.push(s.exercise_id);
      }
      byExercise.get(s.exercise_id)!.push(s);
    }
    return order.map((exId) => ({
      exercise: exMap.get(exId),
      sets: byExercise.get(exId) ?? [],
    }));
  }, [setsQ.data, exercisesQ.data]);

  const totals = useMemo(() => {
    let totalSets = 0;
    let totalVolumeKg = 0;
    for (const s of setsQ.data ?? []) {
      totalSets += 1;
      const reps = s.reps ?? 0;
      const w = s.weight ? parseFloat(s.weight) : 0;
      if (Number.isFinite(reps) && Number.isFinite(w)) {
        totalVolumeKg += reps * w;
      }
    }
    return { totalSets, totalVolumeKg };
  }, [setsQ.data]);

  if (session.isLoading || setsQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Stack.Screen options={{ title: "Session", headerShown: true }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (session.isError || !session.data) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <Stack.Screen options={{ title: "Session", headerShown: true }} />
        <Text className="text-base text-red-500">
          {session.error instanceof Error
            ? session.error.message
            : "Not found"}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="pb-12"
    >
      <Stack.Screen options={{ title: "Session", headerShown: true }} />

      <View className="border-b border-gray-200 px-6 py-6 dark:border-gray-800">
        <Text className="text-lg font-semibold text-black dark:text-white">
          {formatDateTime(session.data.started_at)}
        </Text>
        <Text className="mt-1 text-sm text-gray-500">
          Duration: {formatDuration(session.data.started_at, session.data.ended_at)}
        </Text>
        <Text className="mt-0.5 text-sm text-gray-500">
          Total: {totals.totalSets} {totals.totalSets === 1 ? "set" : "sets"} ·{" "}
          {totals.totalVolumeKg > 0
            ? formatWeight(totals.totalVolumeKg, unit)
            : "—"}{" "}
          volume
        </Text>
        {session.data.notes ? (
          <Text className="mt-3 text-sm italic text-gray-600 dark:text-gray-400">
            {session.data.notes}
          </Text>
        ) : null}
      </View>

      {grouped.length === 0 ? (
        <View className="px-6 py-10">
          <Text className="text-center text-base text-gray-500">
            No sets logged in this session.
          </Text>
        </View>
      ) : (
        grouped.map(({ exercise, sets }) => (
          <ExerciseGroup
            key={exercise?.id ?? "unknown"}
            exercise={exercise ?? null}
            sets={sets}
            unit={unit}
          />
        ))
      )}
    </ScrollView>
  );
}

function ExerciseGroup({
  exercise,
  sets,
  unit,
}: {
  exercise: ExerciseRow | null;
  sets: SetRow[];
  unit: WeightUnit;
}) {
  return (
    <View className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
      <Text className="text-base font-semibold text-black dark:text-white">
        {exercise?.name ?? "Unknown exercise"}
      </Text>
      {(exercise?.primary_muscle || exercise?.equipment) && (
        <Text className="mb-2 mt-0.5 text-sm text-gray-500">
          {[exercise?.primary_muscle, exercise?.equipment]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      )}
      <View className="mt-2">
        {sets.map((s) => {
          const w = s.weight ? parseFloat(s.weight) : null;
          return (
            <View key={s.id} className="flex-row items-center gap-2 py-1">
              <View
                className={`h-6 w-6 items-center justify-center rounded-full ${SET_TYPE_COLOR[s.set_type]}`}
              >
                <Text className="text-xs font-semibold">
                  {SET_TYPE_LABEL[s.set_type]}
                </Text>
              </View>
              <Text className="w-6 text-sm text-gray-500">{s.set_number}</Text>
              <Text className="flex-1 text-sm text-black dark:text-white">
                {w != null ? formatWeight(w, unit) : "—"} ×{" "}
                {s.reps ?? "—"} reps
                {s.rpe ? ` @ RPE ${s.rpe}` : ""}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
