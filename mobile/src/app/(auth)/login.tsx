import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { ErrorText, Field, PrimaryButton, Screen } from '@/components/ui';
import { BRAND_GRADIENT } from '@/lib/theme';

type PhoneStep = 'enter-phone' | 'enter-otp';

// Phone + WhatsApp OTP is the only login method — matches the web app's
// /login exactly (Aug 2026: web dropped email/password from its
// customer-facing login the same way). This used to also offer an Email tab
// (a SegmentedControl toggle, defaulting to Email) — removed per that same
// decision. The backend's email/password endpoint (AuthContext's `login`)
// is untouched and still used elsewhere (e.g. admin login on the website) —
// this only removes the customer-facing mobile UI for it.
export default function LoginScreen() {
  const { requestPhoneOtp, loginWithPhone } = useAuth();

  const [phoneStep, setPhoneStep] = useState<PhoneStep>('enter-phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedPhone, setMaskedPhone] = useState<string | undefined>();
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);

  async function handleRequestOtp() {
    if (!phone.trim() || phoneSubmitting) return;
    setPhoneSubmitting(true);
    setPhoneError(null);
    try {
      const { maskedPhone: masked } = await requestPhoneOtp(phone.trim());
      setMaskedPhone(masked);
      setPhoneStep('enter-otp');
    } catch (err) {
      setPhoneError(getApiErrorMessage(err, 'Could not send code. Please try again.'));
    } finally {
      setPhoneSubmitting(false);
    }
  }

  async function handleVerifyOtp() {
    if (otp.length !== 6 || phoneSubmitting) return;
    setPhoneSubmitting(true);
    setPhoneError(null);
    try {
      await loginWithPhone(phone.trim(), otp);
      // Success: (auth)/_layout redirects to the tabs once isAuthenticated flips.
    } catch (err) {
      setPhoneError(getApiErrorMessage(err, 'Incorrect or expired code.'));
      setPhoneSubmitting(false);
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
          <View className="mb-10 items-center gap-4">
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
                transform: [{ rotate: '-8deg' }],
              }}
            >
              <Ionicons name="rocket" size={34} color="#ffffff" style={{ transform: [{ rotate: '8deg' }] }} />
            </LinearGradient>
            <View className="items-center gap-1">
              <Text className="font-display text-[32px] tracking-tight text-white">
                GrowwMatics AI
              </Text>
              <Text className="font-sans text-base text-zinc-400">
                Grow your business, from your pocket
              </Text>
            </View>
          </View>

          {phoneStep === 'enter-phone' ? (
            <View className="gap-4 px-5">
              <Field
                placeholder="+919876543210"
                autoCapitalize="none"
                autoComplete="tel"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
                editable={!phoneSubmitting}
                onSubmitEditing={handleRequestOtp}
                returnKeyType="go"
              />
              <Text className="px-1 font-sans text-xs text-zinc-500">
                We&apos;ll send a one-time code to this number on WhatsApp.
              </Text>
              <ErrorText>{phoneError}</ErrorText>
              <PrimaryButton
                title="Send code on WhatsApp"
                onPress={handleRequestOtp}
                loading={phoneSubmitting}
                disabled={!phone.trim()}
              />
            </View>
          ) : (
            <View className="gap-4 px-5">
              <Field
                placeholder="······"
                keyboardType="number-pad"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChangeText={(v) => setOtp(v.replace(/\D/g, ''))}
                editable={!phoneSubmitting}
                onSubmitEditing={handleVerifyOtp}
                returnKeyType="go"
                style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8 }}
              />
              <Text className="px-1 font-sans text-xs text-zinc-500">
                Sent to {maskedPhone ?? phone} on WhatsApp.{' '}
                <Text className="font-sans-semibold text-brand-bright" onPress={() => setPhoneStep('enter-phone')}>
                  Wrong number?
                </Text>
              </Text>
              <ErrorText>{phoneError}</ErrorText>
              <PrimaryButton
                title="Verify & sign in"
                onPress={handleVerifyOtp}
                loading={phoneSubmitting}
                disabled={otp.length !== 6}
              />
              <Pressable
                onPress={handleRequestOtp}
                disabled={phoneSubmitting}
                style={{ alignItems: 'center', paddingVertical: 4 }}
              >
                <Text className="font-sans-semibold text-sm text-brand-bright">Didn&apos;t get a code? Resend</Text>
              </Pressable>
            </View>
          )}

          <Text className="mt-10 text-center font-sans text-xs text-zinc-500">
            Accounts are managed on the GrowwMatics AI website.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
