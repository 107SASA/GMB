import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import type { Review } from '@/api/endpoints/reviews';
import { useTheme } from '@/lib/theme';

export function sentimentTone(
  sentiment: string | null
): 'positive' | 'negative' | 'warning' | 'neutral' {
  switch (sentiment) {
    case 'positive':
      return 'positive';
    case 'negative':
    case 'critical':
      return 'negative';
    case 'neutral':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function replyStatusBadge(status: Review['replyStatus']): {
  label: string;
  tone: 'positive' | 'negative' | 'warning' | 'info' | 'neutral';
} {
  switch (status) {
    case 'POSTED':
      return { label: 'Replied', tone: 'positive' };
    case 'APPROVED':
      return { label: 'Approved', tone: 'info' };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'negative' };
    case 'FAILED':
      return { label: 'Failed', tone: 'negative' };
    default:
      return { label: 'Needs reply', tone: 'warning' };
  }
}

export function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  const t = useTheme();
  return (
    <View className="flex-row gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons
          key={i}
          name={i <= rating ? 'star' : 'star-outline'}
          size={size}
          color={i <= rating ? '#ffb300' : t.border}
        />
      ))}
    </View>
  );
}
