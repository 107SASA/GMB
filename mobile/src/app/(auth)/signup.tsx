import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import type { PlaceDetails } from '@/api/endpoints/onboarding';
import { useAuth } from '@/auth/AuthContext';
import { StepBusinessSearch } from '@/components/onboarding/StepBusinessSearch';
import { PhoneNumberField } from '@/components/phone-number-field';
import { BackChevron, ErrorText, Field, PrimaryButton, Screen } from '@/components/ui';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * Create a free account (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md):
 * name → business (Google listing, or skip and type it) → WhatsApp number → code.
 * The free account opens the CRM + visiting-card scan; the other tabs are
 * locked and show the free Google profile report, generated in the
 * background when a listing was picked. A number that already has an
 * account is simply signed in.
 *
 * STORE COMPLIANCE — no prices, no "upgrade/buy" wording on this screen.
 */

type Step = 'name' | 'business' | 'phone' | 'otp';
type Picked = { placeId: string; name: string; city: string | null; category: string | null; address: string | null };

export default function SignupScreen() {
  const router = useRouter();
  const t = useTheme();
  const { requestSignupOtp, signUp } = useAuth();
  const { width } = useWindowDimensions();
  const formInset = width < 360 ? 'px-0' : 'px-2';

  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [manual, setManual] = useState(false);
  const [bizName, setBizName] = useState('');
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedPhone, setMaskedPhone] = useState<string | undefined>();
  const [existingAccount, setExistingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phoneReady = phone.replace(/\D/g, '').length >= 8;
  const businessReady = !!picked || (manual && bizName.trim().length > 1);

  function back() {
    setError(null);
    if (step === 'otp') setStep('phone');
    else if (step === 'phone') setStep('business');
    else if (step === 'business') {
      if (manual && !picked) setManual(false);
      else setStep('name');
    } else router.back();
  }

  function onPlace(placeId: string, d: PlaceDetails) {
    setPicked({ placeId, name: d.name, city: d.city, category: d.primaryCategory, address: d.formattedAddress });
    setManual(false);
  }

  async function sendCode() {
    if (!phoneReady || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await requestSignupOtp(phone.trim());
      setMaskedPhone(r.maskedPhone);
      setExistingAccount(r.existingAccount);
      setOtp('');
      setStep('otp');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not send the code. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (otp.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signUp({
        phone: phone.trim(),
        otp,
        name: name.trim(),
        business: picked
          ? { googlePlaceId: picked.placeId, name: picked.name, city: picked.city ?? undefined, category: picked.category ?? undefined }
          : { name: bizName.trim(), category: category.trim() || undefined, city: city.trim() || undefined },
      });
      // Success: (auth)/_layout leaves this stack once isAuthenticated flips.
    } catch (err) {
      setError(getApiErrorMessage(err, 'Incorrect or expired code.'));
      setBusy(false);
    }
  }

  const title = {
    name: "What's your name?",
    business: 'Your business',
    phone: 'Your WhatsApp number',
    otp: 'Enter the code',
  }[step];
  const stepNo = { name: 1, business: 2, phone: 3, otp: 3 }[step];

  return (
    <Screen safeBottom>
      <View className="flex-row items-center gap-3 px-4 pb-2 pt-2">
        <Pressable onPress={back} hitSlop={8} accessibilityLabel="Back">
          <BackChevron />
        </Pressable>
        <Text className="font-sans text-xs text-zinc-500">Step {stepNo} of 3</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerClassName="flex-grow px-6 pb-10 pt-4" keyboardShouldPersistTaps="handled">
          <Text className="font-display text-[28px] tracking-tight text-white">{title}</Text>
          {step === 'name' && (
            <Text className="mt-2 font-sans text-sm text-zinc-400">
              Create your free account — CRM and visiting-card scanner included.
            </Text>
          )}

          <View className={`mt-6 gap-4 ${formInset}`}>
            {step === 'name' && (
              <>
                <Field
                  value={name}
                  onChangeText={setName}
                  placeholder="Full name"
                  autoCapitalize="words"
                  autoComplete="name"
                  autoFocus
                  returnKeyType="next"
                  onSubmitEditing={() => name.trim().length > 1 && setStep('business')}
                />
                <PrimaryButton title="Continue" disabled={name.trim().length < 2} onPress={() => setStep('business')} />
              </>
            )}

            {step === 'business' && (
              <>
                {picked ? (
                  <View
                    style={{
                      gap: 6,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: withAlpha(t.brand, 0.6),
                      backgroundColor: withAlpha(t.brand, 0.1),
                      padding: 14,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="checkmark-circle" size={18} color={t.brandBright} />
                      <Text className="flex-1 font-sans-semibold text-base text-white" numberOfLines={2}>{picked.name}</Text>
                    </View>
                    {!!picked.address && <Text className="font-sans text-sm text-zinc-400">{picked.address}</Text>}
                    <Text className="font-sans text-xs text-zinc-500">
                      We'll prepare your free Google profile report in the background.
                    </Text>
                    <Pressable onPress={() => setPicked(null)} hitSlop={6}>
                      <Text className="font-sans-semibold text-sm text-indigo-300">Change</Text>
                    </Pressable>
                  </View>
                ) : manual ? (
                  <>
                    <Field value={bizName} onChangeText={setBizName} placeholder="Business name" autoFocus />
                    <Field value={category} onChangeText={setCategory} placeholder="What do you do? e.g. Dental clinic (optional)" />
                    <Field value={city} onChangeText={setCity} placeholder="City (optional)" />
                    <Pressable onPress={() => setManual(false)} hitSlop={6}>
                      <Text className="font-sans-semibold text-sm text-indigo-300">Search Google instead</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text className="font-sans text-sm text-zinc-400">
                      Find your business on Google — we'll make you a free report on how it shows up.
                    </Text>
                    <StepBusinessSearch onSelected={onPlace} />
                    <Pressable onPress={() => setManual(true)} hitSlop={6}>
                      <Text className="font-sans-semibold text-sm text-indigo-300">Skip — I'm not on Google / do it later</Text>
                    </Pressable>
                  </>
                )}
                {(picked || manual) && (
                  <PrimaryButton title="Continue" disabled={!businessReady} onPress={() => setStep('phone')} />
                )}
              </>
            )}

            {step === 'phone' && (
              <>
                <PhoneNumberField value={phone} onChange={setPhone} editable={!busy} onSubmitEditing={() => void sendCode()} />
                <Text className="px-1 font-sans text-xs text-zinc-500">
                  We'll send a one-time code to this number on WhatsApp. By continuing you agree that we may send you
                  your report and account updates on WhatsApp.
                </Text>
                <ErrorText>{error}</ErrorText>
                <PrimaryButton title="Send code on WhatsApp" onPress={() => void sendCode()} loading={busy} disabled={!phoneReady} />
              </>
            )}

            {step === 'otp' && (
              <>
                {existingAccount && (
                  <Text className="font-sans text-sm text-amber-400">
                    You already have an account with this number — this code will sign you in.
                  </Text>
                )}
                <Field
                  placeholder="······"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChangeText={(v) => setOtp(v.replace(/\D/g, ''))}
                  editable={!busy}
                  onSubmitEditing={() => void verify()}
                  returnKeyType="go"
                  autoFocus
                  style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8 }}
                />
                <Text className="px-1 font-sans text-xs text-zinc-500">
                  Sent to {maskedPhone ?? phone} on WhatsApp.{' '}
                  <Text className="font-sans-semibold text-brand-bright" onPress={() => setStep('phone')}>
                    Wrong number?
                  </Text>
                </Text>
                <ErrorText>{error}</ErrorText>
                <PrimaryButton
                  title={existingAccount ? 'Verify & sign in' : 'Create my free account'}
                  onPress={() => void verify()}
                  loading={busy}
                  disabled={otp.length !== 6}
                />
                <Pressable onPress={() => void sendCode()} disabled={busy} style={{ alignItems: 'center', paddingVertical: 4 }}>
                  <Text className="font-sans-semibold text-sm text-brand-bright">Didn't get a code? Resend</Text>
                </Pressable>
              </>
            )}
          </View>

          <Pressable onPress={() => router.replace('/login')} style={{ marginTop: 32, alignItems: 'center', paddingVertical: 6 }}>
            <Text className="font-sans text-sm text-zinc-400">
              Already have an account? <Text className="font-sans-semibold text-brand-bright">Sign in</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
