import { zodResolver } from "@hookform/resolvers/zod";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { z } from "zod";

import { confirmDelete } from "~/components/confirm-delete";
import { ExercisePicker } from "~/components/exercise-picker";
import { RoutineExerciseRow } from "~/components/routine-exercise-row";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  useAddExerciseToRoutine,
  useRemoveExerciseFromRoutine,
  useReorderRoutineExercises,
  useRoutineExercises,
  useUpdateRoutineExercise,
} from "~/hooks/use-routine-exercises";
import {
  useRoutine,
  useSoftDeleteRoutine,
  useUpdateRoutine,
} from "~/hooks/use-routines";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Too long"),
  notes: z.string().trim().max(2000, "Too long").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

export default function RoutineBuilderScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, error } = useRoutine(id);
  const update = useUpdateRoutine();
  const remove = useSoftDeleteRoutine();

  const exercisesQ = useRoutineExercises(id);
  const addEx = useAddExerciseToRoutine(id ?? "");
  const updateEx = useUpdateRoutineExercise(id ?? "");
  const removeEx = useRemoveExerciseFromRoutine(id ?? "");
  const reorderEx = useReorderRoutineExercises(id ?? "");

  const [pickerOpen, setPickerOpen] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", notes: "" },
  });

  useEffect(() => {
    if (data) reset({ name: data.name, notes: data.notes ?? "" });
  }, [data, reset]);

  const onSave = handleSubmit(async (values) => {
    if (!id) return;
    try {
      await update.mutateAsync({
        id,
        patch: { name: values.name, notes: values.notes ? values.notes : null },
      });
    } catch (err) {
      console.warn("Failed to update routine", err);
    }
  });

  const onDelete = async () => {
    if (!id) return;
    const ok = await confirmDelete({
      title: "Delete routine?",
      message: "Past sessions are preserved.",
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(id);
      router.back();
    } catch (err) {
      console.warn("Failed to delete routine", err);
    }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const list = exercisesQ.data ?? [];
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    const tmp = next[idx]!;
    next[idx] = next[target]!;
    next[target] = tmp;
    try {
      await reorderEx.mutateAsync(next.map((e) => e.id));
    } catch (err) {
      console.warn("Failed to reorder", err);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Stack.Screen options={{ title: "Routine", headerShown: true }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <Stack.Screen options={{ title: "Routine", headerShown: true }} />
        <Text className="text-base text-red-500">
          {error instanceof Error ? error.message : "Failed to load"}
        </Text>
      </View>
    );
  }

  const entries = exercisesQ.data ?? [];

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: data?.name ?? "Routine", headerShown: true }} />

      <View className="px-6 py-6">
        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Name"
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              error={errors.name?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="notes"
          render={({ field: { onChange, onBlur, value } }) => (
            <Textarea
              label="Notes (optional)"
              value={value ?? ""}
              onBlur={onBlur}
              onChangeText={onChange}
              error={errors.notes?.message}
            />
          )}
        />

        <Button
          label="Save details"
          onPress={onSave}
          loading={update.isPending}
          disabled={!isDirty}
        />
      </View>

      <View className="border-t border-gray-200 dark:border-gray-800">
        <View className="flex-row items-center justify-between px-6 py-4">
          <Text className="text-lg font-semibold text-black dark:text-white">
            Exercises
          </Text>
          <Pressable
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add exercise"
            className="flex-row items-center rounded-lg bg-black px-3 py-2 dark:bg-white"
          >
            <Plus color="#fff" size={16} />
            <Text className="ml-1 text-sm font-medium text-white dark:text-black">
              Add
            </Text>
          </Pressable>
        </View>

        {exercisesQ.isLoading ? (
          <View className="py-10">
            <ActivityIndicator />
          </View>
        ) : entries.length === 0 ? (
          <View className="px-6 pb-10">
            <Text className="text-center text-base text-gray-500">
              No exercises yet. Add your first one.
            </Text>
          </View>
        ) : (
          entries.map((entry, idx) => (
            <RoutineExerciseRow
              key={entry.id}
              entry={entry}
              isFirst={idx === 0}
              isLast={idx === entries.length - 1}
              onMoveUp={() => move(idx, -1)}
              onMoveDown={() => move(idx, 1)}
              onRemove={async () => {
                const ok = await confirmDelete({
                  title: `Remove ${entry.exercise.name}?`,
                  message: "It stays in your library.",
                });
                if (!ok) return;
                try {
                  await removeEx.mutateAsync(entry.id);
                } catch (err) {
                  console.warn("Failed to remove", err);
                }
              }}
              onChangeTargets={async (patch) => {
                try {
                  await updateEx.mutateAsync({
                    id: entry.id,
                    patch: {
                      target_sets: entry.target_sets,
                      target_reps: entry.target_reps,
                      target_weight: entry.target_weight,
                      target_rest_seconds: entry.target_rest_seconds,
                      ...patch,
                    },
                  });
                } catch (err) {
                  console.warn("Failed to update targets", err);
                }
              }}
            />
          ))
        )}
      </View>

      <View className="mt-8 px-6">
        <View className="border-t border-gray-200 pt-6 dark:border-gray-800">
          <Button
            label="Delete routine"
            variant="destructive"
            onPress={onDelete}
            loading={remove.isPending}
          />
        </View>
      </View>

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeIds={entries.map((e) => e.exercise_id)}
        onPick={async (ex) => {
          setPickerOpen(false);
          try {
            await addEx.mutateAsync({ exerciseId: ex.id });
          } catch (err) {
            console.warn("Failed to add exercise", err);
          }
        }}
      />
    </ScrollView>
  );
}
