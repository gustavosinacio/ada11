import { ChevronDown } from "lucide-react-native";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type Ref,
} from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

/**
 * Imperative handle exposed by `<VisibleRangePill>`. The strip's `onScroll`
 * calls `setRange(label)` to update the pill's label WITHOUT triggering a
 * re-render of the strip parent (which would reconcile the entire bar array).
 */
export type VisibleRangePillHandle = {
  setRange: (label: string) => void;
};

type VisibleRangePillProps = {
  /** Label rendered on first paint, before any scroll fires. */
  initialLabel: string;
  /** Tap → open the `<WeekSelector>` modal. */
  onPress: () => void;
};

/**
 * Tappable header pill showing the strip's currently-visible week range.
 *
 * State (`label`) lives inside this child component on purpose — the strip
 * parent calls `pillRef.current?.setRange(label)` from `onScroll`, so only
 * this `<Text>` re-renders during a flick. The 260-bar `<Pressable>` array in
 * the parent does not reconcile per-frame.
 *
 * The canonical RN pattern is `forwardRef` + `useImperativeHandle` with a
 * narrow handle shape. We expose only `setRange` — never the inner setter
 * directly — so callers cannot mutate component state out of contract.
 */
export const VisibleRangePill = forwardRef<
  VisibleRangePillHandle,
  VisibleRangePillProps
