import Razorpay from 'razorpay';

/**
 * Razorpay server client. Mirrors the Twilio pattern: missing env vars
 * degrade to a disabled mode with a console warning instead of crashing —
 * routes then answer 503 "billing not configured".
 *
 * Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET,
 * plus RAZORPAY_PLAN_ID_* per sellable plan (see planCatalog.ts).
 */

let cached: Razorpay | null | undefined;

export function getRazorpay(): Razorpay | null {
  if (cached !== undefined) return cached;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.warn('[billing] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — billing is disabled');
    cached = null;
    return cached;
  }

  cached = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return cached;
}

export function getRazorpayKeyId(): string | null {
  return process.env.RAZORPAY_KEY_ID ?? null;
}
