import { zodResolver } from "@hookform/resolvers/zod";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  Controller,
  useForm,
  type FieldPath,
} from "react-hook-form";
import { Pressable, ScrollView, Text, View } from "react-native";
import { z } from "zod";

import { DuplicateMeasurementDateError } from "~/api/measurements";
import type { MeasurementEntryRow } from "~/db/types";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useMeasurements, useCreateMeasurement } from "~/hooks/use-measurements";
import { useLengthUnit, useWeightUnit } from "~/hooks/use-preferences";
import {
  buildSubmitPayload,
  emptyMeasurementFormValues,
  measurementsSchema,
  type MeasurementFormValues,
} from "~/utils/measurements-form";

const SECTION_HEADER =
  "mt-4 mb-2 text-sm font-medium uppercase text-gray-500";

export default function NewMeasurementScreen() {
  const router = useRouter();
  const weightUnit = useWeightUnit();
  const lengthUnit = useLengthUnit();
  const create = useCreateMeasurement();
  const list = useMeasurements();

  const [duplicateError, setDuplicateError] =
    useState<DuplicateMeasurementDateError | null>(null);
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<MeasurementFormValues>({
    resolver: zodResolver(measurementsSchema),
    defaultValues: emptyMeasurementFormValues(new Date()),
  });

  const onSubmit = handleSubmit(async (values) => {
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
      await create.mutateAsync(payload);
      router.back();
    } catch (e) {
      if (e instanceof DuplicateMeasurementDateError) {
        setDuplicateError(e);
        return;
      }
      throw e;
    }
  });

  const openExistingEntry = async () => {
    if (!duplicateError) return;
    setLookupNotice(null);
    const target = duplicateError.existingDateIso;
    const findIn = (rows: readonly MeasurementEntryRow[]) =>
      rows.find((r) => r.measured_at.slice(0, 10) === target);

    let row = findIn(list.data ?? []);
    if (!row) {
      try {
        const result = await list.refetch();
        row = findIn(result.data ?? []);
      } catch {
        // fall through — we'll show the inline notice below
      }
    }
    if (!row) {
      setLookupNotice(
        "Couldn't find the existing entry — pull to refresh and try again.",
      );
      return;
    }
    router.replace(`/(app)/measurements/${row.id}/edit`);
  };

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="px-6 py-6"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "New measurement", headerShown: true }} />

      {/* Section 1 — Date (no header) */}
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

      {/* Section 2 — Weight & body fat */}
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

      {/* Section 3 — Upper body */}
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

      {/* Section 4 — Core */}
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

      {/* Section 5 — Lower body */}
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

      {/* Section 6 — Notes */}
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

      {create.isError && !duplicateError ? (
        <Text className="mb-3 text-sm text-red-500">
          {create.error instanceof Error ? create.error.message : "Failed to save"}
        </Text>
      ) : null}

      <View className="mt-2 gap-3">
        <Button
          label="Save measurement"
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
