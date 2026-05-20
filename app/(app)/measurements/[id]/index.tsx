import { format, parseISO } from "date-fns";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Pencil } from "lucide-react-native";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from "react-native";

import type { MeasurementEntryRow } from "~/db/types";
import { useMeasurement } from "~/hooks/use-measurements";
import { useLengthUnit, useWeightUnit } from "~/hooks/use-preferences";
import { formatLength, formatWeight } from "~/utils/units";

const SECTION_HEADER =
  "mt-4 mb-2 text-sm font-medium uppercase text-gray-500";

type Row = { label: string; value: string };

function buildRow(
  label: string,
  raw: string | null,
  format: (n: number) => string,
): Row | null {
  if (raw == null) return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return { label, value: format(n) };
}

function MetricRow({ label, value }: Row) {
  return (
    <View className="flex-row justify-between py-2">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-base text-black dark:text-white">{value}</Text>
    </View>
  );
}

function Section({
  title,
  rows,
}: {
  title: string;
  rows: (Row | null)[];
}) {
  const visible = rows.filter((r): r is Row => r != null);
  if (visible.length === 0) return null;
  return (
    <>
      <Text className={SECTION_HEADER}>{title}</Text>
      {visible.map((r) => (
        <MetricRow key={r.label} label={r.label} value={r.value} />
      ))}
    </>
  );
}

function MeasurementBody({
  data,
  id,
}: {
  data: MeasurementEntryRow;
  id: string;
}) {
  const weightUnit = useWeightUnit();
  const lengthUnit = useLengthUnit();

  let dateLabel: string;
  try {
    dateLabel = format(parseISO(data.measured_at), "EEE, MMM d, yyyy");
  } catch {
    dateLabel = data.measured_at.slice(0, 10);
  }

  const fmtW = (n: number) => formatWeight(n, weightUnit);
  const fmtL = (n: number) => formatLength(n, lengthUnit);
  const fmtPct = (n: number) => `${n.toFixed(1)} %`;

  const weightBody = [
    buildRow("Weight", data.weight_kg, fmtW),
    buildRow("Body fat %", data.body_fat_pct, fmtPct),
  ];
  const upper = [
    buildRow("Neck", data.neck_cm, fmtL),
    buildRow("Chest", data.chest_cm, fmtL),
    buildRow("Biceps", data.biceps_cm, fmtL),
    buildRow("Forearm", data.forearm_cm, fmtL),
  ];
  const core = [
    buildRow("Waist", data.waist_cm, fmtL),
    buildRow("Hips", data.hips_cm, fmtL),
  ];
  const lower = [
    buildRow("Thigh", data.thigh_cm, fmtL),
    buildRow("Calf", data.calf_cm, fmtL),
  ];
  const notesValue = data.notes?.trim() ?? "";

  return (
    <>
      <Text className="text-2xl font-semibold text-black dark:text-white">
        {dateLabel}
      </Text>

      <Section title="Weight & body fat" rows={weightBody} />
      <Section title="Upper body" rows={upper} />
      <Section title="Core" rows={core} />
      <Section title="Lower body" rows={lower} />

      {notesValue.length > 0 ? (
        <>
          <Text className={SECTION_HEADER}>Notes</Text>
          <Text className="text-base text-black dark:text-white">
            {notesValue}
          </Text>
        </>
      ) : null}

      <Link href={`/(app)/measurements/${id}/edit`} asChild>
        <Pressable
          accessibilityRole="button"
          className="mt-8 rounded-lg border border-blue-500 py-3"
        >
          <Text className="text-center text-base font-medium text-blue-500">
            Edit measurement
          </Text>
        </Pressable>
      </Link>
    </>
  );
}

export default function ViewMeasurementScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { data, isLoading, isError, error } = useMeasurement(id);

  const screenHeader = (
    <Stack.Screen
      options={{
        title: "Measurement",
        headerShown: true,
        headerRight: () => (
          <Pressable
            onPress={() => router.push(`/(app)/measurements/${id}/edit`)}
            accessibilityLabel="Edit measurement"
            accessibilityRole="button"
            className="px-3 py-1"
          >
            <Pencil color={colorScheme === "dark" ? "#fff" : "#000"} size={20} />
          </Pressable>
        ),
      }}
    />
  );

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        {screenHeader}
        <ActivityIndicator />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        {screenHeader}
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
    >
      {screenHeader}
      <MeasurementBody data={data} id={id ?? ""} />
    </ScrollView>
  );
}
