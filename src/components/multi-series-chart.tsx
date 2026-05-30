import { useMemo } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";

export type ChartSeries = {
  label: string;
  color: string; // hex
  /** index-aligned to xLabels; values are pre-unit-converted by the caller. */
  values: number[];
  visible: boolean; // toggled by the section's check state
};

type MultiSeriesChartProps = {
  xLabels: string[]; // shared week axis labels
  series: ChartSeries[];
  width: number;
  height?: number; // default 200
  title: string;
  formatValue?: (v: number) => string;
};

// Mirrors `<ProgressChart>`'s left padding so multi-thousand y-labels don't
// clip the leading digit.
const PADDING = { top: 20, right: 16, bottom: 40, left: 64 };

/**
 * Multi-line SVG chart over a shared x-axis. One `<Polyline>` per VISIBLE
 * series colored by `series.color`; dots per point. Y-domain spans `max`
 * across all visible series, min pinned to 0 (volume is non-negative, so a
 * 0-baseline reads honestly — a drop to 0 is visible). X positions derive from
 * the shared `xLabels.length` (index spacing), so a muscle that is 0 in week W
 * still aligns to W's x (zero point, not a gap — Decision #4).
 *
 * 1-week behaviour (`xLabels.length === 1`): render a single dot per visible
 * series (do NOT return null the way `<ProgressChart>` does at `<2` points) so
 * the chart is not blank for a user in their first training week.
 *
 * Renders an empty-state when no series is visible OR every visible value is 0.
 */
export function MultiSeriesChart({
  xLabels,
  series,
  width,
  height = 200,
  title,
  formatValue = (v) => v.toFixed(0),
}: MultiSeriesChartProps): React.JSX.Element {
  const visibleSeries = useMemo(
    () => series.filter((s) => s.visible),
    [series],
  );

  const maxV = useMemo(() => {
    let m = 0;
    for (const s of visibleSeries) {
      for (const v of s.values) {
        if (v > m) m = v;
      }
    }
    return m;
  }, [visibleSeries]);

  const plotW = width - PADDING.left - PADDING.right;
  const plotH = height - PADDING.top - PADDING.bottom;
  const count = xLabels.length;

  // Empty-state: nothing toggled on, or all-zero, or no week axis.
  if (count === 0 || visibleSeries.length === 0 || maxV === 0) {
    return (
      <View>
        {title ? (
          <Text className="mb-2 text-sm font-medium text-gray-500">{title}</Text>
        ) : null}
        <View className="items-center py-8">
          <Text className="text-base text-gray-500">No data yet</Text>
        </View>
      </View>
    );
  }

  const range = maxV; // min pinned to 0.

  // X position for a point index. Single-week → center the lone dot.
  const xFor = (i: number): number => {
    if (count === 1) return PADDING.left + plotW / 2;
    return PADDING.left + (i / (count - 1)) * plotW;
  };
  const yFor = (v: number): number =>
    PADDING.top + plotH - (v / range) * plotH;

  const yTicks = 4;
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = (range / yTicks) * i;
    const y = PADDING.top + plotH - (i / yTicks) * plotH;
    return { v, y };
  });

  // Thin the x-labels (≈5 ticks) like `<ProgressChart>`.
  const xLabelStep = Math.max(1, Math.floor(count / 5));
  const xTicks = xLabels
    .map((label, i) => ({ label, i, x: xFor(i) }))
    .filter((t) => t.i % xLabelStep === 0 || t.i === count - 1);

  return (
    <View>
      {title ? (
        <Text className="mb-2 text-sm font-medium text-gray-500">{title}</Text>
      ) : null}
      <Svg width={width} height={height}>
        {yLines.map((yl, i) => (
          <Line
            key={`grid-${i}`}
            x1={PADDING.left}
            y1={yl.y}
            x2={PADDING.left + plotW}
            y2={yl.y}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        ))}
        {yLines.map((yl, i) => (
          <SvgText
            key={`ylabel-${i}`}
            x={PADDING.left - 6}
            y={yl.y + 4}
            textAnchor="end"
            fontSize={10}
            fill="#9ca3af"
          >
            {formatValue(yl.v)}
          </SvgText>
        ))}

        {visibleSeries.map((s) => {
          const points = s.values.map((v, i) => ({ x: xFor(i), y: yFor(v) }));
          const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
          return (
            <Polyline
              key={`line-${s.label}`}
              points={polylinePoints}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {visibleSeries.map((s) =>
          s.values.map((v, i) => (
            <Circle
              key={`dot-${s.label}-${i}`}
              cx={xFor(i)}
              cy={yFor(v)}
              r={3}
              fill={s.color}
            />
          )),
        )}

        {xTicks.map((t) => (
          <SvgText
            key={`xlabel-${t.i}`}
            x={t.x}
            y={height - 8}
            textAnchor="middle"
            fontSize={9}
            fill="#9ca3af"
          >
            {t.label}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}
