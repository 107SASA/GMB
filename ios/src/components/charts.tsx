import { Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { useTheme } from '@/lib/theme';

/**
 * Lightweight chart primitives built from plain Views — no chart library.
 * Used by the GBP Performance / Reviews sections and the Overview impact card.
 */

const CHART_HEIGHT = 140;

/**
 * Vertical bar chart for the "Review Trends — last 8 weeks" card, with an
 * optional dashed industry-average line. The best week renders green and the
 * in-progress current week renders faded (mirrors the reference app).
 */
export function WeeklyBars({
  data,
  industryAvg,
}: {
  /** Oldest → newest; the last entry is the current (partial) week. */
  data: { label: string; value: number }[];
  industryAvg?: number | null;
}) {
  const t = useTheme();
  if (data.length === 0) return null;

  const max = Math.max(...data.map((d) => d.value), industryAvg ?? 0, 1);
  const bestValue = Math.max(...data.slice(0, -1).map((d) => d.value), 0);
  const avgY = industryAvg != null ? (industryAvg / max) * CHART_HEIGHT : null;

  return (
    <View>
      {industryAvg != null && (
        <Text className="mb-1 font-sans-bold text-xs" style={{ color: t.amber }}>
          Industry Avg : {industryAvg}
        </Text>
      )}
      <View style={{ height: CHART_HEIGHT }} className="relative">
        {/* Dashed industry-average line */}
        {avgY != null && (
          <View
            className="absolute left-0 right-0 flex-row justify-between"
            style={{ bottom: avgY }}
          >
            {Array.from({ length: 24 }).map((_, i) => (
              <View key={i} style={{ width: 8, height: 2, backgroundColor: t.amber }} />
            ))}
          </View>
        )}
        <View className="flex-1 flex-row items-end gap-2">
          {data.map((d, i) => {
            const isCurrent = i === data.length - 1;
            const isBest = !isCurrent && d.value === bestValue && d.value > 0;
            const h = Math.max((d.value / max) * CHART_HEIGHT, d.value > 0 ? 8 : 3);
            return (
              <View key={d.label} className="flex-1 items-center justify-end">
                <View
                  className="w-full rounded-t-md"
                  style={{
                    height: h,
                    backgroundColor: isBest ? t.emerald : t.brand,
                    opacity: isCurrent ? 0.45 : 1,
                    borderWidth: isCurrent ? 1 : 0,
                    borderStyle: 'dashed',
                    borderColor: t.brandBright,
                  }}
                />
              </View>
            );
          })}
        </View>
      </View>
      <View className="mt-1.5 flex-row gap-2">
        {data.map((d) => (
          <Text key={d.label} className="flex-1 text-center font-sans text-[10px] text-zinc-500">
            {d.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

/**
 * The amber "Before" bars of the AI-impact card (Views / Calls / Directions,
 * avg per month). Values are labelled above each bar.
 */
export function ImpactBars({
  items,
}: {
  items: { label: string; value: number }[];
}) {
  const t = useTheme();
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <View>
      <View className="h-28 flex-row items-end justify-around gap-4">
        {items.map((item) => (
          <View key={item.label} className="flex-1 items-center justify-end">
            <Text className="mb-1 font-sans-semibold text-[13px]" style={{ color: t.amber }}>
              {item.value}
            </Text>
            <View
              className="w-9 rounded-t-lg"
              style={{
                height: Math.max((item.value / max) * 90, 4),
                backgroundColor: t.amber,
                opacity: 0.9,
              }}
            />
          </View>
        ))}
      </View>
      <View className="mt-1.5 flex-row justify-around gap-4 border-t border-surface-border pt-1.5">
        {items.map((item) => (
          <Text key={item.label} className="flex-1 text-center font-sans text-xs text-zinc-400">
            {item.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

/**
 * Real Before/After comparison — one grouped pair of bars per metric (Views /
 * Calls / Directions), both bars in a pair scaled against the SAME max so
 * the heights are actually comparable (ImpactBars above renders each side
 * as an independent chart, which normalizes them separately — fine for a
 * single-side "current" view, wrong for a side-by-side comparison, where a
 * before=1000/after=1040 pair should look nearly level, not two different
 * full-height bars). `null` for either side of a metric renders as an empty
 * "—" slot rather than a fabricated zero-height bar.
 */
export function BeforeAfterBars({
  metrics,
}: {
  metrics: { label: string; before: number | null; after: number | null }[];
}) {
  const t = useTheme();
  const overallMax = Math.max(...metrics.flatMap((m) => [m.before ?? 0, m.after ?? 0]), 1);

  return (
    <View>
      <View className="flex-row items-end justify-around gap-5">
        {metrics.map((m) => (
          <View key={m.label} className="flex-1 items-center">
            <View className="h-28 w-full flex-row items-end justify-center gap-1.5">
              <View className="items-center">
                {m.before != null && (
                  <Text className="mb-1 font-sans-semibold text-xs" style={{ color: t.amber }}>
                    {m.before}
                  </Text>
                )}
                <View
                  className="w-6 rounded-t-md"
                  style={{
                    height: m.before != null ? Math.max((m.before / overallMax) * 90, 4) : 2,
                    backgroundColor: m.before != null ? t.amber : t.border,
                    opacity: m.before != null ? 0.9 : 1,
                  }}
                />
              </View>
              <View className="items-center">
                {m.after != null && (
                  <Text className="mb-1 font-sans-semibold text-xs" style={{ color: t.brandBright }}>
                    {m.after}
                  </Text>
                )}
                <View
                  className="w-6 rounded-t-md"
                  style={{
                    height: m.after != null ? Math.max((m.after / overallMax) * 90, 4) : 2,
                    backgroundColor: m.after != null ? t.brandBright : t.border,
                    opacity: m.after != null ? 0.9 : 1,
                  }}
                />
              </View>
            </View>
            <Text className="mt-1.5 text-center font-sans text-xs text-zinc-400">{m.label}</Text>
            <Text className="text-center font-sans text-[10px] text-zinc-500">Avg/month</Text>
          </View>
        ))}
      </View>

      <View className="mt-4 flex-row items-center justify-center gap-5">
        <View className="flex-row items-center gap-1.5">
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.amber }} />
          <Text className="font-sans text-xs text-zinc-400">Before</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.brandBright }} />
          <Text className="font-sans text-xs text-zinc-400">After</Text>
        </View>
      </View>
    </View>
  );
}

function formatAxisValue(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}K`.replace('.0K', 'K');
  return String(Math.round(n));
}

/**
 * Smooth line + gradient-fill area chart — "Last N Months Trends" on the
 * Performance tab. Uses a fixed internal viewBox scaled to 100% width via
 * SVG's own viewBox scaling, so no onLayout measurement is needed. A flat
 * (all-zero or single-point) series still renders a valid, non-degenerate
 * line rather than dividing by a zero range.
 */
export function LineChart({
  points,
  color,
}: {
  points: { label: string; value: number }[];
  color: string;
}) {
  const t = useTheme();
  const VB_W = 300;
  const VB_H = 130;
  const PAD_TOP = 10;
  const PAD_BOTTOM = 10;

  if (points.length === 0) {
    return (
      <View className="h-36 items-center justify-center">
        <Text className="font-sans text-sm text-zinc-500">Not enough history yet</Text>
      </View>
    );
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const xAt = (i: number) => (points.length === 1 ? VB_W / 2 : (i / (points.length - 1)) * VB_W);
  const yAt = (v: number) => PAD_TOP + (1 - (v - min) / range) * (VB_H - PAD_TOP - PAD_BOTTOM);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.value)}`).join(' ');
  const areaPath = `${linePath} L ${xAt(points.length - 1)} ${VB_H} L ${xAt(0)} ${VB_H} Z`;

  const gridValues = [max, max * 0.5, min];

  return (
    <View>
      <View className="flex-row">
        {/* Y-axis labels */}
        <View className="mr-2 justify-between" style={{ height: VB_H }}>
          {gridValues.map((v, i) => (
            <Text key={i} className="font-sans text-[10px] text-zinc-500">
              {formatAxisValue(v)}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1, height: VB_H }}>
          <Svg width="100%" height={VB_H} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.35} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {gridValues.map((v, i) => (
              <Line
                key={i}
                x1={0}
                x2={VB_W}
                y1={yAt(v)}
                y2={yAt(v)}
                stroke={t.border}
                strokeWidth={1}
                strokeDasharray="4,4"
              />
            ))}
            <Path d={areaPath} fill="url(#lineFill)" stroke="none" />
            <Path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            <Circle cx={xAt(points.length - 1)} cy={yAt(points[points.length - 1].value)} r={4} fill={color} />
          </Svg>
        </View>
      </View>
      <View className="ml-8 mt-1.5 flex-row justify-between">
        {points.map((p, i) => (
          <Text key={i} className="font-sans text-[10px] text-zinc-500">
            {p.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
