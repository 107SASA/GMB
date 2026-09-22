import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { createWorkspace, type PlaceDetails } from '@/api/endpoints/onboarding';
import { ErrorText, LabeledField, PrimaryButton, SecondaryButton } from '@/components/ui';

interface Props {
  placeId: string;
  details: PlaceDetails;
  onBack: () => void;
  onCreated: (businessId: string) => void | Promise<void>;
}

const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

/**
 * Review/edit what Google returned, then create the workspace
 * (POST /api/business/add-workspace). The richer marketing profile — category,
 * services, keywords — is collected on the next step (the intake form), so
 * this screen only needs the fields add-workspace requires plus the location
 * details worth confirming while they're fresh.
 */
export function StepBusinessConfirm({ placeId, details, onBack, onCreated }: Props) {
  const [form, setForm] = useState({
    businessName: details.name ?? '',
    city: details.city ?? '',
    area: details.area ?? '',
    state: details.state ?? '',
    country: details.country ?? '',
    phone: details.phoneNumber ?? '',
    website: details.website ?? '',
    address: details.formattedAddress ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      createWorkspace({
        businessName: form.businessName.trim(),
        // add-workspace requires a category; the real one is set on the next
        // step. 'Local Business' is the same placeholder /api/onboarding uses.
        category: details.primaryCategory || 'Local Business',
        city: form.city.trim(),
        area: form.area.trim() || undefined,
        state: form.state.trim() || undefined,
        country: form.country.trim() || undefined,
        phone: form.phone.trim() || undefined,
        website: form.website.trim() || undefined,
        address: form.address.trim() || undefined,
        description: details.editorialSummary || undefined,
        googlePlaceId: placeId,
        googleMapsUrl: details.googleMapsUrl || undefined,
        latitude: details.latitude,
        longitude: details.longitude,
      }),
    onSuccess: (businessId) => onCreated(businessId),
    onError: (err) => setError(getApiErrorMessage(err, 'Could not create your workspace.')),
  });

  function submit() {
    setError(null);
    if (!form.businessName.trim()) return setError('Please enter your business name.');
    if (!form.city.trim()) return setError('Please enter your city.');
    if (form.phone.trim() && !PHONE_RE.test(form.phone.replace(/[\s-]/g, ''))) {
      return setError('Enter the phone number in international format, e.g. +14155550100.');
    }
    create.mutate();
  }

  return (
    <ScrollView contentContainerClassName="px-5 pb-16 pt-2" keyboardShouldPersistTaps="handled">
      <Text className="mb-1 font-display-bold text-lg text-white">Confirm your details</Text>
      <Text className="mb-5 font-sans text-sm leading-5 text-zinc-400">
        Review what we found and fix anything that&apos;s off.
      </Text>

      <LabeledField label="Business name" value={form.businessName} onChangeText={set('businessName')} />
      <LabeledField label="City" value={form.city} onChangeText={set('city')} />
      <LabeledField label="Area / locality" value={form.area} onChangeText={set('area')} />
      <LabeledField label="State" value={form.state} onChangeText={set('state')} />
      <LabeledField label="Country" value={form.country} onChangeText={set('country')} />
      <LabeledField
        label="Phone"
        value={form.phone}
        onChangeText={set('phone')}
        keyboardType="phone-pad"
        placeholder="+91…"
      />
      <LabeledField
        label="Website"
        value={form.website}
        onChangeText={set('website')}
        autoCapitalize="none"
        keyboardType="url"
      />
      <LabeledField label="Full address" value={form.address} onChangeText={set('address')} />

      <ErrorText>{error}</ErrorText>

      <View className="mt-4 gap-3">
        <PrimaryButton
          title="Create workspace"
          onPress={submit}
          loading={create.isPending}
          disabled={!form.businessName.trim() || !form.city.trim()}
        />
        <SecondaryButton title="Back to search" onPress={onBack} disabled={create.isPending} />
      </View>
    </ScrollView>
  );
}
