import { useColorScheme } from 'react-native';

/**
 * Hex palettes for native props (icon colors, tab bar, gradients).
 * Mirrors CSS variables in src/global.css — GrowwMatics Precision mobile
 * design system: Growth Green primary (matches the web app's
 * --color-primary, see src/app/globals.css — Aug 2026 re-theme, this used
 * to be a separate deep-navy scheme), hairline borders instead of shadow,
 * always-pill buttons/chips.
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

/**
 * Signature brand gradient — deep forest green → the web app's exact
 * --color-primary (#06b34c), always 135deg. Deliberately a wide light/dark
 * range (not two close-together greens, which barely read as a gradient at
 * all) so the header actually looks like a gradient rather than a flat
 * fill. The bright end is the web's own validated on-primary:white pairing.
 */
export const BRAND_GRADIENT = ['#04502b', '#06b34c'] as const;
/** Growth/success hero accent — Growth Green → light mint. Light enough at
 *  its bright end that white text/icons on top of it should stay small/bold
 *  accents (e.g. FunnelStep's arrow), not body copy — see
 *  GOAL_MET_CARD_GRADIENT below for the full-text-safe version. */
export const GROWTH_GRADIENT = ['#016c45', '#9af2c0'] as const;
/** Warning/attention-needed hero accent (e.g. "reviews needing a response"). */
export const AMBER_GRADIENT = ['#ffb300', '#ff8f00'] as const;
/** Critical/negative hero accent (e.g. "no reviews this week") — deep maroon
 *  → the app's validated --color-error red, same wide-range treatment as
 *  BRAND_GRADIENT above instead of a flat dark-red fill. Stays dark-to-dark
 *  end to end (unlike GROWTH_GRADIENT above) so white body text stays
 *  legible anywhere on it, not just near one end. */
export const CRITICAL_GRADIENT = ['#5c0010', '#ba1a1a'] as const;
/** Positive counterpart to CRITICAL_GRADIENT for the same full-text card use
 *  — Growth Green, dark-to-dark like CRITICAL_GRADIENT rather than
 *  GROWTH_GRADIENT's light-mint end, which body text would wash out against. */
export const GOAL_MET_CARD_GRADIENT = ['#016c45', '#0a8a3e'] as const;

const dark: Palette = {
  bg: '#191c1e',
  card: '#24282c',
  overlay: '#2d3135',
  border: '#373c41',
  tabBg: '#191c1e',

  brand: '#1f9d5c',
  brandBright: '#9af2c0',
  brandMuted: '#016c45',

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

  brand: '#06b34c',
  brandBright: '#0a8a3e',
  brandMuted: '#0a8a3e',

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
