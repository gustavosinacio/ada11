import { zodResolver } from "@hookform/resolvers/zod";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Controller,
  useForm,
  type FieldPath,
} from "react-hook-form";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { z } from "zod";

import { DuplicateMeasurementDateError } from "~/api/measurements";
import { confirmDelete } from "~/components/confirm-delete";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  useMeasurement,
  useMeasurements,
  useSoftDeleteMeasurement,
  useUpdateMeasurement,
} from "~/hooks/use-measurements";
import { useLengthUnit, useWeightUnit } from "~/hooks/use-preferences";
import {
  buildSubmitPayload,
  emptyMeasurementFormValues,
  measurementsSchema,
  rowToFormValues,
  type MeasurementFormValues,
} from "~/utils/measurements-form";

const SECTION_HEADER =
  "mt-4 mb-2 text-sm font-medium uppercase text-gray-500";

export default function EditMeasurementScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const weightUnit = useWeightUnit();
  const lengthUnit = useLengthUnit();
  const { data, isLoading, isError, error } = useMeasurement(id);
  const update = useUpdateMeasurement();
  const remove = useSoftDeleteMeasurement();
  const list = useMeasurements();

  const [duplicateError, setDuplicateError] =
    useState<DuplicateMeasurementDateError | null>(null);
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<MeasurementFormValues>({
    resolver: zodResolver(measurementsSchema),
    defaultValues: emptyMeasurementFormValues(new Date()),
  });

  useEffect(() => {
    if (data) {
      reset(rowToFormValues(data, { weightUnit, lengthUnit }));
    }
  }, [data, weightUnit, lengthUnit, reset]);

  const onSave = handleSubmit(async (values) => {
    if (!id) return;
    setDuplicateError(null);
    setLookupNotice(null);
    let payload;
    try {
      payload = buildSubmitPayload(values, { weightUnit, lengthUnit });
    } catch (e) {
      if (e instanceof z.ZodError) {
        e.errors.forEach((issue) => {
          const path = issue.path[0];
          if (typeof path === "string") {
            setError(path as FieldPath<MeasurementFormValues>, {
              message: issue.message,
            });
          }
        });
        return;
      }
      throw e;
    }
    try {
      await update.mutateAsync({ id, patch: payload });
      router.back();
    } catch (e) {
      if (e instanceof DuplicateMeasurementDateError) {
        setDuplicateError(e);
        return;
      }
      throw e;
    }
  });

  const onDelete = async () => {
    if (!id) return;
    const ok = await confirmDelete({
      title: "Delete measurement?",
      message: "This entry will be hidden from your history.",
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(id);
      router.back();
    } catch (err) {
      // surface inline via remove.isError below
      console.warn("Failed to delete measurement", err);
    }
  };

  const openExistingEntry = async () => {
    if (!duplicateError) return;
    setLookupNotice(null);
    const target = duplicateError.existingDateIso;
    const findRow = () =>
      (list.data ?? []).find(
        (r) => r.id !== id && r.measured_at.slice(0, 10) === target,
      );

    let row = findRow();
    if (!row) {
      try {
        await list.refetch();
      } catch {
        // fall through
      }
      row = findRow();
    }
    if (!row) {
      setLookupNotice(
        "Couldn't find the existing entry — pull to refresh and try again.",
      );
      return;
    }
    router.replace(`/(app)/measurements/${row.id}`);
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Stack.Screen
          options={{ title: "Edit measurement", headerShown: true }}
        />
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <Stack.Screen
          options={{ title: "Edit measurement", headerShown: true }}
        />
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
      <Stack.Screen
        options={{ title: "Edit measurement", headerShown: true }}
      />

      <Controller
        control={control}
        name="measuredAt"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Date"
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.measuredAt?.message}
          />
        )}
      />

      <Text className={SECTION_HEADER}>Weight & body fat</Text>
      <Controller
        control={control}
        name="weightKg"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Weight"
            placeholder={weightUnit}
            keyboardType="decimal-pad"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.weightKg?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="bodyFatPct"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Body fat %"
            placeholder="%"
            keyboardType="decimal-pad"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.bodyFatPct?.message}
          />
        )}
      />

      <Text className={SECTION_HEADER}>Upper body</Text>
      <Controller
        control={control}
        name="neckCm"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Neck"
            placeholder={lengthUnit}
            keyboardType="decimal-pad"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.neckCm?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="chestCm"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Chest"
            placeholder={lengthUnit}
            keyboardType="decimal-pad"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.chestCm?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="bicepsCm"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Biceps"
            placeholder={lengthUnit}
            keyboardType="decimal-pad"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.bicepsCm?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="forearmCm"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Forearm"
            placeholder={lengthUnit}
            keyboardType="decimal-pad"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.forearmCm?.message}
          />
        )}
      />

      <Text className={SECTION_HEADER}>Core</Text>
      <Controller
        control={control}
        name="waistCm"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Waist"
            placeholder={lengthUnit}
            keyboardType="decimal-pad"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.waistCm?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="hipsCm"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Hips"
            placeholder={lengthUnit}
            keyboardType="decimal-pad"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.hipsCm?.message}
          />
        )}
      />

      <Text className={SECTION_HEADER}>Lower body</Text>
      <Controller
        control={control}
        name="thighCm"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Thigh"
            placeholder={lengthUnit}
            keyboardType="decimal-pad"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.thighCm?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="calfCm"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Calf"
            placeholder={lengthUnit}
            keyboardType="decimal-pad"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.calfCm?.message}
          />
        )}
      />

      <Text className={SECTION_HEADER}>Notes</Text>
      <Controller
        control={control}
        name="notes"
        render={({ field: { onChange, onBlur, value } }) => (
          <Textarea
            label="Notes (optional)"
            placeholder="How you felt, time of day, etc."
            value={value ?? ""}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.notes?.message}
          />
        )}
      />

      {duplicateError ? (
        <View className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950">
          <Text className="mb-3 text-sm text-amber-900 dark:text-amber-100">
            You already have a measurement for {duplicateError.existingDateIso}{" "}
            — edit it instead?
          </Text>
          <Pressable
            onPress={openExistingEntry}
            accessibilityRole="button"
            className="rounded-md border border-amber-400 px-3 py-2 dark:border-amber-600"
          >
            <Text className="text-center text-sm font-medium text-amber-900 dark:text-amber-100">
              Open existing entry
            </Text>
          </Pressable>
          {lookupNotice ? (
            <Text className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              {lookupNotice}
            </Text>
          ) : null}
        </View>
      ) : null}

      {update.isError && !duplicateError ? (
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
            label="Delete measurement"
            variant="destructive"
            onPress={onDelete}
            loading={remove.isPending}
          />
        </View>
      </View>
    </ScrollView>
  );
}
