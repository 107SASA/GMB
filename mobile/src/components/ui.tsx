import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BRAND_GRADIENT, useTheme } from '@/lib/theme';

/** Full-height dark screen wrapper with safe-area padding. */
export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <SafeAreaView className={`flex-1 bg-surface ${className}`}>{children}</SafeAreaView>
  );
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <Text className="px-5 pb-2 pt-4 font-display text-[28px] leading-[34px] text-white">
      {children}
    </Text>
  );
}

/** Hairline-bordered container — the app's single elevation tier below FAB/modal. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <View
      className={`rounded-card border border-surface-border bg-surface-raised p-4 ${className}`}
    >
      {children}
    </View>
  );
}

/**
 * Text input that glows with the brand color while focused. Any field
 * passed `secureTextEntry` automatically gets a show/hide eye toggle —
 * every password field in the app goes through this component (or
 * LabeledField below, which wraps it), so this is the one place that
 * needs the toggle, not each screen individually.
 */
export function Field(props: TextInputProps) {
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const t = useTheme();
  const isPassword = !!props.secureTextEntry;

  const input = (
    <TextInput
      placeholderTextColor={t.textFaint}
      selectionColor={t.brandBright}
      {...props}
      secureTextEntry={isPassword ? !visible : props.secureTextEntry}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      className={`rounded-xl border px-4 py-3.5 font-sans text-base text-white ${
        focused ? 'border-brand bg-surface-raised' : 'border-surface-border bg-surface-raised'
      } ${isPassword ? 'pr-12' : ''} ${props.className ?? ''}`}
    />
  );

  if (!isPassword) return input;

  return (
    <View className="relative justify-center">
      {input}
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        // No `className` — see PrimaryButton below: react-native-css-interop
        // can swallow onPress on styled Pressables (nativewind 4.2.6 + SDK 57).
        style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' }}
      >
        <Ionicons name={visible ? 'eye-off' : 'eye'} size={20} color={t.textFaint} />
      </Pressable>
    </View>
  );
}

/** Primary CTA — indigo→violet gradient pill. */
export function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      disabled={inactive}
      // No `className` on this Pressable — confirmed by direct testing that
      // react-native-css-interop's pseudo-class/reactive-style tracking for
      // styled Pressables can swallow onPress entirely (nativewind 4.2.6 +
      // SDK 57). Static layout styles moved to plain `style`; the active:scale
      // press-animation is dropped rather than risk the same breakage.
      style={{ overflow: 'hidden', borderRadius: 999, opacity: inactive ? 0.5 : 1 }}
    >
      <LinearGradient
        colors={[...BRAND_GRADIENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ alignItems: 'center', paddingVertical: 15 }}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="font-sans-bold text-base text-on-brand">{title}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

/** Quiet secondary action — outlined pill. */
export function SecondaryButton({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      // No `className` on this Pressable — see PrimaryButton above:
      // react-native-css-interop can swallow onPress on styled Pressables.
      style={{
        alignItems: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: t.brand,
        backgroundColor: t.card,
        paddingVertical: 14,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text className="font-sans-bold text-base text-brand">{title}</Text>
    </Pressable>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text className="text-sm text-accent-rose">{children}</Text>;
}

/** Centered spinner used while auth/business state hydrates. */
export function LoadingScreen() {
  const t = useTheme();
  return (
    <View className="flex-1 items-center justify-center bg-surface">
      <ActivityIndicator size="large" color={t.brandBright} />
    </View>
  );
}

/** Pulsing placeholder block shown while a query loads. */
export function Skeleton({ className = '' }: { className?: string }) {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View style={{ opacity }} className={`rounded-card bg-surface-overlay ${className}`} />
  );
}

/** Centered icon-less empty/error body for lists. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-2 px-8 py-16">
      <Text className="text-center font-display-bold text-lg text-white">{title}</Text>
      {!!hint && <Text className="text-center font-sans text-sm text-zinc-400">{hint}</Text>}
      {action}
    </View>
  );
}

/**
 * Small tinted status pill (sentiment, reply status, source, score tier, …).
 * Tones follow the semantic score-color rule: green ≥70/rank≤5/positive,
 * amber 40-69/rank≤10/pending, rose <40/rank>10/critical — always a solid
 * container + on-container pair, never bare text color.
 */
export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'info';
}) {
  const tones = {
    neutral: 'bg-surface-overlay text-zinc-300',
    positive: 'bg-secondary-container text-on-secondary-container',
    negative: 'bg-error-container text-on-error-container',
    warning: 'bg-warning-container text-on-warning-container',
    info: 'bg-indigo-500/15 text-indigo-300',
  } as const;
  const [bg, text] = tones[tone].split(' ');
  return (
    <View className={`self-start rounded-full px-2.5 py-1 ${bg}`}>
      <Text className={`font-sans-bold text-[11px] uppercase tracking-[0.6px] ${text}`}>
        {label}
      </Text>
    </View>
  );
}

