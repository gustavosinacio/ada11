import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { ReadOnlyRoutineExerciseCard } from "~/components/read-only-routine-exercise-card";
import { Button } from "~/components/ui/button";
import type { RoutineExerciseSetRow } from "~/db/types";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useRoutineExerciseSets } from "~/hooks/use-routine-exercise-sets";
import { useRoutineExercises } from "~/hooks/use-routine-exercises";
import { useRoutine } from "~/hooks/use-routines";
import {
  useActiveSession,
  useStartSessionFromRoutine,
} from "~/hooks/use-sessions";

/**
 * Read-only PREVIEW of a routine (Strong-style). Tapping a routine row on the
 * Workout page lands here instead of starting the session directly. Shows the
 * routine's exercises + their per-set targets (read-only), a "Start workout"
 * button, and a header "Edit this routine" jump to the builder.
 *
 * The Start handler is the verbatim relocation of the old `startFromRoutine`
 * from `app/(app)/workout/index.tsx:60-83` — since the one-tap direct-start no
 * longer exists, the preview is the ONLY start-from-routine caller, so a move
 * (not a shared hook) is correct (LOCKED U2.i). All three guards are preserved:
 * (A) route to the active session instead of starting a second one; (B) the
 * `pendingRoutineId` in-flight idempotency guard; (C) the seed-failure catch
 * that keeps the user on the preview with a warn (LOCKED U9).
 *
 * Reuses the editor's data hooks (no new query, no migration). The grouping is
 * the editor's verbatim reducer (`routines/[id]/index.tsx:152-160`) so the
 * preview shows exactly what gets seeded.
 */
export default function RoutinePreviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const routine = useRoutine(id);
  const exercisesQ = useRoutineExercises(id);
  const setsQ = useRoutineExerciseSets(id);
  const active = useActiveSession();
  const startMut = useStartSessionFromRoutine();
  const unit = useWeightUnit();

  // In-flight guard moved verbatim from `workout/index.tsx:30-32`.
  const [pendingRoutineId, setPendingRoutineId] = useState<string | null>(null);

  // Initial-settle guard (mirrors `workout/index.tsx:37-43`): while the active
  // session query is loading, render a spinner so Guard A's `active.data` check
  // has no race window.
  if (active.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Stack.Screen options={{ title: "Routine", headerShown: true }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (routine.isLoading || exercisesQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Stack.Screen options={{ title: "Routine", headerShown: true }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (routine.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <Stack.Screen options={{ title: "Routine", headerShown: true }} />
        <Text className="text-base text-red-500">
          {routine.error instanceof Error
            ? routine.error.message
            : "Failed to load"}
        </Text>
      </View>
    );
  }

  const entries = exercisesQ.data ?? [];

  // Group routine sets by routine_exercise_id — verbatim from the editor
  // (`routines/[id]/index.tsx:152-160`). Sorted by set_number ASC at the API.
  const setsByExercise = (() => {
    const map = new Map<string, RoutineExerciseSetRow[]>();
    for (const s of setsQ.data ?? []) {
      const list = map.get(s.routine_exercise_id) ?? [];
      list.push(s);
      map.set(s.routine_exercise_id, list);
    }
    return map;
  })();

  // Moved Start handler — verbatim relocation of `workout/index.tsx:60-83`,
  // parameterized to the single routine the preview is viewing. All three
  // guards preserved.
  const onStart = async () => {
    const r = routine.data;
    if (!r) return;
    // Guard A — active-session routing (workout/index.tsx:61-63). LOCKED U5:
    // route to the EXISTING active session instead of starting a second one.
    if (active.data) {
      router.push(`/(app)/workout/${active.data.id}`);
      return;
    }
    // Guard B — in-flight idempotency (workout/index.tsx:65-66,80-81). The
    // double-tap e2e asserts exactly one session; this guard must survive.
    if (pendingRoutineId) return;
    setPendingRoutineId(r.id);
    try {
      const row = await startMut.mutateAsync({ routine_id: r.id, name: r.name });
      router.replace(`/(app)/workout/${row.id}`);
    } catch (err) {
      // Guard C — seed-fail hard-fail (workout/index.tsx:73-79). LOCKED U9:
      // STAY on the preview with the warn; do NOT router.back(). The orphan
      // empty session row remains in History (use-sessions.ts:58-71 policy).
      console.warn("Start failed", err);
    } finally {
      setPendingRoutineId(null);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="pb-12"
    >
      <Stack.Screen
        options={{
          title: routine.data?.name ?? "Routine",
          headerShown: true,
          headerRight: () => (
            <Pressable
              onPress={() => router.push(`/(app)/routines/${id}`)}
              accessibilityLabel="Edit this routine"
              accessibilityRole="button"
              className="px-3 py-1"
            >
              <Text className="text-base font-medium text-blue-500">Edit</Text>
            </Pressable>
          ),
        }}
      />

      {entries.length === 0 ? (
        <View className="px-6 py-10">
          <Text className="text-center text-base text-gray-500">
            No exercises in this routine yet.
          </Text>
        </View>
      ) : (
        entries.map((entry) => (
          <ReadOnlyRoutineExerciseCard
            key={entry.id}
            entry={entry}
            sets={setsByExercise.get(entry.id) ?? []}
            unit={unit}
          />
        ))
      )}

      <View className="mt-8 px-6">
        <Button
          label="Start workout"
          onPress={onStart}
          loading={startMut.isPending}
        />
      </View>
    </ScrollView>
  );
}
