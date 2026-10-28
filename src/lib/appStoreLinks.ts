/**
 * Mobile app store links, shared by the /app page and the billing WhatsApp
 * notices. Read at call time so they can be configured per environment.
 *
 *   NEXT_PUBLIC_PLAY_STORE_URL — defaults to the live Play Store listing.
 *   NEXT_PUBLIC_APP_STORE_URL  — the iOS App Store listing; unset until the
 *                                iOS app is published (nothing is shown).
 */
export const DEFAULT_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.growwmatics.app';

export function playStoreUrl(): string {
  return (process.env.NEXT_PUBLIC_PLAY_STORE_URL || '').trim() || DEFAULT_PLAY_STORE_URL;
}

export function appStoreUrl(): string | null {
  return (process.env.NEXT_PUBLIC_APP_STORE_URL || '').trim() || null;
}
