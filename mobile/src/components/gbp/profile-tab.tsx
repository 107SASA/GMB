import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchGbpProfile, GbpNotConnectedError, updateGbpProfile } from '@/api/endpoints/gbp';
import { useBusiness } from '@/business/BusinessContext';
import { EmptyState, LabeledField, PrimaryButton, Skeleton } from '@/components/ui';
import { promptConnectGoogle } from '@/lib/connectGoogle';

/**
 * Editable slice of the LIVE Google Business Profile (name, description,
 * phone, website) — mirrors src/app/dashboard/gbp-profile/page.tsx on the
 * web. Edits always save to our Business doc; they only push to Google once
 * GBP_LIVE_WRITES_ENABLED is on (until the write scope is verified).
 */
export function GbpProfileTab() {
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();

  const profile = useQuery({
    queryKey: ['gbp-profile', activeBusinessId],
    queryFn: fetchGbpProfile,
    enabled: !!activeBusinessId,
    retry: false,
  });

  const [form, setForm] = useState({ title: '', description: '', primaryPhone: '', website: '' });

  useEffect(() => {
    if (profile.data) {
      setForm({
        title: profile.data.profile.title,
        description: profile.data.profile.description,
        primaryPhone: profile.data.profile.primaryPhone,
        website: profile.data.profile.website,
      });
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => updateGbpProfile(form),
    onSuccess: ({ liveWriteApplied }) => {
      void queryClient.invalidateQueries({ queryKey: ['gbp-profile', activeBusinessId] });
      Alert.alert(
        'Saved',
        liveWriteApplied
          ? 'Saved and published to Google.'
          : "Saved. Changes publish to Google automatically once profile verification is enabled."
      );
    },
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not save your profile.')),
  });

  const notConnected = profile.error instanceof GbpNotConnectedError;

  if (profile.isLoading) {
    return (
      <View className="gap-3 px-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-24" />
      </View>
    );
  }

  if (notConnected) {
    return (
      <View className="px-4">
        <EmptyState
          title="Google Business Profile not connected"
          hint={profile.error?.message}
          action={
            <PrimaryButton
              title="Connect Google"
              onPress={() =>
                promptConnectGoogle(profile.error?.message ?? 'Connect your Google Business Profile to edit it.')
              }
            />
          }
        />
      </View>
    );
  }

  if (profile.isError || !profile.data) {
    return (
      <View className="px-4">
        <EmptyState
          title="Couldn't load your profile"
          hint={getApiErrorMessage(profile.error, 'Pull down to retry.')}
        />
      </View>
    );
  }

  const { profile: p, liveWritesEnabled } = profile.data;

  return (
    <View className="px-4">
      {!liveWritesEnabled && (
        <View className="mb-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-2.5">
          <Text className="text-xs leading-4 text-amber-300">
            Edits are saved but won't appear on Google yet — live publishing is temporarily paused.
          </Text>
        </View>
      )}

      {/* Read-only, Google-verified fields */}
      <View className="mb-4 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
        <Text className="text-base font-semibold text-white">{p.locationName || 'Your business'}</Text>
        {!!p.primaryCategory && <Text className="mt-0.5 text-xs text-zinc-500">{p.primaryCategory}</Text>}
        {!!p.address && <Text className="mt-1 text-xs text-zinc-400">{p.address}</Text>}
        <Text className="mt-2 text-[11px] text-zinc-500">
          Category and address are managed on Google directly and can't be edited here.
        </Text>
      </View>

      <LabeledField
        label="Business name"
        value={form.title}
        onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
      />
      <LabeledField
        label="Description"
        value={form.description}
        onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
        multiline
        numberOfLines={4}
        style={{ minHeight: 96, textAlignVertical: 'top' }}
        maxLength={750}
      />
      <LabeledField
        label="Phone"
        value={form.primaryPhone}
        onChangeText={(v) => setForm((f) => ({ ...f, primaryPhone: v }))}
        keyboardType="phone-pad"
      />
      <LabeledField
        label="Website"
        value={form.website}
        onChangeText={(v) => setForm((f) => ({ ...f, website: v }))}
        autoCapitalize="none"
        keyboardType="url"
      />

      <View className="mt-2 pb-8">
        <PrimaryButton
          title="Save profile"
          onPress={() => save.mutate()}
          loading={save.isPending}
          disabled={!form.title.trim()}
        />
      </View>
    </View>
  );
}
