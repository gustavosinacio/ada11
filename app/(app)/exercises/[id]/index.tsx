import { zodResolver } from "@hookform/resolvers/zod";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { z } from "zod";

import { confirmDelete } from "~/components/confirm-delete";
import { EquipmentPicker } from "~/components/equipment-picker";
import { MuscleGroupPicker } from "~/components/muscle-group-picker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  EQUIPMENT_OPTIONS,
  MUSCLE_GROUPS,
  equipmentLabel,
  type Equipment,
} from "~/db/types";
import {
  useExercise,
  useSoftDeleteExercise,
  useUpdateExercise,
} from "~/hooks/use-exercises";

const EM_DASH = "—";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Too long"),
  muscles: z
    .array(z.enum(MUSCLE_GROUPS as unknown as [string, ...string[]]))
    .min(1, "Pick at least one muscle group"),
  equipment: z
    .enum(EQUIPMENT_OPTIONS as unknown as [string, ...string[]])
    .nullable()
    .optional(),
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
    defaultValues: { name: "", muscles: [], equipment: null, notes: "" },
  });

  useEffect(() => {
    if (data) {
      // Legacy rows may hold non-canonical equipment strings; the picker
      // treats unknown values as "none" rather than crashing. We pass through
      // recognised values and normalise everything else to null on edit.
      const knownEquip = EQUIPMENT_OPTIONS.includes(
        data.equipment as Equipment,
      )
        ? (data.equipment as Equipment)
        : null;
      reset({
        name: data.name,
        muscles: data.muscles ?? [],
        equipment: knownEquip,
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
          equipment: values.equipment ?? null,
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
      router.replace("/(app)/exercises");
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

  // Canonical (shared catalog) row -> read-only screen. Defense-in-depth with
  // the progress-screen pencil gate; covers deep links and route history that
  // bypass the pencil. `useForm` above stays mounted unconditionally (hook
  // ordering must be stable across renders); this branch simply renders no
  // Controllers and omits Save / Cancel / Delete affordances.
  if (data && data.user_id === null) {
    return (
      <ScrollView
        className="flex-1 bg-white dark:bg-black"
        contentContainerClassName="px-6 py-6"
      >
        <Stack.Screen options={{ title: "Exercise", headerShown: true }} />

        <Text className="mb-1 text-xs uppercase tracking-wide text-gray-500">
          Name
        </Text>
        <Text className="mb-6 text-base text-black dark:text-white">
          {data.name}
        </Text>

        <Text className="mb-1 text-xs uppercase tracking-wide text-gray-500">
          Muscles
        </Text>
        <Text className="mb-6 text-base text-black dark:text-white">
          {(data.muscles ?? []).length > 0
            ? (data.muscles ?? []).join(", ")
            : EM_DASH}
        </Text>

        <Text className="mb-1 text-xs uppercase tracking-wide text-gray-500">
          Equipment
        </Text>
        <Text className="mb-6 text-base text-black dark:text-white">
          {data.equipment
            ? EQUIPMENT_OPTIONS.includes(data.equipment as Equipment)
              ? equipmentLabel(data.equipment as Equipment)
              : data.equipment
            : EM_DASH}
        </Text>

        <Text className="mb-1 text-xs uppercase tracking-wide text-gray-500">
          Notes
        </Text>
        <Text className="mb-6 text-base text-black dark:text-white">
          {data.notes ?? EM_DASH}
        </Text>

        <View className="mt-2 gap-3">
          <Button
            label="Back"
            variant="secondary"
            onPress={() => router.back()}
          />
        </View>
      </ScrollView>
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
        render={({ field: { onChange, value } }) => (
          <EquipmentPicker
            label="Equipment (optional)"
            value={value ?? null}
            onChange={onChange}
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
