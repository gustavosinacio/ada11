import { zodResolver } from "@hookform/resolvers/zod";
import { Stack, useRouter } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { ScrollView, Text, View } from "react-native";
import { z } from "zod";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useCreateExercise } from "~/hooks/use-exercises";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Too long"),
  primary_muscle: z.string().trim().max(40).optional().or(z.literal("")),
  equipment: z.string().trim().max(40).optional().or(z.literal("")),
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
    defaultValues: { name: "", primary_muscle: "", equipment: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        name: values.name,
        primary_muscle: values.primary_muscle ? values.primary_muscle : null,
        equipment: values.equipment ? values.equipment : null,
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
        name="primary_muscle"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Primary muscle (optional)"
            placeholder="e.g. Chest"
            value={value ?? ""}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.primary_muscle?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="equipment"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Equipment (optional)"
            placeholder="e.g. Barbell"
            value={value ?? ""}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.equipment?.message}
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
