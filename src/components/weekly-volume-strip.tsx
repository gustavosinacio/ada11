import { format } from "date-fns";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { useMeasurements } from "~/hooks/use-measurements";
import { useWeightUnit } from "~/hooks/use-preferences";
import { useLifetimeWeeklyVolume } from "~/hooks/use-stats";
import { isoWeekContaining, isoWeekStart } from "~/utils/dates";
import {
  formatDisplayDate,
  formatShortDate,
} from "~/utils/format-display-date";
import { formatVolume } from "~/utils/units";
import {
  computeStripModel,
  type StripModel,
} from "~/utils/weekly-volume-strip-math";

import {
  WeekSelectorHeader,
  type VisibleRangePillHandle,
} from "./week-selector";

const PLOT_HEIGHT = 96;
const MIN_BAR_HEIGHT = 4;
const BAR_WIDTH = 40;
const BAR_GAP = 6;
const COLUMN_WIDTH = BAR_WIDTH + BAR_GAP; // 46pt — used by scroll-anchor math.

type Props = {
  /**
   * Lifetime-best-week kg. When `> 0` AND provided:
   *  - The bar-height denominator becomes `Math.max(model.maxKg, bestWeekKg)`.
   *  - A dotted overlay line is drawn at the bestWeekKg level, spanning the
   *    full content width inside the scroller.
   * When undefined or 0, no overlay is rendered (History behaviour).
   */
  bestWeekKg?: number;
  /**
   * Optional label rendered below the bar row (e.g. "Best week: 26,210 kg
   * (5/13)"). Caller assembles this so the strip stays unit-agnostic.
   */
  bestWeekLabel?: string;
};

/**
 * Formats the visible-range label shown in the `<VisibleRangePill>`.
 *
 * Both ends route through `formatDisplayDate`, so each label gets a year
 * suffix only when it falls outside the current local year. The rule is
 * applied per end, independently — the helper does not coalesce a shared
 * year across the two sides. This aligns the pill with the app-wide
 * year-conditional rule:
 *
 *   Current-year window (current year = 2026):
 *     start = Apr 27 2026, end = Jun 21 2026
 *     → "27/04 – 21/06"
 *   Cross-year window (current year = 2026):
 *     start = Dec 29 2025, end = Jan 11 2026
 *     → "29/12/25 – 11/01"        // only the prior-year end carries "25"
 *   Fully-prior-year window (current year = 2026):
 *     start = Nov 4 2019, end = Nov 10 2019
 *     → "04/11/19 – 10/11/19"     // both ends carry the year
 */
function formatVisibleRange(startMonday: Date, endMonday: Date): string {
  return `${formatDisplayDate(startMonday)} – ${formatDisplayDate(endMonday)}`;
}

