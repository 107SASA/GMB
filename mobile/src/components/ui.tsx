import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
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

/** Text input that glows with the brand color while focused. */
export function Field(props: TextInputProps) {
  const [focused, setFocused] = useState(false);
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.textFaint}
      selectionColor={t.brandBright}
      {...props}
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
      } ${props.className ?? ''}`}
    />
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
      className={`overflow-hidden rounded-full ${inactive ? 'opacity-50' : 'active:scale-95'}`}
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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`items-center rounded-full border border-brand bg-surface-raised py-3.5 ${
        disabled ? 'opacity-50' : 'active:scale-95 active:bg-surface-overlay'
      }`}
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
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full border px-4 py-2 active:scale-95 ${
        selected
          ? 'border-brand bg-brand'
          : 'border-surface-border bg-surface active:bg-surface-overlay'
      }`}
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
  return (
    <View className="mx-5 mb-3 flex-row rounded-full border border-surface-border bg-surface-raised p-1">
      {segments.map((segment) => (
        <Pressable
          key={segment.id}
          onPress={() => onChange(segment.id)}
          className={`flex-1 items-center rounded-full py-2 ${
            value === segment.id ? 'bg-brand' : ''
          }`}
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
 * business/user/lead needs a visual anchor (lists, switcher, profile).
 */
export function InitialsAvatar({
  name,
  size = 40,
  colors,
}: {
  name: string | null | undefined;
  size?: number;
  colors?: readonly [string, string, ...string[]];
}) {
  const initials = (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
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
