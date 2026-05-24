import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
} from "react-native";

import { SessionSummaryRow } from "~/components/session-summary-row";
import type { SessionRow } from "~/db/types";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useSessions } from "~/hooks/use-sessions";
import { useLifetimeWeeklyVolume } from "~/hooks/use-stats";
import { parseISO, weekKeyOf } from "~/utils/dates";
import { formatDisplayDate } from "~/utils/format-display-date";
import { groupSessionVolumes } from "~/utils/progress-page-math";
import { formatVolume } from "~/utils/units";

const SECTION_HEADER =
  "mt-4 mb-2 text-sm font-medium uppercase text-gray-500";

type Row = { label: string; value: string };

function MetricRow({ label, value }: Row) {
  return (
    <View className="flex-row justify-between py-2">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-base text-black dark:text-white">{value}</Text>
    </View>
  );
}

function Section({ title, rows }: { title: string; rows: (Row | null)[] }) {
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

export default function ViewWeekScreen(): React.JSX.Element {
  const router = useRouter();
  const { isoWeek } = useLocalSearchParams<{ isoWeek: string }>();
  const unit = useWeightUnit();

  const sessionsQ = useSessions();
  const weeklyVolumeQ = useLifetimeWeeklyVolume();

  // Defensive parse: `parseISO` accepts arbitrary strings; we reject anything
  // that isn't a valid Date so a tampered URL renders an empty state instead
  // of crashing downstream `format` / `weekKeyOf` calls.
  const monday: Date | null = useMemo(() => {
    if (!isoWeek) return null;
    const d = parseISO(isoWeek);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }, [isoWeek]);

  const targetKey: string = monday ? weekKeyOf(monday) : "";

  // Lifetime data covers every historical ISO week — no out-of-window guard
  // is needed anymore. Deep links / bookmarked URLs / cache-rolls past Monday
  // midnight all land on a bucket the cache already has.

  const weekSessions: SessionRow[] = useMemo(() => {
    if (!targetKey) return [];
    const all = sessionsQ.data ?? [];
    return all.filter(
      (s) => weekKeyOf(parseISO(s.started_at)) === targetKey,
    );
  }, [sessionsQ.data, targetKey]);

  // Headline volume — same kernel as `weekly-volume-strip.tsx:39-46`. Reduce
  // the cached weekly-volume rows for the target week so the bar number on
  // the previous screen and this headline come from the same denominator.
  const weekVolumeKg: number = useMemo(() => {
    if (!targetKey) return 0;
    const rows = weeklyVolumeQ.data ?? [];
    let vol = 0;
    for (const row of rows) {
      if (weekKeyOf(parseISO(row.completed_at)) !== targetKey) continue;
      const w = row.weight ? parseFloat(row.weight) : 0;
      const r = row.reps ?? 0;
      if (Number.isFinite(w) && w > 0 && r > 0) vol += w * r;
    }
    return vol;
  }, [weeklyVolumeQ.data, targetKey]);

  // Per-session volume map for the row totals. Reuses the same lifetime
  // cache the headline above reads — one O(n) reduce, memoized on `data`
  // reference identity.
  const totalVolumeBySessionId = useMemo(
    () => groupSessionVolumes(weeklyVolumeQ.data ?? []),
    [weeklyVolumeQ.data],
  );

  const endedSessionsCount = weekSessions.filter(
    (s) => s.ended_at != null,
  ).length;
  const inProgressCount = weekSessions.length - endedSessionsCount;
  const avgVolumePerSession =
    endedSessionsCount > 0 ? weekVolumeKg / endedSessionsCount : 0;

  const title = monday ? `Week of ${formatDisplayDate(monday)}` : "Week";
  const screenHeader = (
    <Stack.Screen options={{ title, headerShown: true }} />
  );

  // BRANCH 1: invalid URL segment.
  if (!monday) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        {screenHeader}
        <Text className="text-base text-red-500">Invalid week.</Text>
      </View>
    );
  }

  // BRANCH 2: either underlying query loading.
  if (sessionsQ.isLoading || weeklyVolumeQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        {screenHeader}
        <ActivityIndicator />
      </View>
    );
  }

  // BRANCH 3: either underlying query errored.
  if (sessionsQ.isError || weeklyVolumeQ.isError) {
    const err = sessionsQ.error ?? weeklyVolumeQ.error;
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        {screenHeader}
        <Text className="text-base text-red-500">
          {err instanceof Error ? err.message : "Failed to load week"}
        </Text>
      </View>
    );
  }

  // BRANCH 4: data — zero-or-more sessions, render the stat sheet + list.
  const rangeStart = formatDisplayDate(monday);
  // Sunday of the week (Monday + 6 days). Display only — `endOfWeek` is
  // applied elsewhere for boundary math; here we just need a label.
  const sundayMs = monday.getTime() + 6 * 24 * 60 * 60 * 1000;
  const rangeEnd = formatDisplayDate(new Date(sundayMs));
  const bodyHeader = `${rangeStart} – ${rangeEnd}`;

  const sessionsRowLabel = `${endedSessionsCount}${
    inProgressCount > 0 ? ` (incl. ${inProgressCount} in progress)` : ""
  }`;

  const statRows: (Row | null)[] = [
    {
      label: "Total volume",
      value: formatVolume(weekVolumeKg, unit),
    },
    {
      label: "Sessions",
      value: sessionsRowLabel,
    },
    endedSessionsCount > 0
      ? {
          label: "Avg per session",
          value: formatVolume(avgVolumePerSession, unit),
        }
      : null,
  ];

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="pb-12"
    >
      {screenHeader}

      <View className="px-6 pt-6">
        <Text
          accessibilityLabel={`Week range: ${bodyHeader}`}
          className="text-2xl font-semibold text-black dark:text-white"
        >
          {bodyHeader}
        </Text>

        <Section title="Volume" rows={statRows} />
      </View>

      <Text className={`${SECTION_HEADER} px-6`}>Sessions</Text>

      {weekSessions.length === 0 ? (
        <View className="px-6 py-10">
          <Text className="text-center text-base text-gray-500">
            No sessions this week.
          </Text>
        </View>
      ) : (
        weekSessions.map((s) => (
          <SessionSummaryRow
            key={s.id}
            session={s}
            unit={unit}
            totalVolumeKg={totalVolumeBySessionId.get(s.id)}
            onPress={() => router.push(`/(app)/history/${s.id}`)}
          />
        ))
      )}
    </ScrollView>
  );
}
