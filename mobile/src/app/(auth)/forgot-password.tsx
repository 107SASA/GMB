import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { requestPasswordResetOtp, resetPassword, verifyResetOtp } from '@/api/endpoints/auth';
import { ErrorText, Field, PrimaryButton, Screen } from '@/components/ui';
import { useTheme } from '@/lib/theme';

const RESEND_COOLDOWN_SECONDS = 60;

type Step = 'email' | 'otp' | 'newPassword' | 'done';

/** Mirrors the server's rule in services/auth/security.ts exactly, so a
 * password that passes here never gets rejected on submit. */
function passwordError(value: string): string | null {
  if (value.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Z]/.test(value)) return 'Password must contain an uppercase letter.';
  if (!/[a-z]/.test(value)) return 'Password must contain a lowercase letter.';
  if (!/[0-9]/.test(value)) return 'Password must contain a number.';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) return 'Password must contain a special character.';
  return null;
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const t = useTheme();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (cooldown <= 0) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [cooldown > 0]);

  async function sendOtp() {
    setSubmitting(true);
    setError(null);
    try {
      await requestPasswordResetOtp(email.trim());
      setStep('otp');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not send the code. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode() {
    setSubmitting(true);
    setError(null);
    try {
      const token = await verifyResetOtp(email.trim(), otp.trim());
      setResetToken(token);
      setStep('newPassword');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Invalid or expired code.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitNewPassword() {
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    const pwError = passwordError(newPassword);
    if (pwError) {
      setError(pwError);
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword({ resetToken, newPassword, confirmPassword });
      setStep('done');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not reset your password. Please start again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-10"
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            onPress={() => (step === 'email' ? router.back() : setStep('email'))}
            hitSlop={12}
            className="mb-8 h-9 w-9 items-center justify-center rounded-full bg-surface-raised active:bg-surface-overlay"
          >
            <Ionicons name="arrow-back" size={18} color={t.text} />
          </Pressable>

          {step === 'email' && (
            <View className="gap-4">
              <Text className="font-display text-2xl text-white">Reset your password</Text>
              <Text className="mb-2 font-sans text-sm text-zinc-400">
                Enter the email on your account and we'll send you a code.
              </Text>
              <Field
                placeholder="Email"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                editable={!submitting}
                onSubmitEditing={sendOtp}
                returnKeyType="go"
              />
              <ErrorText>{error}</ErrorText>
              <PrimaryButton
                title="Send code"
                onPress={sendOtp}
                loading={submitting}
                disabled={email.trim().length === 0}
              />
            </View>
          )}

          {step === 'otp' && (
            <View className="gap-4">
              <Text className="font-display text-2xl text-white">Enter the code</Text>
              <Text className="mb-2 font-sans text-sm text-zinc-400">
                We sent a 6-digit code to {email}. It expires in 10 minutes.
              </Text>
              <Field
                placeholder="6-digit code"
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={setOtp}
                editable={!submitting}
                onSubmitEditing={verifyCode}
                returnKeyType="go"
              />
              <ErrorText>{error}</ErrorText>
              <PrimaryButton
                title="Verify code"
                onPress={verifyCode}
                loading={submitting}
                disabled={otp.trim().length !== 6}
              />
              <Pressable
                onPress={() => cooldown === 0 && void sendOtp()}
                disabled={cooldown > 0 || submitting}
                className="items-center py-2"
              >
                <Text className={`font-sans-semibold text-sm ${cooldown > 0 ? 'text-zinc-500' : 'text-brand-bright'}`}>
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </Text>
              </Pressable>
            </View>
          )}

          {step === 'newPassword' && (
            <View className="gap-4">
              <Text className="font-display text-2xl text-white">Create a new password</Text>
              <Text className="mb-2 font-sans text-sm text-zinc-400">
                Choose a strong password you haven't used before.
              </Text>
              <Field
                placeholder="New password"
                secureTextEntry
                autoCapitalize="none"
                value={newPassword}
                onChangeText={setNewPassword}
                editable={!submitting}
              />
              <Field
                placeholder="Confirm new password"
                secureTextEntry
                autoCapitalize="none"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                editable={!submitting}
                onSubmitEditing={submitNewPassword}
                returnKeyType="go"
              />
              <ErrorText>{error}</ErrorText>
              <PrimaryButton
                title="Reset password"
                onPress={submitNewPassword}
                loading={submitting}
                disabled={!newPassword || !confirmPassword}
              />
            </View>
          )}

          {step === 'done' && (
            <View className="items-center gap-4">
              <View className="h-14 w-14 items-center justify-center rounded-full bg-secondary-container">
                <Ionicons name="checkmark-circle" size={30} color={t.emerald} />
              </View>
              <Text className="font-display text-2xl text-white">Password reset</Text>
              <Text className="text-center font-sans text-sm text-zinc-400">
                Your password has been changed. Sign in with your new password.
              </Text>
              <View className="mt-2 w-full">
                <PrimaryButton title="Back to sign in" onPress={() => router.replace('/login')} />
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
