import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useId, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
  type TextInputProps,
} from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Polygon, Rect } from 'react-native-svg';

import { getApiErrorMessage } from '@/api/client';
import type { PlaceDetails } from '@/api/endpoints/onboarding';
import { useAuth } from '@/auth/AuthContext';
import { StepBusinessSearch } from '@/components/onboarding/StepBusinessSearch';
import { PhoneNumberField } from '@/components/phone-number-field';
import { ErrorText, Field, Screen } from '@/components/ui';
import { palettes, withAlpha } from '@/lib/theme';

/**
 * Create a free account (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md):
 * name → business (Google listing, or skip and type it) → WhatsApp number → code.
 * The free account opens the CRM + visiting-card scan; the other tabs are
 * locked and show the free Google profile report, generated in the
 * background when a listing was picked. A number that already has an
 * account is simply signed in.
 *
 * Design: white page, navy titles and our green in light mode; the same
 * layout on the app's dark page in dark mode (LIGHT / DARK below).
 *
 * STORE COMPLIANCE — no prices, no "upgrade/buy" wording on this screen.
 */

type Step = 'name' | 'business' | 'phone' | 'otp';
type Picked = { placeId: string; name: string; city: string | null; category: string | null; address: string | null };

const LOGO = require('../../../assets/images/icon.png');

/** Sign-up colours: our green on a white page with navy text (light), or the app's dark page (dark). */
const LIGHT = {
  page: '#ffffff',
  ink: '#0b1736',
  body: '#4b5873',
  faint: '#8b93a7',
  line: '#e3e7ee',
  field: '#f6f8fb',
  chip: '#eef1f5',
  green: palettes.light.brand,
  greenDark: palettes.light.brandBright,
  greenSoft: '#eaf7ef',
  greenLine: '#cdebd8',
  red: '#e5484d',
  shadow: 0.3,
};
const DARK: typeof LIGHT = {
  page: palettes.dark.bg,
  ink: palettes.dark.text,
  body: palettes.dark.textDim,
  faint: palettes.dark.textFaint,
  line: palettes.dark.border,
  field: palettes.dark.card,
  chip: palettes.dark.overlay,
  green: palettes.dark.brand,
  greenDark: palettes.dark.brandBright,
  greenSoft: withAlpha(palettes.dark.brand, 0.14),
  greenLine: withAlpha(palettes.dark.brand, 0.35),
  red: palettes.dark.rose,
  shadow: 0.18,
};

/** Light or dark sign-up colours, following the phone's setting. */
function useC() {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}

const G_RED = '#EA4335';
const G_BLUE = '#4285F4';
const G_YELLOW = '#FBBC05';
const G_GREEN = '#34A853';

/* ── Drawings ──────────────────────────────────────────────────────── */

/** Google-Maps-style pin in the four Google colours. */
function GooglePin({ size = 22 }: { size?: number }) {
  const id = `pin${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const shape = 'M12 1.5C7.6 1.5 4 5.1 4 9.5c0 5.9 8 13 8 13s8-7.1 8-13c0-4.4-3.6-8-8-8z';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <ClipPath id={id}>
          <Path d={shape} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id})`}>
        <Rect x="0" y="0" width="24" height="24" fill={G_GREEN} />
        <Rect x="0" y="0" width="12" height="9.5" fill={G_RED} />
        <Rect x="12" y="0" width="12" height="9.5" fill={G_BLUE} />
        <Polygon points="0,9.5 12,9.5 4,17 0,17" fill={G_YELLOW} />
      </G>
      <Circle cx="12" cy="9.5" r="3" fill="#ffffff" />
    </Svg>
  );
}

