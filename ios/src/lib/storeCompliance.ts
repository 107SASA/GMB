/**
 * App Store purchase-steering guard (guideline 3.1.1(a)): outside the US
 * storefront, an app may not show buttons, links or calls to action that send
 * people to buy outside in-app purchase. The iOS app sells nothing; plans are
 * chosen and paid for on the website only.
 *
 * The app's own copy is already neutral. This module covers text the SERVER
 * writes for the website and that would otherwise reach iOS users verbatim —
 * error messages and in-app notification bodies — without changing the
 * backend (which the website and Android app share). Account status, trial and
 * renewal dates, usage and cancellation information are kept; only the
 * sentences that ask the user to buy, renew, reactivate or pay are removed.
 */

const PURCHASE_CTA =
  /\b(subscribe|upgrade|pricing|renew|reactivate|buy|purchase|checkout|book a demo|free report|update your payment method)\b/i;

/** True when `text` asks the user to buy, renew, pay or go to a sales funnel. */
export function containsPurchaseCta(text: string): boolean {
  return PURCHASE_CTA.test(text);
}

/** Shown on sign-in when the number has no account (the server's copy points to the free report / a demo). */
export const NO_ACCOUNT_MESSAGE =
  'No account found for this number. Check the number, or use the one registered to your GrowwMatics account.';

/** Server notification types written by the billing system. */
function isBillingNotification(type: string): boolean {
  return /^(billing|subscription)/.test(type);
}

/**
 * The body to show for an in-app notification. For billing notifications,
 * sentences with a purchase call to action are dropped, e.g.
 *   "Access to Asha Salon ends on 3 Nov 2026. Renew to keep everything
 *    unlocked — no data is lost."  →  "Access to Asha Salon ends on 3 Nov 2026."
 * Every other notification is returned unchanged.
 */
export function storeSafeNotificationBody(type: string, body: string | null | undefined): string {
  if (!body) return '';
  if (!isBillingNotification(type)) return body;
  const sentences = body.match(/[^.!?]+[.!?]*\s*/g) ?? [body];
  return sentences
    .filter((s) => !containsPurchaseCta(s))
    .join('')
    .trim();
}
