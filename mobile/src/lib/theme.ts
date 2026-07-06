import { useColorScheme } from 'react-native';

/**
 * Hex palettes for native props (icon colors, tab bar, gradients) that can't
 * take Tailwind classes. Values mirror the CSS variables in src/global.css —
 * keep the two in sync. Components should call useTheme(); className-based
 * styling flips automatically via the variables.
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

  text: string;
  textDim: string; // zinc-400 role
  textFaint: string; // zinc-500 role

  /** Muted avatar gradient for non-active items. */
  inactiveAvatar: readonly [string, string];
}

/** Signature brand gradient (indigo → violet) — same in both themes. */
export const BRAND_GRADIENT = ['#6366F1', '#8B5CF6', '#A855F7'] as const;

const dark: Palette = {
  bg: '#070B14',
  card: '#0F1526',
  overlay: '#161D33',
  border: '#1E2742',
  tabBg: '#0A0F1E',

  brand: '#6366F1',
  brandBright: '#818CF8',
  brandMuted: '#4F46E5',

  violet: '#A855F7',
  cyan: '#22D3EE',
  emerald: '#34D399',
  amber: '#FBBF24',
  rose: '#FB7185',

  text: '#FFFFFF',
  textDim: '#8B93B8',
  textFaint: '#666E94',

  inactiveAvatar: ['#343A5C', '#4A5175'],
};

const light: Palette = {
  bg: '#F4F6FC',
  card: '#FFFFFF',
  overlay: '#E9EDF8',
  border: '#DEE4F2',
  tabBg: '#FFFFFF',

  brand: '#6366F1',
  brandBright: '#4F46E5',
  brandMuted: '#4338CA',

  violet: '#7C3AED',
  cyan: '#0E7490',
  emerald: '#059669',
  amber: '#D97706',
  rose: '#E11D48',

  text: '#12172E',
  textDim: '#5A6280',
  textFaint: '#757D9E',

  inactiveAvatar: ['#8A92B4', '#757D9E'],
};

export const palettes = { light, dark } as const;

/** Palette matching the phone's current light/dark setting. */
export function useTheme(): Palette {
  return useColorScheme() === 'light' ? light : dark;
}
