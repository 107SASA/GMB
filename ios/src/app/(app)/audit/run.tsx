import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { createAudit } from '@/api/endpoints/audit';
import { fetchBusinessDetail } from '@/api/endpoints/account';
import { PlanLimitError } from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { EmptyState, ErrorText, LabeledField, PrimaryButton, Screen, ScreenTitle, Skeleton } from '@/components/ui';
import { promptConnectGoogle } from '@/lib/connectGoogle';

export default function RunAuditScreen() {
  const { activeBusiness, activeBusinessId } = useBusiness();
  const router = useRouter();

  const [category, setCategory] = useState(activeBusiness?.category ?? '');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');

  // Repeat audits need a live GBP connection for real ranking/review/profile
  // data — gate this manual "Run New Audit" screen the same way the web
  // dashboard does. (The automatic first free audit right after signup is
  // deliberately NOT gated on either platform — Google-connect is an
  // optional onboarding step.)
  const businessDetail = useQuery({
    queryKey: ['business-detail', activeBusinessId],
    queryFn: fetchBusinessDetail,
    enabled: !!activeBusinessId,
  });

  const run = useMutation({
    mutationFn: () =>
      createAudit({
        businessId: activeBusinessId!,
        categoryOverride: category.trim() || undefined,
        cityOverride: city.trim() || undefined,
      }),
    onSuccess: (auditId) => {
      // Replace so back from the results returns to the audit list.
      router.replace(`/audit/${auditId}`);
    },
    onError: (err) => {
      setError(
        err instanceof PlanLimitError
          ? err.message
          : getApiErrorMessage(err, 'Could not start the audit. Try again.')
      );
    },
  });

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScreenTitle>Run New Audit</ScreenTitle>
        {businessDetail.isLoading ? (
          <View className="gap-3 px-5">
            <Skeleton className="h-14" />
            <Skeleton className="h-40" />
          </View>
        ) : businessDetail.data && !businessDetail.data.googleConnected ? (
          <View className="px-5">
            <EmptyState
              title="Connect Google Business Profile first"
              hint="Running a new audit needs a live Google Business Profile connection — without it, the report can't pull real ranking, review, or profile data."
              action={
                <PrimaryButton
                  title="Connect Google Business Profile"
                  onPress={() =>
                    promptConnectGoogle('Connect your Google Business Profile to run a new audit.')
                  }
                />
              }
            />
          </View>
        ) : (
          <ScrollView contentContainerClassName="px-5 pb-10" keyboardShouldPersistTaps="handled">
            <View className="mb-4 rounded-card border border-surface-border bg-surface-raised px-4 py-3.5">
              <Text className="font-sans-semibold text-base text-white">{activeBusiness?.name}</Text>
              {!!activeBusiness?.address && (
                <Text className="mt-0.5 font-sans text-sm text-zinc-400">
                  {activeBusiness.address}
                </Text>
              )}
            </View>

            <LabeledField
              label="Business category"
              value={category}
              onChangeText={setCategory}
              placeholder="e.g. Restaurant"
            />
            <LabeledField
              label="City (optional override)"
              value={city}
              onChangeText={setCity}
              placeholder="Detected from the business profile if left blank"
            />

            <Text className="mb-4 px-1 font-sans text-xs text-zinc-500">
              The audit checks your Google ranking, profile completeness, SEO and reviews against
              nearby competitors. It runs in the background and usually takes a couple of minutes.
            </Text>

            {!!error && (
              <View className="mb-3">
                <ErrorText>{error}</ErrorText>
              </View>
            )}

            <PrimaryButton
              title="Start audit"
              onPress={() => {
                setError('');
                run.mutate();
              }}
              loading={run.isPending}
              disabled={!category.trim() || !activeBusinessId}
            />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
