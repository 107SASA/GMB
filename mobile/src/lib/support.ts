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

/** wa.me link, or null if the number isn't configured (caller should disable/hide the button). */
export function getSupportWhatsAppLink(message: string = SUPPORT_MESSAGE): string | null {
  if (!WHATSAPP_NUMBER) return null;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
