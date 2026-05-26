import { zodResolver } from "@hookform/resolvers/zod";
import { Stack, useRouter } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { ScrollView, Text, View } from "react-native";
import { z } from "zod";

import { EquipmentPicker } from "~/components/equipment-picker";
import { MuscleGroupPicker } from "~/components/muscle-group-picker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { EQUIPMENT_OPTIONS, MUSCLE_GROUPS } from "~/db/types";
import { useCreateExercise } from "~/hooks/use-exercises";

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

export default function NewExerciseScreen() {
  const router = useRouter();
  const create = useCreateExercise();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", muscles: [], equipment: null, notes: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        name: values.name,
        muscles: values.muscles,
        equipment: values.equipment ?? null,
        notes: values.notes ? values.notes : null,
      });
      router.back();
    } catch (err) {
      console.warn("Failed to create exercise", err);
    }
  });

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="px-6 py-6"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "New exercise", headerShown: true }} />

      <Controller
        control={control}
        name="name"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Name"
            placeholder="e.g. Barbell Bench Press"
            autoFocus
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

      {create.isError ? (
        <Text className="mb-3 text-sm text-red-500">
          {create.error instanceof Error
            ? create.error.message
            : "Failed to save"}
        </Text>
      ) : null}

      <View className="mt-2 gap-3">
        <Button
          label="Save exercise"
          onPress={onSubmit}
          loading={create.isPending}
        />
        <Button
          label="Cancel"
          variant="secondary"
          onPress={() => router.back()}
        />
      </View>
    </ScrollView>
  );
}
