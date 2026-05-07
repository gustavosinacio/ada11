import { zodResolver } from "@hookform/resolvers/zod";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { z } from "zod";

import { confirmDelete } from "~/components/confirm-delete";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
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

export default function EditRoutineScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, error } = useRoutine(id);
  const update = useUpdateRoutine();
  const remove = useSoftDeleteRoutine();

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
    if (data) {
      reset({ name: data.name, notes: data.notes ?? "" });
    }
  }, [data, reset]);

  const onSave = handleSubmit(async (values) => {
    if (!id) return;
    try {
      await update.mutateAsync({
        id,
        patch: { name: values.name, notes: values.notes ? values.notes : null },
      });
      router.back();
    } catch (err) {
      console.warn("Failed to update routine", err);
    }
  });

  const onDelete = async () => {
    if (!id) return;
    const ok = await confirmDelete({
      title: "Delete routine?",
      message: "This routine will be hidden from your list. Past sessions are preserved.",
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(id);
      router.back();
    } catch (err) {
      console.warn("Failed to delete routine", err);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Stack.Screen options={{ title: "Edit routine", headerShown: true }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <Stack.Screen options={{ title: "Edit routine", headerShown: true }} />
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
      <Stack.Screen options={{ title: "Edit routine", headerShown: true }} />

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
            label="Delete routine"
            variant="destructive"
            onPress={onDelete}
            loading={remove.isPending}
          />
        </View>
      </View>
    </ScrollView>
  );
}
