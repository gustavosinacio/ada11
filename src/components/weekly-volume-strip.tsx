import { format } from "date-fns";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import type { WeeklyVolumeRow } from "~/api/stats";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useWeeklyVolume } from "~/hooks/use-stats";
import { lastNIsoWeeks, parseISO, weekKeyOf } from "~/utils/dates";
import { formatVolume } from "~/utils/units";

type Bucket = {
  key: string;
  label: string;
  totalKg: number;
  isCurrent: boolean;
  /** Monday of this week — used to build the drill-down URL segment. */
  start: Date;
};

type StripModel = {
  buckets: Bucket[];
  maxKg: number;
  currentWeekKg: number;
};

const WEEKS_WINDOW = 8;
const PLOT_HEIGHT = 96;
const MIN_BAR_HEIGHT = 4;

/**
 * Pure bucketing helper. Lives next to the component because nothing else
 * needs it (per validator MIN-2). Builds exactly `WEEKS_WINDOW` buckets
 * oldest→newest, zero-filled where the user did nothing, and applies the
 * existing volume kernel (parseFloat weight × reps, guarded > 0; warmups are
 * already filtered server-side).
 */
function computeStripModel(data: WeeklyVolumeRow[]): StripModel {
  const weeks = lastNIsoWeeks(WEEKS_WINDOW);
  const totals = new Map<string, number>();
  for (const w of weeks) totals.set(w.key, 0);

  for (const row of data) {
    const key = weekKeyOf(parseISO(row.completed_at));
    if (!totals.has(key)) continue; // outside the rolling 8-week window
    const w = row.weight ? parseFloat(row.weight) : 0;
    const r = row.reps ?? 0;
    if (Number.isFinite(w) && w > 0 && r > 0) {
      totals.set(key, (totals.get(key) ?? 0) + w * r);
    }
  }

  const buckets: Bucket[] = weeks.map((wk, idx) => ({
    key: wk.key,
    label: wk.label,
    totalKg: totals.get(wk.key) ?? 0,
    isCurrent: idx === weeks.length - 1,
    start: wk.start,
  }));

  const maxKg = buckets.reduce((m, b) => (b.totalKg > m ? b.totalKg : m), 0);
  const currentWeekKg = buckets[buckets.length - 1]?.totalKg ?? 0;

  return { buckets, maxKg, currentWeekKg };
}

type Props = {
  /**
   * Lifetime-best-week kg. When `> 0` AND provided:
   *  - The bar-height denominator becomes `Math.max(model.maxKg, bestWeekKg)`.
   *  - A dotted overlay line is drawn at the bestWeekKg level.
   * When undefined or 0, the strip renders byte-identically to History's
   * existing behaviour (denom = model.maxKg, no overlay).
   */
  bestWeekKg?: number;
  /**
   * Optional label rendered below the date row (e.g. "Best week: 26,210 kg
   * (5/13)"). Caller assembles this so the strip stays unit-agnostic.
   */
  bestWeekLabel?: string;
};

export function WeeklyVolumeStrip({
  bestWeekKg,
  bestWeekLabel,
}: Props = {}): React.JSX.Element | null {
  const router = useRouter();
  const { data, isLoading, isError } = useWeeklyVolume();
  const unit = useWeightUnit();

  // Bucket math depends only on `data`. `unit` is read inline in JSX so the
  // toggle re-renders without invalidating the memo (MIN-5).
  const model: StripModel | null = useMemo(() => {
    if (!data || data.length === 0) return null;
    return computeStripModel(data);
  }, [data]);

  // BRANCH 1: loading — wrapper + skeleton blocks. Includes a placeholder
  // for the date-label row (MIN-1) so the layout doesn't jump on data arrival.
  if (isLoading) {
    return (
      <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
        <View className="h-3 w-20 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-1 h-7 w-32 rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-4 h-24 w-full rounded-sm bg-gray-100 dark:bg-gray-900" />
        <View className="mt-1 h-3 w-full rounded-sm bg-gray-100 dark:bg-gray-900" />
      </View>
    );
  }

  // BRANCH 2: error / no data / all-zero — bare null, no wrapper chrome.
  if (isError) return null;
  if (!model) return null;
  if (model.maxKg === 0) return null;

  // Max-aware denominator (BLK-2). When `bestWeekKg` is undefined OR 0,
  // `denom === model.maxKg` and bar heights are byte-identical to the
  // History-mount behaviour. When `bestWeekKg > model.maxKg`, bars rescale
  // down proportionally and the overlay sits at the top edge.
  const denom = Math.max(model.maxKg, bestWeekKg ?? 0);
  const showOverlay = bestWeekKg != null && bestWeekKg > 0;
  const overlayY =
    denom === 0
      ? PLOT_HEIGHT
      : PLOT_HEIGHT -
        Math.round(((bestWeekKg ?? 0) / denom) * PLOT_HEIGHT);

  // BRANCH 3: data — wrapper + per-column pressables. Each column owns the
  // bar (top, baseline-aligned via marginTop) and the date label (bottom),
  // so the whole column is the tap target. The dotted overlay (when present)
  // is rendered as an absolutely-positioned sibling over the bar row only.
  return (
    <View className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
      <Text className="text-xs uppercase tracking-wide text-gray-500">
        This week
      </Text>
      <Text className="mt-1 text-2xl font-semibold text-black dark:text-white">
        {formatVolume(model.currentWeekKg, unit)}
      </Text>

      <View className="relative mt-4 flex-row gap-1.5">
        {model.buckets.map((b) => {
          const h =
            denom === 0
              ? MIN_BAR_HEIGHT
              : Math.max(
                  MIN_BAR_HEIGHT,
                  Math.round((b.totalKg / denom) * PLOT_HEIGHT),
                );
          const barCls =
            b.totalKg === 0
              ? "rounded-sm bg-gray-200 dark:bg-gray-800"
              : b.isCurrent
                ? "rounded-sm bg-blue-500 dark:bg-blue-400"
                : "rounded-sm bg-gray-300 dark:bg-gray-700";
          const segment = format(b.start, "yyyy-MM-dd");
          return (
            <Pressable
              key={b.key}
              onPress={() => router.push(`/(app)/history/week/${segment}`)}
              accessibilityRole="button"
              accessibilityLabel={`View week of ${b.label}`}
              className="flex-1 active:opacity-70"
            >
              <View
                style={{ height: h, marginTop: PLOT_HEIGHT - h }}
                className={barCls}
              />
              <Text className="mt-1 text-center text-[10px] text-gray-500">
                {b.label}
              </Text>
            </Pressable>
          );
        })}

        {showOverlay ? (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ top: overlayY, height: 1 }}
            className="absolute left-0 right-0 border-t border-dashed border-emerald-500 dark:border-emerald-400"
          />
        ) : null}
      </View>

      {showOverlay && bestWeekLabel ? (
        <Text className="mt-2 text-center text-[10px] text-emerald-600 dark:text-emerald-400">
          {bestWeekLabel}
        </Text>
      ) : null}
    </View>
  );
}
