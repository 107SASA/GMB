import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { createAudit } from '@/api/endpoints/audit';
import { PlanLimitError } from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { ErrorText, LabeledField, PrimaryButton, Screen, ScreenTitle } from '@/components/ui';

export default function RunAuditScreen() {
  const { activeBusiness, activeBusinessId } = useBusiness();
  const router = useRouter();

  const [category, setCategory] = useState(activeBusiness?.category ?? '');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');

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
        <ScrollView contentContainerClassName="px-5 pb-10" keyboardShouldPersistTaps="handled">
          <View className="mb-4 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
            <Text className="text-base font-semibold text-white">{activeBusiness?.name}</Text>
            {!!activeBusiness?.address && (
              <Text className="mt-0.5 text-sm text-zinc-400">{activeBusiness.address}</Text>
            )}
          </View>

          <LabeledField
            label="Business category"
            value={category}
            onChangeText={setCategory}
            placeholder="e.g. Dental clinic"
          />
          <LabeledField
            label="City (optional override)"
            value={city}
            onChangeText={setCity}
            placeholder="Detected from the business profile if left blank"
          />

          <Text className="mb-4 px-1 text-xs text-zinc-500">
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
      </KeyboardAvoidingView>
    </Screen>
  );
}
