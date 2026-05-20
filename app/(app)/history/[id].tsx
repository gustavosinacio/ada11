import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { ExerciseBlock } from "~/components/exercise-block";
import { ExercisePicker } from "~/components/exercise-picker";
import { SessionTimesEditor } from "~/components/session-times-editor";
import { Button } from "~/components/ui/button";
import { confirmDelete } from "~/components/confirm-delete";
import type { ExerciseRow, SetRow } from "~/db/types";
import { useExercises } from "~/hooks/use-exercises";
import { useWeightUnit } from "~/hooks/use-preferences";
import {
  useSession,
  useSoftDeleteSession,
  useUpdateSessionName,
  useUpdateSessionTimes,
} from "~/hooks/use-sessions";
import {
  useDeleteSet,
  useLogSet,
  useSetsForSession,
  useUpdateSet,
} from "~/hooks/use-sets";
import { formatWeight } from "~/utils/units";

export default function SessionDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const session = useSession(id);
  const setsQ = useSetsForSession(id);
  const exercisesQ = useExercises();
  const unit = useWeightUnit();

  const logSet = useLogSet(id ?? "");
  const updateSet = useUpdateSet(id ?? "");
  const deleteSet = useDeleteSet(id ?? "");
  const updateName = useUpdateSessionName();
  const updateTimes = useUpdateSessionTimes();
  const softDelete = useSoftDeleteSession();

  const [pickerOpen, setPickerOpen] = useState(false);
  // Exercises added during this edit (no sets logged yet).
  const [addedExerciseIds, setAddedExerciseIds] = useState<string[]>([]);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    if (session.data) {
      setNameDraft(session.data.name ?? "");
    }
  }, [session.data]);

  // If the session is still in progress, send the user to the live workout
  // screen instead — editing there is the source of truth.
  useEffect(() => {
    if (session.data && !session.data.ended_at) {
      router.replace(`/(app)/workout/${session.data.id}`);
    }
  }, [session.data, router]);

  // Ordered list of exercises that appear in this session, in first-occurrence
  // order, plus user-added ones during this edit.
  const orderedExercises: ExerciseRow[] = useMemo(() => {
    const exMap = new Map((exercisesQ.data ?? []).map((e) => [e.id, e]));
    const out: ExerciseRow[] = [];
    const seen = new Set<string>();

    for (const s of setsQ.data ?? []) {
      if (!seen.has(s.exercise_id)) {
        const ex = exMap.get(s.exercise_id);
        if (ex) {
          out.push(ex);
          seen.add(ex.id);
        }
      }
    }

    for (const exId of addedExerciseIds) {
      if (!seen.has(exId)) {
        const ex = exMap.get(exId);
        if (ex) {
          out.push(ex);
          seen.add(ex.id);
        }
      }
    }

    return out;
  }, [setsQ.data, exercisesQ.data, addedExerciseIds]);

  const setsByExercise = useMemo(() => {
    const map = new Map<string, SetRow[]>();
    for (const s of setsQ.data ?? []) {
      const list = map.get(s.exercise_id) ?? [];
      list.push(s);
      map.set(s.exercise_id, list);
    }
    return map;
  }, [setsQ.data]);

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

  const commitName = () => {
    if (!id) return;
    const trimmed = nameDraft.trim();
    const current = session.data?.name ?? "";
    if (trimmed === current.trim()) return;
    updateName.mutate({ id, name: trimmed || null });
  };

  const onDeleteSession = async () => {
    if (!id) return;
    const ok = await confirmDelete({
      title: "Delete this workout?",
      message:
        "All sets and notes for this session will be removed. This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await softDelete.mutateAsync(id);
      router.back();
    } catch (err) {
      console.warn("Delete session failed", err);
    }
  };

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

  const headerTitle = session.data.name?.trim() || "Workout";

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen options={{ title: headerTitle, headerShown: true }} />

      <ScrollView contentContainerClassName="pb-24">
        <View className="border-b border-gray-200 px-6 py-6 dark:border-gray-800">
          <Text className="mb-1 text-xs uppercase text-gray-500">Name</Text>
          <TextInput
            value={nameDraft}
            onChangeText={setNameDraft}
            onBlur={commitName}
            onSubmitEditing={commitName}
            placeholder="Workout"
            placeholderTextColor="#9ca3af"
            className="rounded-md border border-gray-300 px-3 py-2 text-lg font-semibold text-black dark:border-gray-700 dark:text-white"
          />
          {updateName.isError ? (
            <Text className="mt-1 text-xs text-red-500">
              {updateName.error instanceof Error
                ? updateName.error.message
                : "Failed to rename"}
            </Text>
          ) : null}

          <SessionTimesEditor
            startedAt={session.data.started_at}
            endedAt={session.data.ended_at!}
            setsCompletedAt={(setsQ.data ?? []).map((s) => s.completed_at)}
            isSubmitting={updateTimes.isPending}
            submitError={
              updateTimes.isError
                ? updateTimes.error instanceof Error
                  ? updateTimes.error.message
                  : "Failed to update session times"
                : null
            }
            onSubmit={(times) =>
              updateTimes.mutate({ id: session.data!.id, ...times })
            }
            onCancel={() => updateTimes.reset()}
          />
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

        {orderedExercises.length === 0 ? (
          <View className="px-6 py-10">
            <Text className="text-center text-base text-gray-500">
              No sets logged in this session.
            </Text>
          </View>
        ) : (
          orderedExercises.map((ex) => (
            <ExerciseBlock
              key={ex.id}
              exercise={ex}
              sets={setsByExercise.get(ex.id) ?? []}
              unit={unit}
              onAddSet={async (input) => {
                if (!id) return;
                try {
                  await logSet.mutateAsync({
                    session_id: id,
                    exercise_id: ex.id,
                    set_type: input.set_type,
                    parent_set_id: input.parent_set_id ?? null,
                  });
                } catch (err) {
                  console.warn("Log set failed", err);
                }
              }}
              onUpdateSet={async (setId, patch) => {
                try {
                  await updateSet.mutateAsync({ id: setId, patch });
                } catch (err) {
                  console.warn("Update set failed", err);
                }
              }}
              onDeleteSet={async (setId) => {
                try {
                  await deleteSet.mutateAsync(setId);
                } catch (err) {
                  console.warn("Delete set failed", err);
                }
              }}
            />
          ))
        )}

        <View className="mt-4 gap-3 px-4">
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

          <View className="mt-6 border-t border-gray-200 pt-6 dark:border-gray-800">
            <Button
              label="Delete workout"
              variant="destructive"
              onPress={onDeleteSession}
              loading={softDelete.isPending}
            />
          </View>
        </View>
      </ScrollView>

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeIds={orderedExercises.map((e) => e.id)}
        onPick={(ex) => {
          setAddedExerciseIds((prev) =>
            prev.includes(ex.id) ? prev : [...prev, ex.id],
          );
          setPickerOpen(false);
        }}
      />
    </View>
  );
}
