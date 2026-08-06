import { useColorScheme } from 'react-native';

/**
 * Hex palettes for native props (icon colors, tab bar, gradients).
 * Mirrors CSS variables in src/global.css — GrowwMatics Precision mobile
 * design system: deep navy primary, Growth Green secondary, hairline
 * borders instead of shadow, always-pill buttons/chips.
 */
export interface Palette {
  bg: string;
  card: string;
  overlay: string;
  border: string;
  /** Tab-bar background (slightly distinct from bg in dark mode). */
  tabBg: string;

  brand: string;
  brandBright: string;
  brandMuted: string;

  violet: string;
  cyan: string;
  emerald: string;
  amber: string;
  rose: string;
  /** Destructive-action soft fill (error-container) + its on-color text. */
  errorContainer: string;
  onErrorContainer: string;

  text: string;
  textDim: string;
  textFaint: string;

  /** Muted avatar gradient for non-active items. */
  inactiveAvatar: readonly [string, string];
}

/** Signature brand gradient — Deep Navy → Trust Blue, always 135deg. */
export const BRAND_GRADIENT = ['#002347', '#00386c'] as const;
/** Growth/success hero accent — Growth Green → light mint. */
export const GROWTH_GRADIENT = ['#016c45', '#9af2c0'] as const;
/** Warning/attention-needed hero accent (e.g. "reviews needing a response"). */
export const AMBER_GRADIENT = ['#ffb300', '#ff8f00'] as const;

const dark: Palette = {
  bg: '#191c1e',
  card: '#24282c',
  overlay: '#2d3135',
  border: '#373c41',
  tabBg: '#191c1e',

  brand: '#a6c8ff',
  brandBright: '#d5e3ff',
  brandMuted: '#1a477c',

  violet: '#a6c8ff',
  cyan: '#76a3e4',
  emerald: '#81d8a8',
  amber: '#ffb74d',
  rose: '#ffb4ab',
  errorContainer: '#93000a',
  onErrorContainer: '#ffdad6',

  text: '#eff1f3',
  textDim: '#c3c6d1',
  textFaint: '#8d9199',

  inactiveAvatar: ['#2d3135', '#3f444a'],
};

const light: Palette = {
  bg: '#f7f9fb',
  card: '#ffffff',
  overlay: '#e6e8ea',
  border: '#c3c6d1',
  tabBg: '#ffffff',

  brand: '#002347',
  brandBright: '#1a477c',
  brandMuted: '#00386c',

  violet: '#1a477c',
  cyan: '#1a477c',
  emerald: '#016c45',
  amber: '#7a4a00',
  rose: '#ba1a1a',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  text: '#191c1e',
  textDim: '#43474f',
  textFaint: '#737780',

  inactiveAvatar: ['#c3c6d1', '#8d9199'],
};

export const palettes = { light, dark } as const;

/** Palette matching the phone's current light/dark setting. */
export function useTheme(): Palette {
  return useColorScheme() === 'light' ? light : dark;
}

/**
 * `#rrggbb` + 0-1 alpha → `rgba(...)`. For inline `style` props standing in
 * for NativeWind's `color/opacity` shorthand (e.g. `bg-brand/10`) on
 * components — like Pressable — where `className` isn't safe to use (see
 * ui.tsx PrimaryButton).
 */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
