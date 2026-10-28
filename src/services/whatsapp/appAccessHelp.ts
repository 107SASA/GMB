import { APP_ACCESS_MESSAGE } from '../../lib/whatsappCta.ts';

/**
 * The mobile app's "workspace isn't active" screen opens WhatsApp with
 * APP_ACCESS_MESSAGE. An unpaid sender gets one fixed reply (no AI): finish
 * the payment and the dashboard unlocks. A paid or trial sender is a real
 * access problem and goes to support as usual.
 */
export function isAppAccessMessage(body: string | null | undefined): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
  return !!body && norm(body) === norm(APP_ACCESS_MESSAGE);
}

export function appAccessReplyText(subscribeUrl?: string | null): string {
  const url = (subscribeUrl || '').trim();
  return [
    "Please complete your payment if it isn't done yet — as soon as it's done, your dashboard unlocks automatically in the app.",
    ...(url ? ['', `You can complete it here: ${url}`] : []),
    '',
    "Already paid? Just reply here and our team will check it for you.",
  ].join('\n');
}
