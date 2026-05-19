import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { z } from "zod";

import { confirmDelete } from "~/components/confirm-delete";
import { MuscleGroupPicker } from "~/components/muscle-group-picker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { MUSCLE_GROUPS } from "~/db/types";
import {
  useExercise,
  useSoftDeleteExercise,
  useUpdateExercise,
} from "~/hooks/use-exercises";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Too long"),
  muscles: z
    .array(z.enum(MUSCLE_GROUPS as unknown as [string, ...string[]]))
    .min(1, "Pick at least one muscle group"),
  equipment: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

export default function EditExerciseScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, error } = useExercise(id);
  const update = useUpdateExercise();
  const remove = useSoftDeleteExercise();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", muscles: [], equipment: "", notes: "" },
  });

  useEffect(() => {
    if (data) {
      reset({
        name: data.name,
        muscles: data.muscles ?? [],
        equipment: data.equipment ?? "",
        notes: data.notes ?? "",
      });
    }
  }, [data, reset]);

  const onSave = handleSubmit(async (values) => {
    if (!id) return;
    try {
      await update.mutateAsync({
        id,
        patch: {
          name: values.name,
          muscles: values.muscles,
          equipment: values.equipment ? values.equipment : null,
          notes: values.notes ? values.notes : null,
        },
      });
      router.back();
    } catch (err) {
      console.warn("Failed to update exercise", err);
    }
  });

  const onDelete = async () => {
    if (!id) return;
    const ok = await confirmDelete({
      title: "Delete exercise?",
      message:
        "Past sessions that reference this exercise are kept. You can re-add it later.",
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(id);
      router.back();
    } catch (err) {
      console.warn("Failed to delete exercise", err);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Stack.Screen options={{ title: "Edit exercise", headerShown: true }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <Stack.Screen options={{ title: "Edit exercise", headerShown: true }} />
        <Text className="text-base text-red-500">
          {error instanceof Error ? error.message : "Failed to load"}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="px-6 py-6"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "Edit exercise", headerShown: true }} />

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
        name="muscles"
        render={({ field: { onChange, value } }) => (
          <MuscleGroupPicker
            label="Muscles"
            value={value ?? []}
            onChange={onChange}
            error={errors.muscles?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="equipment"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Equipment (optional)"
            value={value ?? ""}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.equipment?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="notes"
        render={({ field: { onChange, onBlur, value } }) => (
          <Textarea
            label="Notes (optional)"
            placeholder="Cues, grip width, stance, etc."
            value={value ?? ""}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.notes?.message}
          />
        )}
      />

      {update.isError ? (
        <Text className="mb-3 text-sm text-red-500">
          {update.error instanceof Error
            ? update.error.message
            : "Failed to save"}
        </Text>
      ) : null}

      <Link href={`/exercises/${id}/progress`} asChild>
        <Pressable
          accessibilityRole="button"
          className="mb-4 rounded-lg border border-blue-500 py-3"
        >
          <Text className="text-center text-base font-medium text-blue-500">
            View progress
          </Text>
        </Pressable>
      </Link>

      <View className="mt-2 gap-3">
        <Button
          label="Save changes"
          onPress={onSave}
          loading={update.isPending}
          disabled={!isDirty}
        />
        <Button
          label="Cancel"
          variant="secondary"
          onPress={() => router.back()}
        />
        <View className="mt-6 border-t border-gray-200 pt-6 dark:border-gray-800">
          <Button
            label="Delete exercise"
            variant="destructive"
            onPress={onDelete}
            loading={remove.isPending}
          />
        </View>
      </View>
    </ScrollView>
  );
}