/** Folded map with a Google pin — the business-search picture. */
function MapIllustration() {
  const C = useC();
  return (
    <Svg width={220} height={140} viewBox="0 0 220 140">
      <Polygon points="20,76 78,60 92,108 28,120" fill="#d9f2e2" />
      <Polygon points="78,60 138,72 152,116 92,108" fill="#e3ecfb" />
      <Polygon points="138,72 198,58 210,102 152,116" fill="#d9f2e2" />
      <Path d="M32 102 Q 112 76 202 90" stroke="#ffffff" strokeWidth="7" fill="none" strokeLinecap="round" />
      <Path d="M72 70 L 120 112" stroke="#b9d0f5" strokeWidth="6" fill="none" strokeLinecap="round" />
      <Path d="M152 78 L 174 108" stroke="#ffffff" strokeWidth="4" fill="none" strokeLinecap="round" />
      <G transform="translate(80 2) scale(2.5)">
        <GoogleMapsPinShape />
      </G>
      <Line x1="158" y1="22" x2="166" y2="8" stroke={C.green} strokeWidth="4" strokeLinecap="round" />
      <Line x1="164" y1="38" x2="178" y2="32" stroke={C.green} strokeWidth="4" strokeLinecap="round" />
      <Line x1="162" y1="54" x2="176" y2="56" stroke={C.green} strokeWidth="4" strokeLinecap="round" />
    </Svg>
  );
}

/** Same pin as GooglePin, drawn inside another Svg (no own canvas). */
function GoogleMapsPinShape() {
  const id = `big${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const shape = 'M12 1.5C7.6 1.5 4 5.1 4 9.5c0 5.9 8 13 8 13s8-7.1 8-13c0-4.4-3.6-8-8-8z';
  return (
    <>
      <Defs>
        <ClipPath id={id}>
          <Path d={shape} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id})`}>
        <Rect x="0" y="0" width="24" height="24" fill={G_GREEN} />
        <Rect x="0" y="0" width="12" height="9.5" fill={G_RED} />
        <Rect x="12" y="0" width="12" height="9.5" fill={G_BLUE} />
        <Polygon points="0,9.5 12,9.5 4,17 0,17" fill={G_YELLOW} />
      </G>
      <Circle cx="12" cy="9.5" r="3.2" fill="#ffffff" />
    </>
  );
}

/* ── Small building blocks ─────────────────────────────────────────── */

/** Round back button, centred "STEP N OF 3" pill, and the 3-part progress bar. */
function StepHeader({ step, onBack }: { step: number; onBack: () => void }) {
  const C = useC();
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 8, gap: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: C.page }}
        >
          <Ionicons name="chevron-back" size={22} color={C.ink} />
        </Pressable>
        <View style={{ borderRadius: 999, backgroundColor: C.chip, paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text className="font-sans-semibold text-xs" style={{ color: C.ink, letterSpacing: 0.8 }}>
            STEP {step} OF 3
          </Text>
        </View>
        <View style={{ width: 44 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }} accessibilityLabel={`Step ${step} of 3`}>
        {[1, 2, 3].map((n) => (
          <View key={n} style={{ flex: 1, height: 6, borderRadius: 999, backgroundColor: n <= step ? C.green : C.chip }} />
        ))}
      </View>
    </View>
  );
}

function Title({ children, center = false }: { children: string; center?: boolean }) {
  const C = useC();
  return (
    <Text className="font-display-bold" style={{ fontSize: 32, lineHeight: 38, letterSpacing: -0.6, color: C.ink, textAlign: center ? 'center' : 'left' }}>
      {children}
    </Text>
  );
}

function Subtitle({ children, center = false }: { children: ReactNode; center?: boolean }) {
  const C = useC();
  return (
    <Text className="font-sans" style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: C.body, textAlign: center ? 'center' : 'left' }}>
      {children}
    </Text>
  );
}

/** Uppercase field label, with "Optional" on the right. */
function Label({ children, required, optional }: { children: string; required?: boolean; optional?: boolean }) {
  const C = useC();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <Text className="font-sans-bold" style={{ fontSize: 13, color: C.ink, letterSpacing: 0.9 }}>
        {children}
        {required && <Text style={{ color: C.red }}> *</Text>}
      </Text>
      {optional && <Text className="font-sans" style={{ fontSize: 13, color: C.faint }}>Optional</Text>}
    </View>
  );
}

