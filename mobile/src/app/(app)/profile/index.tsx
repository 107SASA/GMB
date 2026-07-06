import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { changePassword, fetchProfile, updateProfile, type Profile } from '@/api/endpoints/account';
import { useAuth } from '@/auth/AuthContext';
import {
  Badge,
  EmptyState,
  ErrorText,
  LabeledField,
  PrimaryButton,
  Screen,
  ScreenTitle,
  SectionLabel,
  Skeleton,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';

function ProfileForm({ initial }: { initial: Profile }) {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();

  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [companyName, setCompanyName] = useState(initial.companyName ?? '');

  const save = useMutation({
    mutationFn: () => updateProfile({ fullName: fullName.trim(), phone: phone.trim(), companyName: companyName.trim() }),
    onSuccess: () => {
      Alert.alert('Saved', 'Profile updated.');
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      // The More tab shows the auth user's name — keep it in sync.
      void refreshUser();
    },
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not save your profile.')),
  });

  return (
    <View>
      <LabeledField label="Full name" value={fullName} onChangeText={setFullName} />
      <LabeledField
        label="Phone (with country code)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="+91…"
      />
      <LabeledField label="Company" value={companyName} onChangeText={setCompanyName} />
      <PrimaryButton
        title="Save profile"
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={!fullName.trim()}
      />
    </View>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const change = useMutation({
    mutationFn: () =>
      changePassword({ currentPassword: current, newPassword: next, confirmPassword: confirm }),
    onSuccess: () => {
      Alert.alert('Done', 'Your password has been changed.');
      setCurrent('');
      setNext('');
      setConfirm('');
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not change the password.')),
  });

  function submit() {
    setError('');
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (!/\d/.test(next) || !/[^A-Za-z0-9]/.test(next)) {
      setError('New password needs at least one number and one symbol.');
      return;
    }
    if (next !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    change.mutate();
  }

  return (
    <View>
      <LabeledField
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoCapitalize="none"
      />
      <LabeledField
        label="New password"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoCapitalize="none"
      />
      <LabeledField
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
      />
      {!!error && (
        <View className="mb-3">
          <ErrorText>{error}</ErrorText>
        </View>
      )}
      <PrimaryButton
        title="Change password"
        onPress={submit}
        loading={change.isPending}
        disabled={!current || !next || !confirm}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: fetchProfile });
  const data = profile.data;

  return (
    <Screen>
      <ScreenTitle>Profile</ScreenTitle>
      <ScrollView contentContainerClassName="px-5 pb-12" keyboardShouldPersistTaps="handled">
        {profile.isLoading ? (
          <Skeleton className="h-40" />
        ) : profile.isError || !data ? (
          <EmptyState
            title="Couldn't load your profile"
            hint={getApiErrorMessage(profile.error, 'Try again.')}
          />
        ) : (
          <>
            <View className="rounded-xl border border-surface-border bg-surface-raised px-4 py-4">
              <View className="flex-row items-center gap-3">
                <View className="h-12 w-12 items-center justify-center rounded-full bg-brand">
                  <Text className="text-lg font-bold text-on-brand">
                    {(data.fullName || data.email).charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-white">{data.fullName}</Text>
                  <Text className="text-sm text-zinc-400">{data.email}</Text>
                </View>
                {data.isEmailVerified && (
                  <Ionicons name="checkmark-circle" size={18} color="#34d399" />
                )}
              </View>
              <View className="mt-3 flex-row flex-wrap items-center gap-x-4 gap-y-1">
                {!!data.subscriptionPlan && <Badge label={data.subscriptionPlan} tone="info" />}
                {!!data.createdAt && (
                  <Text className="text-xs text-zinc-500">
                    Member since {formatDateTime(data.createdAt)}
                  </Text>
                )}
                {!!data.lastLoginAt && (
                  <Text className="text-xs text-zinc-500">
                    Last login {formatDateTime(data.lastLoginAt)}
                  </Text>
                )}
              </View>
            </View>

            <SectionLabel>Edit profile</SectionLabel>
            <ProfileForm key={profile.dataUpdatedAt} initial={data} />

            <SectionLabel>Change password</SectionLabel>
            <PasswordForm />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
