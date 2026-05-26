import { zodResolver } from "@hookform/resolvers/zod";
import { Stack, useRouter } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { ScrollView, Text, View } from "react-native";
import { z } from "zod";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useCreateRoutine } from "~/hooks/use-routines";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Too long"),
  notes: z.string().trim().max(2000, "Too long").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

export default function NewRoutineScreen() {
  const router = useRouter();
  const create = useCreateRoutine();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", notes: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const created = await create.mutateAsync({
        name: values.name,
        notes: values.notes ? values.notes : null,
      });
      // Land on the routine builder so exercises can be added straight away
      // — `router.back()` would dump the user on the routines list and
      // force a tap-edit round-trip to do the same thing. `replace` so the
      // back button skips this create form (it's now an empty shell).
      router.replace(`/(app)/routines/${created.id}`);
    } catch (err) {
      // surface inline below
      console.warn("Failed to create routine", err);
    }
  });

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="px-6 py-6"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "New routine", headerShown: true }} />

      <Controller
        control={control}
        name="name"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Name"
            placeholder="e.g. Push Day"
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
        name="notes"
        render={({ field: { onChange, onBlur, value } }) => (
          <Textarea
            label="Notes (optional)"
            placeholder="Anything you want to remember about this routine"
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
          label="Save routine"
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