/** Light-grey box with an icon on the left. */
function IconInput({ icon, trailing, ...props }: TextInputProps & { icon: keyof typeof Ionicons.glyphMap; trailing?: ReactNode }) {
  const C = useC();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: focused ? C.green : C.line,
        backgroundColor: focused ? C.page : C.field,
        paddingHorizontal: 18,
        minHeight: 60,
      }}
    >
      <Ionicons name={icon} size={22} color={focused ? C.green : C.body} />
      <TextInput
        placeholderTextColor={C.faint}
        selectionColor={C.green}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[{ flex: 1, paddingVertical: 16, fontFamily: 'Inter_400Regular', fontSize: 17, color: C.ink }, Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'none' } as object) : null]}
      />
      {trailing}
    </View>
  );
}

/** Solid green pill with a soft shadow: optional icon on the left, arrow on the right. */
function Cta({
  title,
  onPress,
  icon,
  loading = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
}) {
  const C = useC();
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      // No `className` on Pressable — see ui.tsx PrimaryButton.
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        minHeight: 60,
        borderRadius: 999,
        paddingHorizontal: 24,
        backgroundColor: C.green,
        opacity: inactive && !loading ? 0.45 : 1,
        shadowColor: C.green,
        shadowOpacity: inactive ? 0 : C.shadow,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
        elevation: inactive ? 0 : 6,
      }}
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={24} color="#ffffff" />}
          <Text className="font-sans-bold" style={{ fontSize: 18, color: '#ffffff' }}>{title}</Text>
          <Ionicons name="arrow-forward" size={22} color="#ffffff" />
        </>
      )}
    </Pressable>
  );
}

/** Pale-green note card: picture, thin divider, title and one line. Tappable with `onPress`. */
function InfoCard({ visual, title, body, onPress }: { visual: ReactNode; title: string; body: string; onPress?: () => void }) {
  const C = useC();
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 20, backgroundColor: C.greenSoft, paddingVertical: 18, paddingHorizontal: 18 }}>
      <View style={{ width: 44, alignItems: 'center' }}>{visual}</View>
      <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: C.greenLine }} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text className="flex-shrink font-sans-bold" style={{ fontSize: 15, color: onPress ? C.greenDark : C.ink }}>{title}</Text>
          {onPress && <Ionicons name="arrow-forward" size={16} color={C.greenDark} />}
        </View>
        <Text className="font-sans" style={{ fontSize: 14, lineHeight: 20, color: C.body }}>{body}</Text>
      </View>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      {content}
    </Pressable>
  );
}

/** Green shield + one line. */
function TrustRow({ children }: { children: string }) {
  const C = useC();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Ionicons name="shield-checkmark" size={26} color={C.green} />
      <Text className="flex-1 font-sans" style={{ fontSize: 15, lineHeight: 21, color: C.ink }}>{children}</Text>
    </View>
  );
}

/** "Already have an account? Sign in". */
function SignInLink() {
  const C = useC();
  const router = useRouter();
  return (
    <Pressable onPress={() => router.replace('/login')} accessibilityRole="link" style={{ alignItems: 'center', paddingVertical: 12 }}>
      <Text className="font-sans" style={{ fontSize: 16, color: C.ink }}>
        Already have an account? <Text className="font-sans-bold" style={{ color: C.green }}>Sign in</Text>
      </Text>
    </Pressable>
  );
}

/* ── Screen ────────────────────────────────────────────────────────── */

