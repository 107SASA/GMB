import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { changePassword, fetchProfile, updateProfile, type Profile } from '@/api/endpoints/account';
import { useAuth } from '@/auth/AuthContext';
import { getPasswordError } from '@/lib/passwordPolicy';
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
  useInfoSheet,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';

function ProfileForm({ initial }: { initial: Profile }) {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();

  const [fullName, setFullName] = useState(initial.fullName);
  const [companyName, setCompanyName] = useState(initial.companyName ?? '');
  const info = useInfoSheet();

  const save = useMutation({
    // phone is never sent — it is the login and can't be changed.
    mutationFn: () => updateProfile({ fullName: fullName.trim(), companyName: companyName.trim() }),
    onSuccess: () => {
      info.show('Saved', 'Profile updated.');
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      // The More tab shows the auth user's name — keep it in sync.
      void refreshUser();
    },
    onError: (err) => info.show('Error', getApiErrorMessage(err, 'Could not save your profile.')),
  });

  return (
    <View>
      <LabeledField label="Full name" value={fullName} onChangeText={setFullName} />
      <LabeledField
        label="Phone (your login — can't be changed)"
        value={initial.phone ?? ''}
        editable={false}
        selectTextOnFocus={false}
      />
      <LabeledField label="Company" value={companyName} onChangeText={setCompanyName} />
      <PrimaryButton
        title="Save profile"
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={!fullName.trim()}
      />
      {info.node}
    </View>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const info = useInfoSheet();

  const change = useMutation({
    mutationFn: () =>
      changePassword({ currentPassword: current, newPassword: next, confirmPassword: confirm }),
    onSuccess: () => {
      info.show('Done', 'Your password has been changed.');
      setCurrent('');
      setNext('');
      setConfirm('');
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not change the password.')),
  });

  function submit() {
    setError('');
    // Same policy the backend now enforces (src/lib/passwordPolicy.ts /
    // mobile mirror below) — this used to only require a digit + a symbol,
    // so a password could pass here and still get rejected server-side.
    const passwordError = getPasswordError(next);
    if (passwordError) {
      setError(passwordError);
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
      {info.node}
    </View>
  );
}

export default function ProfileScreen() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: fetchProfile });
  const data = profile.data;
  // Customers sign in with phone + WhatsApp OTP — there is no password to
  // change. Only GrowwMatics super-admins (web admin login) use a password.
  const { user } = useAuth();
  const usesPassword = user?.role === 'SUPER_ADMIN';

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
            <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-4">
              <View className="flex-row items-center gap-3">
                <View className="h-12 w-12 items-center justify-center rounded-full bg-brand">
                  <Text className="font-sans-bold text-lg text-on-brand">
                    {(data.fullName || data.phone || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="font-sans-semibold text-base text-white">{data.fullName}</Text>
                  {!!data.phone && <Text className="font-sans text-sm text-zinc-400">{data.phone}</Text>}
                  {/* A real email only — never the free-report placeholder. */}
                  {!data.isShadowAccount && !!data.email && (
                    <Text className="font-sans text-xs text-zinc-500">{data.email}</Text>
                  )}
                </View>
                {!data.isShadowAccount && data.isEmailVerified && (
                  <Ionicons name="checkmark-circle" size={18} color="#1db877" />
                )}
              </View>
              <View className="mt-3 flex-row flex-wrap items-center gap-x-4 gap-y-1">
                {!!data.subscriptionPlan && <Badge label={data.subscriptionPlan} tone="info" />}
                {!!data.createdAt && (
                  <Text className="font-sans text-xs text-zinc-500">
                    Member since {formatDateTime(data.createdAt)}
                  </Text>
                )}
                {!!data.lastLoginAt && (
                  <Text className="font-sans text-xs text-zinc-500">
                    Last login {formatDateTime(data.lastLoginAt)}
                  </Text>
                )}
              </View>
            </View>

            <SectionLabel>Edit profile</SectionLabel>
            <ProfileForm key={profile.dataUpdatedAt} initial={data} />

            {usesPassword ? (
              <>
                <SectionLabel>Change password</SectionLabel>
                <PasswordForm />
              </>
            ) : (
              <Text className="mt-6 font-sans text-xs leading-4 text-zinc-500">
                You sign in with your phone number and a one-time code sent on WhatsApp — there is no password to manage.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