export function WeeklyVolumeStrip({
  bestWeekKg,
  bestWeekLabel,
}: Props = {}): React.JSX.Element | null {
  const router = useRouter();
  const { data, isLoading, isError } = useLifetimeWeeklyVolume();
  const { data: measurements } = useMeasurements();
  const unit = useWeightUnit();

  const scrollRef = useRef<ScrollView | null>(null);
  const pillRef = useRef<VisibleRangePillHandle | null>(null);
  const lastLabelRef = useRef<string>("");
  const viewportWidthRef = useRef<number>(0);
  const isPinnedRightRef = useRef<boolean>(true);
  // One-shot guard for the initial right-edge pin. Flips `true` on the FIRST
  // `onContentSizeChange` with `w > 0` (i.e. when the loaded `<ScrollView>`
  // first measures its content) and never resets. Subsequent content-size
  // changes (refetch, week rollover, in-week volume growth) are handled by
  // the rollover effect at `:160-165` gated on `isPinnedRightRef`.
  const didInitialPinRef = useRef<boolean>(false);

  // Bucket math depends only on `data`. `unit` is read inline in JSX so the
  // toggle re-renders without invalidating the memo.
  const model: StripModel | null = useMemo(() => {
    if (!data || data.length === 0) return null;
    return computeStripModel(
      data,
      new Date(),
      measurements ? { measurements } : undefined,
    );
  }, [data, measurements]);

  const bucketsLength = model?.buckets.length ?? 0;

  // Initial label seeded to the rightmost full-width window (or the full
  // range if shorter than the assumed default viewport).
  const initialLabel = useMemo<string>(() => {
    if (!model || model.buckets.length === 0) return "";
    const last = model.buckets[model.buckets.length - 1]!;
    // Default-mount preview: aim for ~8 bars from the right edge so the label
    // matches what the user is most likely to see before `onScroll` fires.
    const previewCount = Math.min(8, model.buckets.length);
    const firstIdx = model.buckets.length - previewCount;
    const first = model.buckets[firstIdx]!;
    return formatVisibleRange(first.start, last.start);
  }, [model]);

  // Year/month menus for the selector. Years span first-session year → current
  // year inclusive; months are always 12, with pre-first-session months dimmed
  // inside the modal.
  const selectorMeta = useMemo(() => {
    if (!model) {
      return {
        availableYears: [] as number[],
        firstAvailable: { year: 0, month: 0 },
        lastAvailable: { year: 0, month: 0 },
      };
    }
    const firstYear = model.firstSessionMonday.getFullYear();
    const last = model.buckets[model.buckets.length - 1]!.start;
    const lastYear = last.getFullYear();
    const years: number[] = [];
    for (let y = firstYear; y <= lastYear; y++) years.push(y);
    return {
      availableYears: years,
      firstAvailable: {
        year: firstYear,
        month: model.firstSessionMonday.getMonth(),
      },
      lastAvailable: { year: lastYear, month: last.getMonth() },
    };
  }, [model]);

  // Imperative jump from the selector modal: scroll the strip so the first
  // ISO week of the chosen (year, monthIndex0) is visible at the left edge.
  const handleJumpTo = useCallback(
    (year: number, month: number) => {
      if (!model) return;
      const anchor = new Date(year, month, 1, 0, 0, 0);
      const targetMonday = isoWeekStart(anchor);
      const targetKey = isoWeekContaining(targetMonday).key;
      const idx = model.buckets.findIndex((b) => b.key === targetKey);
      if (idx < 0) return;
      const x = idx * COLUMN_WIDTH;
      scrollRef.current?.scrollTo({ x, y: 0, animated: true });
    },
    [model],
  );

  // Week-rollover effect: when a new bucket appears (e.g. user crossed
  // Monday midnight with the app open) AND the user was pinned to the right
  // edge, scroll back to the new rightmost bar. Preserves manual scroll
  // position otherwise.
  const prevCountRef = useRef<number>(bucketsLength);
  useEffect(() => {
    if (bucketsLength > prevCountRef.current && isPinnedRightRef.current) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
    prevCountRef.current = bucketsLength;
  }, [bucketsLength]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!model) return;
      const x = e.nativeEvent.contentOffset.x;
      const viewportWidth =
        viewportWidthRef.current || e.nativeEvent.layoutMeasurement.width;
      const contentWidth = e.nativeEvent.contentSize.width;

      // Track right-edge pinning for the rollover effect.
      isPinnedRightRef.current =
        contentWidth - (x + viewportWidth) <= COLUMN_WIDTH * 1.5;

      const startIdx = Math.max(0, Math.floor(x / COLUMN_WIDTH));
      const visibleCount = Math.max(1, Math.floor(viewportWidth / COLUMN_WIDTH));
      const endIdx = Math.min(
        model.buckets.length - 1,
        startIdx + visibleCount - 1,
      );
      const startBucket = model.buckets[startIdx];
      const endBucket = model.buckets[endIdx];
      if (!startBucket || !endBucket) return;
      const label = formatVisibleRange(startBucket.start, endBucket.start);
      // Scrutiny-2 dedupe: skip the setRange call when the label is unchanged.
      if (label === lastLabelRef.current) return;
      lastLabelRef.current = label;
      pillRef.current?.setRange(label);
    },
    [model],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    viewportWidthRef.current = e.nativeEvent.layout.width;
  }, []);

  // BRANCH 1: loading — wrapper + skeleton blocks.
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

  // Max-aware denominator. When `bestWeekKg` is undefined OR 0,
  // `denom === model.maxKg` (lifetime max) and bar heights stay proportional
  // to the largest week. When `bestWeekKg > model.maxKg`, bars rescale down
  // and the overlay sits at the top edge.
  const denom = Math.max(model.maxKg, bestWeekKg ?? 0);
  const showOverlay = bestWeekKg != null && bestWeekKg > 0;
  const overlayY =
    denom === 0
      ? PLOT_HEIGHT
      : PLOT_HEIGHT -
        Math.round(((bestWeekKg ?? 0) / denom) * PLOT_HEIGHT);

  const contentWidth =
    model.buckets.length * BAR_WIDTH +
    Math.max(0, model.buckets.length - 1) * BAR_GAP;

  return (
    <View
      onLayout={onLayout}
      className="border-b border-gray-200 px-4 py-5 dark:border-gray-800"
    >
      <Text className="text-xs uppercase tracking-wide text-gray-500">
        This week
      </Text>
      <Text className="mt-1 text-2xl font-semibold text-black dark:text-white">
        {formatVolume(model.currentWeekKg, unit)}
      </Text>

      <View className="mt-3">
        <WeekSelectorHeader
          initialLabel={initialLabel}
          pillRef={pillRef}
          onJumpTo={handleJumpTo}
          availableYears={selectorMeta.availableYears}
          firstAvailable={selectorMeta.firstAvailable}
          lastAvailable={selectorMeta.lastAvailable}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        testID="weekly-strip-scroller"
        onContentSizeChange={(w) => {
          if (didInitialPinRef.current) return;
          if (w <= 0) return;
          scrollRef.current?.scrollToEnd({ animated: false });
          didInitialPinRef.current = true;
        }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        className="mt-4"
      >
        <View
          style={{ width: contentWidth, height: PLOT_HEIGHT + 18 }}
          className="relative"
        >
          <View className="flex-row" style={{ gap: BAR_GAP }}>
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
              // Use the 4-digit year variant so the screen-reader value is
              // unambiguous even for prior-year bars. Current-year bars stay
              // `"View week of 5/12"` (no year), matching `b.label`.
              const a11yLabel = `View week of ${formatShortDate(b.start, {
                yearFormat: "numeric",
              })}`;
              return (
                <Pressable
                  key={b.key}
                  onPress={() => router.push(`/(app)/history/week/${segment}`)}
                  accessibilityRole="button"
                  accessibilityLabel={a11yLabel}
                  style={{ width: BAR_WIDTH }}
                  className="active:opacity-70"
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
          </View>

          {showOverlay ? (
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ top: overlayY, left: 0, width: contentWidth, height: 1 }}
              className="absolute border-t border-dashed border-emerald-500 dark:border-emerald-400"
            />
          ) : null}
        </View>
      </ScrollView>

      {showOverlay && bestWeekLabel ? (
        <Text className="mt-2 text-center text-[10px] text-emerald-600 dark:text-emerald-400">
          {bestWeekLabel}
        </Text>
      ) : null}
    </View>
  );
}