export default function SignupScreen() {
  const C = useC();
  const router = useRouter();
  const { requestSignupOtp, signUp } = useAuth();

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

  const stepNo = { name: 1, business: 2, phone: 3, otp: 3 }[step];
  const searching = step === 'business' && !picked && !manual;

  return (
    <Screen safeBottom>
      <View style={{ flex: 1, backgroundColor: C.page }}>
        <StepHeader step={stepNo} onBack={back} />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 12 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── 1. Name ── */}
            {step === 'name' && (
              <>
                <Title>What&apos;s your name?</Title>
                <Subtitle>Create your free account to manage customers and scan visiting cards.</Subtitle>
                <View style={{ marginTop: 34 }}>
                  <Label>FULL NAME</Label>
                  <IconInput
                    icon="person-outline"
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g. Rahul Sharma"
                    autoCapitalize="words"
                    autoComplete="name"
                    autoFocus
                    returnKeyType="next"
                    onSubmitEditing={() => name.trim().length > 1 && setStep('business')}
                  />
                </View>
                <View style={{ marginTop: 22 }}>
                  <TrustRow>Free account · CRM and visiting-card scanner included</TrustRow>
                </View>
              </>
            )}

            {/* ── 2a. Business: search Google Maps ── */}
            {searching && (
              <>
                <View style={{ alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, borderWidth: 1, borderColor: C.greenLine, backgroundColor: C.greenSoft, paddingHorizontal: 18, paddingVertical: 9 }}>
                    <GooglePin size={20} />
                    <Text className="font-sans-semibold" style={{ fontSize: 15, color: C.greenDark }}>Google Maps Directory</Text>
                  </View>
                  <View style={{ marginTop: 10, marginBottom: 6 }}>
                    <MapIllustration />
                  </View>
                </View>
                <Title center>Find your business</Title>
                <Subtitle center>Search for your business on Google Maps to generate your free visibility report.</Subtitle>

                <View
                  style={{
                    marginTop: 24,
                    gap: 16,
                    borderRadius: 22,
                    borderWidth: 1,
                    borderColor: C.line,
                    backgroundColor: C.page,
                    padding: 18,
                    shadowColor: '#0b1736',
                    shadowOpacity: 0.06,
                    shadowRadius: 16,
                    shadowOffset: { width: 0, height: 6 },
                    elevation: 2,
                  }}
                >
                  <Text className="font-sans-bold" style={{ fontSize: 17, color: C.ink }}>Search your business</Text>
                  <StepBusinessSearch embedded onSelected={onPlace} />
                  <View style={{ height: 1, backgroundColor: C.line }} />
                  <TrustRow>We&apos;ll only use publicly available business information.</TrustRow>
                </View>

                <View style={{ marginTop: 18 }}>
                  <InfoCard
                    visual={<Ionicons name="information-circle-outline" size={34} color={C.green} />}
                    title="Why do we need this?"
                    body="We'll use your business listing to prepare a report about how your business appears on Google Maps."
                  />
                </View>
              </>
            )}

            {/* ── 2b. Business: picked from Google ── */}
            {step === 'business' && picked && (
              <>
                <Title>Your business</Title>
                <Subtitle>We&apos;ll prepare your free Google profile report in the background.</Subtitle>
                <View style={{ marginTop: 28, gap: 10, borderRadius: 20, borderWidth: 1.5, borderColor: C.greenLine, backgroundColor: C.greenSoft, padding: 18 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <GooglePin size={28} />
                    <Text className="flex-1 font-sans-bold" style={{ fontSize: 17, color: C.ink }} numberOfLines={2}>{picked.name}</Text>
                    <Ionicons name="checkmark-circle" size={24} color={C.green} />
                  </View>
                  {!!picked.address && (
                    <Text className="font-sans" style={{ fontSize: 14, lineHeight: 20, color: C.body, marginLeft: 40 }}>{picked.address}</Text>
                  )}
                  <Pressable onPress={() => setPicked(null)} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-start', marginLeft: 40, marginTop: 2 }}>
                    <Text className="font-sans-bold" style={{ fontSize: 14, color: C.greenDark }}>Change business</Text>
                  </Pressable>
                </View>
              </>
            )}

            {/* ── 2c. Business: typed in (not on Google) ── */}
            {step === 'business' && !picked && manual && (
              <>
                <Title>Your business</Title>
                <Subtitle>Find and select your business on Google Maps to get a free visibility report.</Subtitle>
                <View style={{ marginTop: 30, gap: 22 }}>
                  <View>
                    <Label required>BUSINESS NAME</Label>
                    <IconInput icon="business-outline" value={bizName} onChangeText={setBizName} placeholder="e.g. Shree Dental Clinic" autoFocus autoCapitalize="words" />
                  </View>
                  <View>
                    <Label optional>INDUSTRY OR CATEGORY</Label>
                    <IconInput icon="briefcase-outline" value={category} onChangeText={setCategory} placeholder="e.g. Dental clinic" />
                  </View>
                  <View>
                    <Label optional>LOCATION</Label>
                    <IconInput icon="location-outline" value={city} onChangeText={setCity} placeholder="e.g. Pune, Maharashtra" autoCapitalize="words" />
                  </View>
                  <InfoCard
                    visual={<GooglePin size={40} />}
                    title="Find my business on Google Maps"
                    body="Search and select your business directly from Google Maps."
                    onPress={() => setManual(false)}
                  />
                </View>
              </>
            )}

            {/* ── 3. WhatsApp number ── */}
            {step === 'phone' && (
              <>
                <View style={{ alignItems: 'center', marginBottom: 26 }}>
                  <Image source={LOGO} style={{ width: 92, height: 92 }} contentFit="contain" accessibilityLabel="Growwmatics" />
                </View>
                <Title center>Your WhatsApp Number</Title>
                <Subtitle center>We&apos;ll send a one-time code to verify your number on WhatsApp.</Subtitle>
                <View style={{ marginTop: 32, gap: 20 }}>
                  <PhoneNumberField value={phone} onChange={setPhone} editable={!busy} onSubmitEditing={() => void sendCode()} />
                  <InfoCard
                    visual={<Ionicons name="logo-whatsapp" size={38} color={C.green} />}
                    title="Get a verification code on WhatsApp"
                    body="We'll send a secure, one-time code to this number to confirm it's yours."
                  />
                  <ErrorText>{error}</ErrorText>
                </View>
              </>
            )}

            {/* ── 3b. Code ── */}
            {step === 'otp' && (
              <>
                <View style={{ alignItems: 'center', marginBottom: 26 }}>
                  <Image source={LOGO} style={{ width: 92, height: 92 }} contentFit="contain" accessibilityLabel="Growwmatics" />
                </View>
                <Title center>Enter the code</Title>
                <Subtitle center>
                  Sent to {maskedPhone ?? phone} on WhatsApp.{' '}
                  <Text className="font-sans-bold" style={{ color: C.green }} onPress={() => setStep('phone')}>
                    Wrong number?
                  </Text>
                </Subtitle>
                <View style={{ marginTop: 32, gap: 16 }}>
                  {existingAccount && (
                    <InfoCard
                      visual={<Ionicons name="person-circle-outline" size={34} color={C.green} />}
                      title="Welcome back"
                      body="You already have an account with this number — this code will sign you in."
                    />
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
                    accessibilityLabel="6-digit code"
                    style={[{ textAlign: 'center', fontSize: 28, letterSpacing: 12, borderRadius: 18, minHeight: 64, color: C.ink, backgroundColor: C.field, borderColor: C.line }, Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'none' } as object) : null]}
                  />
                  <ErrorText>{error}</ErrorText>
                </View>
              </>
            )}

            {/* Pushes the button to the bottom on tall screens. */}
            <View style={{ flexGrow: 1, minHeight: 28 }} />

            <View style={{ gap: 8 }}>
              {step === 'name' && <Cta title="Continue" disabled={name.trim().length < 2} onPress={() => setStep('business')} />}
              {step === 'business' && (
                <Cta title="Continue" disabled={!businessReady} onPress={() => setStep('phone')} />
              )}
              {step === 'phone' && (
                <Cta title="Send code on WhatsApp" icon="logo-whatsapp" onPress={() => void sendCode()} loading={busy} disabled={!phoneReady} />
              )}
              {step === 'otp' && (
                <>
                  <Cta
                    title={existingAccount ? 'Verify & sign in' : 'Create my free account'}
                    onPress={() => void verify()}
                    loading={busy}
                    disabled={otp.length !== 6}
                  />
                  <Pressable onPress={() => void sendCode()} disabled={busy} accessibilityRole="button" style={{ alignItems: 'center', paddingVertical: 8 }}>
                    <Text className="font-sans-bold" style={{ fontSize: 15, color: C.green }}>Didn&apos;t get a code? Resend</Text>
                  </Pressable>
                </>
              )}
              {searching && (
                <>
                  <Pressable onPress={() => setManual(true)} accessibilityRole="button" style={{ alignItems: 'center', paddingVertical: 12 }}>
                    <Text className="font-sans" style={{ fontSize: 16, color: C.ink }}>
                      Not on Google Maps? <Text className="font-sans-bold" style={{ color: C.green }}>Skip for now</Text>
                    </Text>
                  </Pressable>
                  <View style={{ height: 1, backgroundColor: C.line }} />
                </>
              )}
              <SignInLink />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Screen>
  );
}
