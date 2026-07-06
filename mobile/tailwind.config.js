/** @type {import('tailwindcss').Config} */

/** Reference a global.css RGB-triplet variable with alpha support. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Semantic tokens backed by CSS variables in src/global.css — they
        // flip automatically with the phone's light/dark setting. Hex values
        // for native props live in src/lib/theme.ts (keep in sync).
        surface: {
          DEFAULT: v('surface'), // app background
          raised: v('surface-raised'), // cards
          overlay: v('surface-overlay'), // elevated / pressed layers
          border: v('surface-border'), // hairlines
        },
        brand: {
          DEFAULT: v('brand'),
          bright: v('brand-bright'), // icons / active tints
          muted: v('brand-muted'), // pressed / disabled fill
        },
        accent: {
          violet: v('accent-violet'),
          cyan: v('accent-cyan'),
          emerald: v('accent-emerald'),
          amber: v('accent-amber'),
          rose: v('accent-rose'),
        },
        // `text-white` is the app's "primary text" role — it follows the
        // theme (near-black in light mode). Use `on-brand` for text/icons
        // that sit on brand fills or gradients and must stay white.
        white: v('fg'),
        'on-brand': '#FFFFFF',
        // Gray ramp for text/fills; role-preserving across themes.
        zinc: {
          50: v('zinc-50'),
          100: v('zinc-100'),
          200: v('zinc-200'),
          300: v('zinc-300'),
          400: v('zinc-400'),
          500: v('zinc-500'),
          600: v('zinc-600'),
          700: v('zinc-700'),
          800: v('zinc-800'),
          900: v('zinc-900'),
          950: v('zinc-950'),
        },
        // Status tints at the steps the app uses; darker in light mode so
        // tinted text stays readable (values in global.css).
        emerald: { 300: v('emerald-300'), 400: v('emerald-400'), 500: v('emerald-500') },
        amber: { 300: v('amber-300'), 400: v('amber-400'), 500: v('amber-500') },
        rose: { 300: v('rose-300'), 400: v('rose-400'), 500: v('rose-500') },
        indigo: { 300: v('indigo-300'), 400: v('indigo-400'), 500: v('indigo-500') },
      },
    },
  },
  plugins: [],
};
