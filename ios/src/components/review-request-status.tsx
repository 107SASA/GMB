import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { fetchReviewRequests } from '@/api/endpoints/review-requests';
import { useBusiness } from '@/business/BusinessContext';
import { Skeleton } from '@/components/ui';

const METRICS: { key: 'reviewRequests' | 'delivered' | 'read' | 'clicked' | 'failed'; label: string }[] = [
  { key: 'reviewRequests', label: 'Requests' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'read', label: 'Read' },
  { key: 'clicked', label: 'Clicked' },
  { key: 'failed', label: 'Failed' },
];

/**
 * WhatsApp review-request status for the active business. Reads the same
 * /api/review-requests payload as the web dashboard. A failure is shown as
 * "Unable to deliver" — the API does not send provider error text.
 */
export function ReviewRequestStatus() {
  const { activeBusinessId } = useBusiness();
  const query = useQuery({
    queryKey: ['review-requests', activeBusinessId],
    queryFn: fetchReviewRequests,
    enabled: !!activeBusinessId,
  });

  if (query.isLoading) return <Skeleton className="mt-4 h-28 rounded-card" />;
  if (!query.data?.success) return null;
  const { metrics, recent } = query.data;

  return (
    <View className="mt-4 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
      <Text className="font-display-bold text-base text-white">WhatsApp review requests</Text>
      <View className="mt-3 flex-row flex-wrap gap-2">
        {METRICS.map((metric) => (
          <View key={metric.key} className="min-w-[30%] flex-1 rounded-2xl bg-surface px-3 py-2">
            <Text className="font-sans text-xs text-zinc-400">{metric.label}</Text>
            <Text className="font-display text-lg text-white">{metrics[metric.key]}</Text>
          </View>
        ))}
      </View>
      {recent.slice(0, 5).map((item, index) => (
        <View key={`${item.customerName}-${index}`} className="mt-3 border-t border-surface-border pt-3">
          <Text className="font-sans-semibold text-sm text-white">{item.customerName}</Text>
          <Text className="mt-0.5 font-sans text-xs text-zinc-400">
            {item.statusLabel === 'Failed' ? 'Unable to deliver' : item.statusLabel}
            {' · '}
            {item.followUpLabel}
          </Text>
        </View>
      ))}
    </View>
  );
}
