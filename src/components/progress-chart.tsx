import { useMemo } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";

export type DataPoint = {
  label: string;
  value: number;
};

type Props = {
  data: DataPoint[];
  width: number;
  height?: number;
  title: string;
  formatValue?: (v: number) => string;
};

const PADDING = { top: 20, right: 16, bottom: 40, left: 48 };

export function ProgressChart({
  data,
  width,
  height = 200,
  title,
  formatValue = (v) => v.toFixed(0),
}: Props) {
  const chart = useMemo(() => {
    if (data.length < 2) return null;

    const values = data.map((d) => d.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1;

    const plotW = width - PADDING.left - PADDING.right;
    const plotH = height - PADDING.top - PADDING.bottom;

    const points = data.map((d, i) => {
      const x = PADDING.left + (i / (data.length - 1)) * plotW;
      const y = PADDING.top + plotH - ((d.value - minV) / range) * plotH;
      return { x, y, ...d };
    });

    const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

    const yTicks = 4;
    const yLines = Array.from({ length: yTicks + 1 }, (_, i) => {
      const v = minV + (range / yTicks) * i;
      const y = PADDING.top + plotH - (i / yTicks) * plotH;
      return { v, y };
    });

    const xLabelStep = Math.max(1, Math.floor(data.length / 5));
    const xLabels = points.filter((_, i) => i % xLabelStep === 0 || i === data.length - 1);

    return { points, polylinePoints, yLines, xLabels, plotW, plotH };
  }, [data, width, height]);

  if (data.length === 0) {
    return (
      <View className="items-center py-8">
        <Text className="text-base text-gray-500">No data yet</Text>
      </View>
    );
  }

  if (data.length === 1) {
    return (
      <View className="py-4">
        <Text className="mb-1 text-sm font-medium text-gray-500">{title}</Text>
        <Text className="text-2xl font-semibold text-black dark:text-white">
          {formatValue(data[0]!.value)}
        </Text>
        <Text className="text-xs text-gray-400">{data[0]!.label}</Text>
      </View>
    );
  }

  if (!chart) return null;

  return (
    <View>
      <Text className="mb-2 text-sm font-medium text-gray-500">{title}</Text>
      <Svg width={width} height={height}>
        {chart.yLines.map((yl, i) => (
          <Line
            key={`grid-${i}`}
            x1={PADDING.left}
            y1={yl.y}
            x2={PADDING.left + chart.plotW}
            y2={yl.y}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        ))}
        {chart.yLines.map((yl, i) => (
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

        <Polyline
          points={chart.polylinePoints}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {chart.points.map((p, i) => (
          <Circle key={`dot-${i}`} cx={p.x} cy={p.y} r={3} fill="#3b82f6" />
        ))}

        {chart.xLabels.map((p, i) => (
          <SvgText
            key={`xlabel-${i}`}
            x={p.x}
            y={height - 8}
            textAnchor="middle"
            fontSize={9}
            fill="#9ca3af"
          >
            {p.label}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}
