import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import type { KeywordRow, KeywordTone } from '@/api/endpoints/keywords';
import { Card } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * One keyword as a phone card — shared by the Keywords screen and the
 * Performance tab's "Target keywords". Every value is the server's measured
 * label (/api/keywords), so the app shows exactly what the website shows.
 */

const BADGE_TONE: Record<KeywordTone, 'positive' | 'warning' | 'negative' | 'neutral'> = {
  good: 'positive',
  warn: 'warning',
  bad: 'negative',
  neutral: 'neutral',
};

function Pill({ label, tone }: { label: string; tone: 'positive' | 'warning' | 'negative' | 'neutral' | 'info' }) {
  const tones = {
    neutral: 'bg-surface-overlay text-zinc-300',
    positive: 'bg-secondary-container text-on-secondary-container',
    negative: 'bg-error-container text-on-error-container',
    warning: 'bg-warning-container text-on-warning-container',
    info: 'bg-indigo-500/15 text-indigo-300',
  } as const;
  const [bg, text] = tones[tone].split(' ');
  return (
    <View className={`self-start rounded-full px-2.5 py-1 ${bg}`}>
      <Text className={`font-sans-semibold text-[11px] ${text}`}>{label}</Text>
    </View>
  );
}

function Trend({ value }: { value: number | null }) {
  const t = useTheme();
  if (value == null || Math.round(value) === 0) return <Text className="font-sans text-xs text-zinc-500">no change</Text>;
  const up = value > 0;
  return (
    <View className="flex-row items-center gap-0.5">
      <Ionicons name={up ? 'arrow-up' : 'arrow-down'} size={12} color={up ? t.emerald : t.rose} />
      <Text className="font-sans-semibold text-xs" style={{ color: up ? t.emerald : t.rose }}>
        {Math.abs(Math.round(value))}
      </Text>
    </View>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <View className="flex-1 gap-0.5">
      <Text className="font-sans text-[11px] uppercase tracking-[0.6px] text-zinc-500">{label}</Text>
      <Text className="font-display-bold text-base text-white">{value}</Text>
      {!!note && <Text className="font-sans text-[11px] leading-4 text-zinc-500" numberOfLines={2}>{note}</Text>}
    </View>
  );
}

/** One keyword as a card: name + badges, then searches / rank / trend, then #1 and the reason. */
export function KeywordCard({
  row,
  showRole,
  onPin,
  pinning,
}: {
  row: KeywordRow;
  showRole: boolean;
  onPin?: (row: KeywordRow) => void;
  pinning?: boolean;
}) {
  const t = useTheme();
  return (
    <Card className="gap-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1.5">
          <Text className="font-sans-semibold text-[15px] text-white">{row.keyword}</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {showRole && row.role !== 'owner' && <Pill label={row.roleLabel} tone="info" />}
            {!showRole && row.owner && <Pill label="Yours" tone="neutral" />}
            {row.pinned && <Pill label="Pinned" tone="positive" />}
            <Pill label={row.verdictLabel} tone={BADGE_TONE[row.tone]} />
          </View>
        </View>
        {onPin && row.role !== 'pending' && (
          <Pressable
            onPress={() => onPin(row)}
            disabled={pinning}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={row.pinned ? `Unpin ${row.keyword}` : `Pin ${row.keyword}`}
            style={{ minHeight: 32, justifyContent: 'center' }}
          >
            {pinning ? (
              <ActivityIndicator size="small" color={t.brandBright} />
            ) : (
              <Ionicons name={row.pinned ? 'pin' : 'pin-outline'} size={20} color={row.pinned ? t.brandBright : t.textDim} />
            )}
          </Pressable>
        )}
      </View>

      <View className="flex-row gap-3">
        <Stat label="Searches" value={row.volumeText} note={row.volumeNote} />
        <Stat label="Your rank" value={row.rankText} />
        <View className="gap-0.5">
          <Text className="font-sans text-[11px] uppercase tracking-[0.6px] text-zinc-500">Trend</Text>
          <Trend value={row.trend} />
        </View>
      </View>

      {row.topCompetitor && (
        <Text className="font-sans text-xs text-zinc-400">
          #1 on Google: <Text className="font-sans-semibold text-zinc-300">{row.topCompetitor.name}</Text>
          {row.topCompetitor.rank ? ` (#${row.topCompetitor.rank})` : ''}
        </Text>
      )}
      {!!row.reason && <Text className="font-sans text-xs leading-5 text-zinc-400">{row.reason}</Text>}
    </Card>
  );
}

