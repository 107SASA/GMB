import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { ErrorText, Field, PrimaryButton, Screen } from '@/components/ui';
import { BRAND_GRADIENT } from '@/lib/theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      // Success: (auth)/_layout redirects to the tabs once isAuthenticated flips.
    } catch (err) {
      setError(getApiErrorMessage(err, 'Login failed. Please try again.'));
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-10"
          keyboardShouldPersistTaps="handled"
        >
          <View className="mb-12 items-center gap-4">
            <LinearGradient
              colors={[...BRAND_GRADIENT]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 72,
                height: 72,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="rocket" size={34} color="#ffffff" />
            </LinearGradient>
            <View className="items-center gap-1">
              <Text className="text-[32px] font-extrabold tracking-tight text-white">
                GMB Boost
              </Text>
              <Text className="text-base text-zinc-400">
                Grow your business, from your pocket
              </Text>
            </View>
          </View>

          <View className="gap-4">
            <Field
              placeholder="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              editable={!submitting}
            />
            <Field
              placeholder="Password"
              secureTextEntry
              autoComplete="password"
              value={password}
              onChangeText={setPassword}
              editable={!submitting}
              onSubmitEditing={handleSubmit}
              returnKeyType="go"
            />
            <ErrorText>{error}</ErrorText>
            <PrimaryButton
              title="Sign in"
              onPress={handleSubmit}
              loading={submitting}
              disabled={!canSubmit}
            />
          </View>

          <Text className="mt-10 text-center text-xs text-zinc-500">
            Accounts are managed on the GMB Boost website.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
