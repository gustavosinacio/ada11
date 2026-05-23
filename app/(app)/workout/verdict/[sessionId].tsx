import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { PrListRow } from "~/components/pr-list-row";
import { Button } from "~/components/ui/button";
import { useAllExercises } from "~/hooks/use-exercises";
import {
  useMaxVolumeWindowWeeks,
  useWeightUnit,
} from "~/hooks/use-preferences";
import { useSession } from "~/hooks/use-sessions";
import { useSetsForSession } from "~/hooks/use-sets";
import { useLifetimeWeeklyVolume } from "~/hooks/use-stats";
import { formatDuration } from "~/utils/format-session-times";
import {
  computeCurrentSessionVolumeByExercise,
  computePrsForSession,
} from "~/utils/session-verdict-math";
import { formatVolume } from "~/utils/units";
import { sumLiveVolume } from "~/utils/volume-target";
import { computeWindowStart } from "~/utils/window-utils";

/**
 * One-shot end-of-session verdict screen. Replace-arrived from the live
 * workout's Finish flow. Read-only: derives all display data from caches the
 * live screen already warmed (`useSession`, `useSetsForSession`,
 * `useAllExercises`, `useLifetimeWeeklyVolume`). No mutations.
 *
 * Headline: `+N PRs · Y kg · Zh Wm` (eager `+0 PRs` until lifetime resolves;
 * see MIN-3 in design-v2).
 * PR list: one row per exercise that beat its prior lifetime-best volume in
 * this session. Tap a row → exercise progress page.
 * Empty states: copy split by whether any sets were logged (MIN-4).
 *
 * Done button (sticky bottom): `router.replace("/(app)/workout")`.
 */
export default function WorkoutVerdictScreen(): React.JSX.Element {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const unit = useWeightUnit();

  const session = useSession(sessionId);
  const setsQ = useSetsForSession(sessionId);
  const exercisesQ = useAllExercises();
  const lifetimeQ = useLifetimeWeeklyVolume();
  const weeks = useMaxVolumeWindowWeeks();
  const windowStartMs = useMemo(
    () => computeWindowStart(weeks, new Date()),
    [weeks],
  );

  const totalVolumeKg = useMemo(
    () => sumLiveVolume(setsQ.data ?? []),
    [setsQ.data],
  );

  const currentByExercise = useMemo(
    () => computeCurrentSessionVolumeByExercise(setsQ.data ?? []),
    [setsQ.data],
  );

  // PR list. Short-circuits to `[]` until both lifetime + exercises caches are
  // present. Once `lifetimeQ.data` resolves, the headline + PR list update
  // atomically — eager `+0 PRs` then real count (MIN-3 in design-v2).
  const prs = useMemo(() => {
    if (!sessionId || !lifetimeQ.data || !exercisesQ.data) return [];
    const exMap = new Map(exercisesQ.data.map((e) => [e.id, e]));
    return computePrsForSession({
      rows: lifetimeQ.data,
      currentSessionId: sessionId,
      currentSessionVolumeByExercise: currentByExercise,
      windowStartMs,
    }).map((pr) => ({
      ...pr,
      exerciseName: exMap.get(pr.exerciseId)?.name ?? "Unknown exercise",
    }));
  }, [
    sessionId,
    lifetimeQ.data,
    exercisesQ.data,
    currentByExercise,
    windowStartMs,
  ]);

  // Headline is ready as soon as session + sets + exercises are present.
  // `useSession.onSuccess` cache-seeded the row synchronously in
  // `useFinishSession`, so this flips true on first render except in the
  // cold deep-link case.
  const isHeadlineReady =
    !!session.data &&
    !!setsQ.data &&
    !!exercisesQ.data &&
    session.data.ended_at != null;

  // PR-list slot still shows a skeleton until the lifetime read returns.
  const isPrListReady = lifetimeQ.data !== undefined;

  // Loading + error guards.
  if (session.isError || (session.data == null && !session.isLoading)) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <Stack.Screen
          options={{ title: "Workout summary", headerShown: true }}
        />
        <Text className="text-base text-red-500">
          {session.error instanceof Error
            ? session.error.message
            : "Session not found"}
        </Text>
        <View className="mt-4 w-full max-w-sm">
          <Button
            label="Done"
            onPress={() => router.replace("/(app)/workout")}
            accessibilityLabel="Done"
          />
        </View>
      </View>
    );
  }

  if (!isHeadlineReady) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Stack.Screen
          options={{ title: "Workout summary", headerShown: true }}
        />
        <ActivityIndicator />
      </View>
    );
  }

  // Derived headline fields. `session.data` is non-null here (guarded above).
  const startedAt = session.data!.started_at;
  const endedAt = session.data!.ended_at; // guaranteed non-null by isHeadlineReady
  const prCount = prs.length;
  const prCountLabel = prCount > 0 ? `+${prCount} PRs` : "0 PRs";
  const durationLabel = formatDuration(startedAt, endedAt);
  const volumeLabel = formatVolume(totalVolumeKg, unit);
  const headlineText = `${prCountLabel} · ${volumeLabel} · ${durationLabel}`;

  // Empty-state copy split by whether any sets were logged (MIN-4 in
  // design-v2). The non-zero branch celebrates consistency; the zero branch
  // gently nudges toward next time.
  const emptyCopy =
    totalVolumeKg === 0
      ? "No sets logged — your next session counts."
      : "Solid session — keep it consistent.";

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <Stack.Screen
        options={{ title: "Workout summary", headerShown: true }}
      />

      <ScrollView contentContainerClassName="pb-24">
        {/* Headline block */}
        <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
          <Text className="text-xs uppercase tracking-wide text-gray-500">
            Workout summary
          </Text>
          <Text
            className="mt-1 text-3xl font-semibold tabular-nums text-black dark:text-white"
            accessibilityLabel={`${prCountLabel}, ${volumeLabel}, ${durationLabel}`}
          >
            {headlineText}
          </Text>
        </View>

        {/* PR list OR empty copy OR skeleton */}
        {!isPrListReady ? (
          <View className="px-4 py-6" accessibilityLabel="Loading PRs">
            <View className="mb-3 h-3 w-24 rounded-sm bg-gray-100 dark:bg-gray-900" />
            <View className="mb-2 h-4 w-full rounded-sm bg-gray-100 dark:bg-gray-900" />
            <View className="mb-2 h-4 w-3/4 rounded-sm bg-gray-100 dark:bg-gray-900" />
            <View className="h-4 w-1/2 rounded-sm bg-gray-100 dark:bg-gray-900" />
          </View>
        ) : prs.length > 0 ? (
          <View className="pb-2">
            <Text className="mb-2 mt-4 px-4 text-sm font-medium uppercase text-gray-500">
              New PRs
            </Text>
            {prs.map((pr) => (
              <PrListRow
                key={pr.exerciseId}
                exerciseId={pr.exerciseId}
                exerciseName={pr.exerciseName}
                priorMaxKg={pr.priorMaxKg}
                overflowKg={pr.overflowKg}
                unit={unit}
                onPress={(id) =>
                  router.push(`/(app)/exercises/${id}/progress`)
                }
              />
            ))}
          </View>
        ) : (
          <View className="px-4 py-8">
            <Text className="text-center text-base text-gray-500">
              {emptyCopy}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Sticky bottom Done bar */}
      <View className="border-t border-gray-200 px-4 py-4 dark:border-gray-800">
        <Button
          label="Done"
          variant="primary"
          onPress={() => router.replace("/(app)/workout")}
          accessibilityLabel="Done"
        />
      </View>
    </View>
  );
}
