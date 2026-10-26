/**
 * Click-to-chat WhatsApp Help link for the mobile app header.
 *
 * Mirrors the web app's src/lib/whatsappCta.ts (mobile can't import that
 * file directly — separate app/bundle) — same number, same prefilled text
 * convention. The exact SUPPORT_MESSAGE string below must stay in sync with
 * the web copy: the backend webhook's classifyIntent() exact-matches it to
 * route straight to the support agent instead of the prospect report/demo
 * menu (see api/whatsapp/webhook/route.ts).
 */

const WHATSAPP_NUMBER = (process.env.EXPO_PUBLIC_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');

export const SUPPORT_MESSAGE = 'Hi, I need help with my GrowwMatics account';

/**
 * The website's privacy policy (App Store guideline 5.1.1(i) wants it
 * reachable inside the app). Null when the API URL isn't configured.
 */
export function getPrivacyPolicyUrl(): string | null {
  return websitePage('/privacy');
}

/**
 * The website's public "Delete your account" page — deletion itself happens on
 * the website (Profile → Danger Zone); the app only links to the instructions.
 */
export function getAccountDeletionUrl(): string | null {
  return websitePage('/delete-account');
}

function websitePage(path: string): string | null {
  const base = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');
  return base ? `${base}${path}` : null;
}

/** wa.me link, or null if the number isn't configured (caller should disable/hide the button). */
export function getSupportWhatsAppLink(message: string = SUPPORT_MESSAGE): string | null {
  if (!WHATSAPP_NUMBER) return null;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