>(function VisibleRangePill({ initialLabel, onPress }, ref) {
  const [label, setLabel] = useState<string>(initialLabel);

  useImperativeHandle(
    ref,
    () => ({
      setRange: (next: string) => setLabel(next),
    }),
    [],
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Jump to week — visible range ${label}`}
      className="flex-row items-center gap-1 self-start rounded-full border border-gray-300 px-3 py-1.5 active:opacity-70 dark:border-gray-700"
    >
      <Text className="text-xs text-gray-700 dark:text-gray-200">{label}</Text>
      <ChevronDown color="#6b7280" size={14} />
    </Pressable>
  );
});

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

type WeekSelectorModalProps = {
  /** Whether the modal is currently visible. */
  visible: boolean;
  /** Called when the user dismisses without confirming. */
  onClose: () => void;
  /** Called when the user confirms a (year, monthIndex0) pick. */
  onJumpTo: (year: number, month: number) => void;
  /** Years to render in the year row, ascending. */
  availableYears: number[];
  /** Earliest (year, monthIndex0) the user has data for; older picks dimmed. */
  firstAvailable: { year: number; month: number };
  /** Latest (year, monthIndex0) the user has data for. */
  lastAvailable: { year: number; month: number };
};

/**
 * Bottom-sheet modal with year + month chips. Mirrors `<SetRowMenu>` exactly:
 * slide-from-bottom, backdrop-tap dismisses, no `[X]` header button.
 *
 * Pre-first-session months are dimmed AND made non-pressable (`opacity-40` +
 * `pointer-events-none`). Post-last-available months stay enabled so users
 * can scroll into "future" months that haven't yet rolled over (the strip
 * just lands on the rightmost bar in that case).
 */
export function WeekSelectorModal({
  visible,
  onClose,
  onJumpTo,
  availableYears,
  firstAvailable,
  lastAvailable,
}: WeekSelectorModalProps) {
  const initialYear = lastAvailable.year;
  const initialMonth = lastAvailable.month;
  const [year, setYear] = useState<number>(initialYear);
  const [month, setMonth] = useState<number>(initialMonth);

  // When the modal re-opens, reset the local pick to the most-recent available
  // (year, month). This keeps the flow consistent: open → see today → tap to
  // navigate. Without the reset, a previous half-finished pick would persist.
  useEffect(() => {
    if (visible) {
      setYear(initialYear);
      setMonth(initialMonth);
    }
  }, [visible, initialYear, initialMonth]);

  const isBeforeFirst = (y: number, m: number): boolean => {
    if (y < firstAvailable.year) return true;
    if (y === firstAvailable.year && m < firstAvailable.month) return true;
    return false;
  };

  const handleConfirm = () => {
    onJumpTo(year, month);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Dismiss week selector"
        accessibilityRole="button"
        className="flex-1 justify-end bg-black/50"
      >
        {/* Inner blocker: prevents backdrop dismiss when tapping the card. */}
        <Pressable onPress={() => {}} accessibilityRole="none">
          <View className="rounded-t-2xl bg-white px-6 pb-10 pt-6 dark:bg-gray-900">
            <Text className="mb-4 text-lg font-semibold text-black dark:text-white">
              Jump to month
            </Text>

            <Text className="mb-2 text-xs uppercase text-gray-500">Year</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2 pb-1"
            >
              {availableYears.map((y) => {
                const isSelected = y === year;
                return (
                  <Pressable
                    key={y}
                    onPress={() => setYear(y)}
                    accessibilityRole="button"
                    accessibilityLabel={`Year ${y}`}
                    accessibilityState={{ selected: isSelected }}
                    className={`min-w-[56px] items-center justify-center rounded-full px-3 py-2 ${
                      isSelected
                        ? "bg-emerald-500"
                        : "border border-gray-300 dark:border-gray-700"
                    }`}
                  >
                    <Text
                      className={`text-sm ${
                        isSelected
                          ? "font-semibold text-white"
                          : "text-gray-800 dark:text-gray-100"
                      }`}
                    >
                      {y}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text className="mb-2 mt-5 text-xs uppercase text-gray-500">
              Month
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {MONTH_LABELS.map((m, idx) => {
                const isSelected = idx === month;
                const disabled = isBeforeFirst(year, idx);
                const baseClasses =
                  "min-w-[56px] items-center justify-center rounded-full px-3 py-2";
                const stateClasses = isSelected
                  ? "bg-emerald-500"
                  : "border border-gray-300 dark:border-gray-700";
                const dimClasses = disabled
                  ? "opacity-40 pointer-events-none"
                  : "";
                return (
                  <Pressable
                    key={m}
                    onPress={() => {
                      if (disabled) return;
                      setMonth(idx);
                    }}
                    disabled={disabled}
                    accessibilityRole="button"
                    accessibilityLabel={`Month ${m}`}
                    accessibilityState={{
                      selected: isSelected,
                      disabled,
                    }}
                    className={`${baseClasses} ${stateClasses} ${dimClasses}`}
                  >
                    <Text
                      className={`text-sm ${
                        isSelected
                          ? "font-semibold text-white"
                          : "text-gray-800 dark:text-gray-100"
                      }`}
                    >
                      {m}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text className="mt-3 text-[11px] text-gray-500">
              Months before your first session are dimmed.
            </Text>

            <View className="mt-6 flex-row justify-end">
              <Pressable
                onPress={handleConfirm}
                accessibilityRole="button"
                accessibilityLabel="Jump to selected month"
                className="rounded-full bg-blue-500 px-5 py-2.5 active:opacity-70 dark:bg-blue-400"
              >
                <Text className="text-sm font-semibold text-white">Jump</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type WeekSelectorHeaderProps = {
  /** Label shown inside the pill on first paint. */
  initialLabel: string;
  /** Ref forwarded into the inner `<VisibleRangePill>` for scoped label updates. */
  pillRef: Ref<VisibleRangePillHandle>;
  /** Called when the user confirms a (year, monthIndex0) pick from the modal. */
  onJumpTo: (year: number, month: number) => void;
  availableYears: number[];
  firstAvailable: { year: number; month: number };
  lastAvailable: { year: number; month: number };
};

/**
 * Composite header used by `<WeeklyVolumeStrip>`. Owns the modal open/close
 * state internally so the strip parent doesn't need to thread it. Exposes the
 * `<VisibleRangePill>` via `pillRef` so the strip's `onScroll` can mutate the
 * label without parent re-renders.
 */
export function WeekSelectorHeader({
  initialLabel,
  pillRef,
  onJumpTo,
  availableYears,
  firstAvailable,
  lastAvailable,
}: WeekSelectorHeaderProps) {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <>
      <VisibleRangePill
        ref={pillRef}
        initialLabel={initialLabel}
        onPress={() => setOpen(true)}
      />
      <WeekSelectorModal
        visible={open}
        onClose={() => setOpen(false)}
        onJumpTo={onJumpTo}
        availableYears={availableYears}
        firstAvailable={firstAvailable}
        lastAvailable={lastAvailable}
      />
    </>
  );
}