/** Horizontal filter chip; selected chips fill with the brand color. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      // No `className` — see PrimaryButton above.
      style={{
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderColor: selected ? t.brand : t.border,
        backgroundColor: selected ? t.brand : t.bg,
      }}
    >
      <Text className={`font-sans-semibold text-sm ${selected ? 'text-on-brand' : 'text-zinc-400'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Uppercase group heading used above lists/card groups for structural signposting. */
export function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-2.5 mt-7 px-1 font-sans-bold text-[11px] uppercase tracking-[0.6px] text-zinc-500">
      {children}
    </Text>
  );
}

/** Equal-width segment switcher (screen-level sub-tabs) — pill-shaped per the design system. */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const t = useTheme();
  return (
    <View className="mx-5 mb-3 flex-row rounded-full border border-surface-border bg-surface-raised p-1">
      {segments.map((segment) => (
        <Pressable
          key={segment.id}
          onPress={() => onChange(segment.id)}
          // No `className` — see PrimaryButton above.
          style={{
            flex: 1,
            alignItems: 'center',
            borderRadius: 999,
            paddingVertical: 8,
            backgroundColor: value === segment.id ? t.brand : 'transparent',
          }}
        >
          <Text
            className={`font-sans-semibold text-sm ${
              value === segment.id ? 'text-on-brand' : 'text-zinc-500'
            }`}
          >
            {segment.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Thin usage/score bar; turns amber past 80% and red at 100%. */
export function ProgressBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = pct >= 100 ? 'bg-accent-rose' : pct >= 80 ? 'bg-accent-amber' : 'bg-brand';
  return (
    <View className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
      <View className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </View>
  );
}

/** Label + input pair used by settings-style forms. */
export function LabeledField({
  label,
  ...inputProps
}: TextInputProps & { label: string }) {
  return (
    <View className="mb-3">
      <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">{label}</Text>
      <Field {...inputProps} />
    </View>
  );
}

/**
 * Circle with the entity's initials on the brand gradient — used anywhere a
 * business/user/lead needs a visual anchor (lists, switcher, profile). Pass
 * `imageUrl` (a business's published GBP logo — see the `logoUrl` field
 * from api/endpoints/businesses.ts) to show the real logo instead; falls
 * back to initials automatically if there's no URL, or the image fails to
 * load (private/expired Spaces URL, offline, etc.).
 */
export function InitialsAvatar({
  name,
  size = 40,
  colors,
  imageUrl,
}: {
  name: string | null | undefined;
  size?: number;
  colors?: readonly [string, string, ...string[]];
  imageUrl?: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  if (imageUrl && !imageFailed) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          // Faint ring so a white/near-white logo still reads as a distinct
          // circle against a white card or the header's green background.
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.35)',
          backgroundColor: '#ffffff',
        }}
      >
        <Image
          source={{ uri: imageUrl }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          onError={() => setImageFailed(true)}
        />
      </View>
    );
  }

  return (
    <LinearGradient
      colors={colors ?? [...BRAND_GRADIENT]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.38 }} className="font-sans-bold text-on-brand">
        {initials || '?'}
      </Text>
    </LinearGradient>
  );
}

/**
 * Themed bottom sheet for a one-off explanation + "Got it" dismiss — the
 * app's own dark card style instead of the OS's native `Alert.alert`, which
 * renders as a plain system dialog (default font, no theme awareness) that
 * clashed with the rest of the UI (Aug 2026 feedback). Same backdrop-as-
 * sibling idiom as the business-switcher sheet in app-header.tsx: a
 * full-bleed Pressable behind a separate content View, so a tap anywhere
 * outside the card dismisses it without needing stopPropagation tricks.
 */
export function InfoSheet({
  visible,
  onClose,
  title,
  message,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={onClose} />
      <View className="rounded-t-3xl border border-surface-border bg-surface-raised px-6 pb-10 pt-6">
        <Text className="font-display-bold text-lg text-white">{title}</Text>
        <Text className="mt-2 font-sans text-sm leading-5 text-zinc-400">{message}</Text>
        <Pressable
          onPress={onClose}
          // No `className` — react-native-css-interop can swallow onPress
          // on styled Pressables (see PrimaryButton above).
          style={{ marginTop: 20, alignItems: 'center', borderRadius: 999, backgroundColor: t.brand, paddingVertical: 14 }}
        >
          <Text className="font-sans-bold text-base text-on-brand">Got it</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/** Theme-aware back arrow used in custom screen headers. */
export function BackChevron() {
  const t = useTheme();
  return <Ionicons name="chevron-back" size={24} color={t.text} />;
}

/** Placeholder body for tab screens that get built in later phases. */
export function ComingSoon({ label }: { label: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-2 px-8">
      <Text className="font-display-bold text-lg text-white">{label}</Text>
      <Text className="text-center font-sans text-sm text-zinc-400">
        This screen is scaffolded and will be implemented in an upcoming phase.
      </Text>
    </View>
  );
}
