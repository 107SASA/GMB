import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchFreeReport, startFreeReport } from '@/api/endpoints/freeReport';
import { useBusiness } from '@/business/BusinessContext';
import { StepBusinessSearch } from '@/components/onboarding/StepBusinessSearch';
import { BottomSheet, ErrorText, PrimaryButton, SecondaryButton } from '@/components/ui';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * The free Google profile report of a Free CRM workspace, at the top of every
 * locked tab (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md):
 *   ready      → score + top 3 fixes + "View full report" (app mode: no prices)
 *   preparing  → spinner, re-checked every 15 s
 *   none       → "Get your free report" (pick the Google listing in the app if needed)
 * STORE COMPLIANCE — no prices, no "upgrade/buy" wording.
 */
export function FreeReportCard() {
  const t = useTheme();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const [picking, setPicking] = useState(false);

  const q = useQuery({
    queryKey: ['free-report', activeBusinessId],
    queryFn: fetchFreeReport,
    enabled: !!activeBusinessId,
    refetchInterval: (query) => (query.state.data?.report?.status === 'preparing' ? 15_000 : false),
  });

  const start = useMutation({
    mutationFn: (placeId?: string) => startFreeReport(placeId),
    onSuccess: () => {
      setPicking(false);
      void queryClient.invalidateQueries({ queryKey: ['free-report', activeBusinessId] });
    },
  });

  const card = {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
    padding: 16,
    gap: 10,
    alignSelf: 'stretch' as const,
  };

  if (q.isPending) {
    return (
      <View style={card}>
        <ActivityIndicator />
      </View>
    );
  }
  const data = q.data;
  const report = data?.report ?? null;

  if (report?.status === 'ready') {
    return (
      <View style={card}>
        <Text className="font-sans-semibold text-xs uppercase tracking-wider text-zinc-500">Your free Google profile report</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
          <Text className="font-display-bold text-white" style={{ fontSize: 40, lineHeight: 44 }}>
            {report.score ?? '—'}
          </Text>
          <Text className="mb-1 font-sans text-base text-zinc-400">/ 100</Text>
        </View>
        {report.topFixes.length > 0 && (
          <View style={{ gap: 6 }}>
            <Text className="font-sans-semibold text-sm text-zinc-300">Fix these first</Text>
            {report.topFixes.map((fix) => (
              <View key={fix} style={{ flexDirection: 'row', gap: 8 }}>
                <Ionicons name="alert-circle-outline" size={16} color="#fbbf24" style={{ marginTop: 2 }} />
                <Text className="flex-1 font-sans text-sm text-zinc-300">{fix}</Text>
              </View>
            ))}
          </View>
        )}
        {!!report.reportUrl && (
          <SecondaryButton title="View full report" onPress={() => void WebBrowser.openBrowserAsync(report.reportUrl!)} />
        )}
      </View>
    );
  }

  if (report?.status === 'preparing') {
    return (
      <View style={[card, { flexDirection: 'row', alignItems: 'center' }]}>
        <ActivityIndicator />
        <Text className="flex-1 font-sans text-sm text-zinc-300">
          Your free Google profile report is being prepared — it usually takes a minute.
        </Text>
      </View>
    );
  }

  // No report yet, or the last one failed.
  return (
    <View style={[card, { borderColor: withAlpha(t.brand, 0.5), backgroundColor: withAlpha(t.brand, 0.08) }]}>
      <Text className="font-sans-semibold text-base text-white">Get your free Google profile report</Text>
      <Text className="font-sans text-sm text-zinc-400">
        {report?.status === 'failed'
          ? "We couldn't finish your last report. Try again."
          : 'See how your business shows up on Google and what to fix first.'}
      </Text>
      <ErrorText>{start.error ? getApiErrorMessage(start.error, 'Could not start the report.') : null}</ErrorText>
      <PrimaryButton
        title={data?.hasListing ? 'Get my free report' : 'Find my business on Google'}
        loading={start.isPending}
        onPress={() => (data?.hasListing ? start.mutate(undefined) : setPicking(true))}
      />

      <BottomSheet visible={picking} onClose={() => setPicking(false)}>
        <Text className="font-display-bold text-lg" style={{ color: t.text }}>Find your business</Text>
        <Text className="mb-3 mt-1 font-sans text-sm" style={{ color: t.textDim }}>
          Pick your listing — we'll prepare the report in the background.
        </Text>
        {start.isPending ? <ActivityIndicator /> : <StepBusinessSearch onSelected={(placeId) => start.mutate(placeId)} />}
        <ErrorText>{start.error ? getApiErrorMessage(start.error, 'Could not start the report.') : null}</ErrorText>
      </BottomSheet>
    </View>
  );
}
