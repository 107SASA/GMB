import { Text, View } from 'react-native';

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
        <Text className="mb-1 text-xs font-bold" style={{ color: t.amber }}>
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
          <Text key={d.label} className="flex-1 text-center text-[10px] text-zinc-500">
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
            <Text className="mb-1 text-sm font-bold" style={{ color: t.amber }}>
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
          <Text key={item.label} className="flex-1 text-center text-xs text-zinc-400">
            {item.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
