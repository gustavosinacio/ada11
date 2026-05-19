import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Calculator, Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { ExerciseBlock } from "~/components/exercise-block";
import { ExercisePicker } from "~/components/exercise-picker";
import { PlateCalculator } from "~/components/plate-calculator";
import { RestTimerOverlay } from "~/components/rest-timer-overlay";
import { SessionHeader } from "~/components/session-header";
import { confirmDelete } from "~/components/confirm-delete";
import type { ExerciseRow, SetRow } from "~/db/types";
import { useExercises } from "~/hooks/use-exercises";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useRestTimer } from "~/hooks/use-rest-timer";
import { useRoutineExercises } from "~/hooks/use-routine-exercises";
import { useFinishSession, useSession } from "~/hooks/use-sessions";
import { useDeleteSet, useLogSet, useSetsForSession, useUpdateSet } from "~/hooks/use-sets";

export default function LiveWorkoutScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  const session = useSession(sessionId);
  const finish = useFinishSession();

  const exercisesQ = useExercises();
  const setsQ = useSetsForSession(sessionId);
  const logSet = useLogSet(sessionId ?? "");
  const updateSet = useUpdateSet(sessionId ?? "");
  const deleteSet = useDeleteSet(sessionId ?? "");
  const unit = useWeightUnit();

  const routineExercisesQ = useRoutineExercises(session.data?.routine_id ?? undefined);
  const restTimer = useRestTimer();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [plateCalcOpen, setPlateCalcOpen] = useState(false);
  const [adHocExerciseIds, setAdHocExerciseIds] = useState<string[]>([]);
  // User-controlled exercise ordering for this session. Null = use derived
  // default (routine order → first-logged order → ad-hoc order). Non-null
  // means the user explicitly reordered; we honor that, with any new
  // exercises (added via picker or first-logged) appended to the end.
  // Not persisted across reloads — same scope as adHocExerciseIds.
  const [exerciseOrderOverride, setExerciseOrderOverride] = useState<
    string[] | null
  >(null);

  // Map exercise_id -> target_rest_seconds (from the routine, if any).
  const restByExercise = useMemo(() => {
    const map = new Map<string, number>();
    for (const re of routineExercisesQ.data ?? []) {
      if (re.target_rest_seconds && re.target_rest_seconds > 0) {
        map.set(re.exercise_id, re.target_rest_seconds);
      }
    }
    return map;
  }, [routineExercisesQ.data]);

  // Build the ordered list of exercises for this session:
  // - if from a routine: use routine_exercises in their position order
  // - plus any exercise that has logged sets in this session (so deleted-from-routine
  //   exercises still show), preserving their first-logged order
  // - plus user-added ad-hoc exercises picked during the session
  const orderedExercises: ExerciseRow[] = useMemo(() => {
    const exMap = new Map((exercisesQ.data ?? []).map((e) => [e.id, e]));
    const out: ExerciseRow[] = [];
    const seen = new Set<string>();

    // 1) Routine exercises in position order
    for (const re of routineExercisesQ.data ?? []) {
      const ex = exMap.get(re.exercise_id);
      if (ex && !seen.has(ex.id)) {
        out.push(ex);
        seen.add(ex.id);
      }
    }

    // 2) Any exercise with logged sets in this session (in first-occurrence order)
    for (const s of setsQ.data ?? []) {
      if (!seen.has(s.exercise_id)) {
        const ex = exMap.get(s.exercise_id);
        if (ex) {
          out.push(ex);
          seen.add(ex.id);
        }
      }
    }

    // 3) Ad-hoc additions during this session
    for (const id of adHocExerciseIds) {
      if (!seen.has(id)) {
        const ex = exMap.get(id);
        if (ex) {
          out.push(ex);
          seen.add(ex.id);
        }
      }
    }

    // Apply user-controlled reorder: items present in the override come
    // first in override order; any items not in the override (newly added
    // since the reorder) keep their default position appended.
    if (exerciseOrderOverride) {
      const overrideSet = new Set(exerciseOrderOverride);
      const byId = new Map(out.map((e) => [e.id, e]));
      const reordered: ExerciseRow[] = [];
      for (const id of exerciseOrderOverride) {
        const ex = byId.get(id);
        if (ex) reordered.push(ex);
      }
      for (const ex of out) {
        if (!overrideSet.has(ex.id)) reordered.push(ex);
      }
      return reordered;
    }

    return out;
  }, [
    exercisesQ.data,
    routineExercisesQ.data,
    setsQ.data,
    adHocExerciseIds,
    exerciseOrderOverride,
  ]);

  const moveExercise = (exerciseId: string, direction: "up" | "down") => {
    const currentOrder = orderedExercises.map((e) => e.id);
    const idx = currentOrder.indexOf(exerciseId);
    if (idx === -1) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= currentOrder.length) return;
    const next = [...currentOrder];
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    setExerciseOrderOverride(next);
  };

  const setsByExercise = useMemo(() => {
    const map = new Map<string, SetRow[]>();
    for (const s of setsQ.data ?? []) {
      const list = map.get(s.exercise_id) ?? [];
      list.push(s);
      map.set(s.exercise_id, list);
    }
    return map;
  }, [setsQ.data]);

  const onFinish = async () => {
    if (!sessionId) return;
    const ok = await confirmDelete({
      title: "Finish workout?",
      message: "You can review it later from History.",
      confirmLabel: "Finish",
      cancelLabel: "Keep going",
    });
    if (!ok) return;
    try {
      await finish.mutateAsync(sessionId);
      router.replace("/(app)/workout");
    } catch (err) {
      console.warn("Finish failed", err);
    }
  };

  if (session.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Stack.Screen options={{ title: "Workout", headerShown: true }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (session.isError || !session.data) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <Stack.Screen options={{ title: "Workout", headerShown: true }} />
        <Text className="text-base text-red-500">
          {session.error instanceof Error
            ? session.error.message
            : "Session not found"}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen options={{ title: "Workout", headerShown: true }} />

      <SessionHeader
        startedAt={session.data.started_at}
        onFinish={onFinish}
        finishing={finish.isPending}
      />

      <ScrollView contentContainerClassName="pb-24">
        {orderedExercises.length === 0 ? (
          <View className="flex-1 items-center px-6 py-10">
            <Text className="mb-4 text-center text-base text-gray-500">
              No exercises in this session yet. Add one to start logging.
            </Text>
          </View>
        ) : (
          orderedExercises.map((ex, idx) => (
            <ExerciseBlock
              key={ex.id}
              exercise={ex}
              sets={setsByExercise.get(ex.id) ?? []}
              unit={unit}
              isFirst={idx === 0}
              isLast={idx === orderedExercises.length - 1}
              onMoveUp={() => moveExercise(ex.id, "up")}
              onMoveDown={() => moveExercise(ex.id, "down")}
              onAddSet={async (input) => {
                if (!sessionId) return;
                try {
                  await logSet.mutateAsync({
                    session_id: sessionId,
                    exercise_id: ex.id,
                    set_type: input.set_type,
                    parent_set_id: input.parent_set_id ?? null,
                  });
                  // Auto-start rest timer for working/dropset using the
                  // routine's target rest, if configured.
                  if (input.set_type !== "warmup") {
                    const rest = restByExercise.get(ex.id);
                    if (rest && rest > 0) restTimer.start(rest);
                  }
                } catch (err) {
                  console.warn("Log set failed", err);
                }
              }}
              onUpdateSet={async (id, patch) => {
                try {
                  await updateSet.mutateAsync({ id, patch });
                } catch (err) {
                  console.warn("Update set failed", err);
                }
              }}
              onDeleteSet={async (id) => {
                try {
                  await deleteSet.mutateAsync(id);
                } catch (err) {
                  console.warn("Delete set failed", err);
                }
              }}
            />
          ))
        )}

        <View className="mt-4 gap-2 px-4">
          <Pressable
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            className="flex-row items-center justify-center rounded-lg border border-gray-300 py-3 dark:border-gray-700"
          >
            <Plus color="#6b7280" size={18} />
            <Text className="ml-2 text-base text-black dark:text-white">
              Add exercise
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPlateCalcOpen(true)}
            accessibilityRole="button"
            className="flex-row items-center justify-center rounded-lg border border-gray-300 py-3 dark:border-gray-700"
          >
            <Calculator color="#6b7280" size={18} />
            <Text className="ml-2 text-base text-black dark:text-white">
              Plate calculator
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeIds={orderedExercises.map((e) => e.id)}
        onPick={(ex) => {
          setAdHocExerciseIds((prev) =>
            prev.includes(ex.id) ? prev : [...prev, ex.id],
          );
          setPickerOpen(false);
        }}
      />

      <PlateCalculator
        visible={plateCalcOpen}
        onClose={() => setPlateCalcOpen(false)}
        unit={unit}
      />

      <RestTimerOverlay />
    </View>
  );
}
