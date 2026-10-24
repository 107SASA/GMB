import Razorpay from 'razorpay';
import { razorpayModeFromKeyId, type RazorpayMode } from './razorpayMode';

/**
 * Razorpay server client. Mirrors the Twilio pattern: missing env vars
 * degrade to a disabled mode with a console warning instead of crashing —
 * routes then answer 503 "billing not configured".
 *
 * Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET.
 * The sellable plan's Razorpay Plan id lives in the BillingPlan document
 * and is created automatically (see planCatalog.ts).
 *
 * The key id decides test vs live mode (see razorpayMode.ts). A key id that is
 * neither rzp_test_… nor rzp_live_… disables billing: ids can't be recorded
 * against an unknown mode.
 */

let cached: Razorpay | null | undefined;
let cachedKeyId: string | undefined;

export function getRazorpay(): Razorpay | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (cached !== undefined && cachedKeyId === keyId) return cached;
  cachedKeyId = keyId;

  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.warn('[billing] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — billing is disabled');
    cached = null;
    return cached;
  }
  if (!razorpayModeFromKeyId(keyId)) {
    console.warn('[billing] RAZORPAY_KEY_ID is not a rzp_test_… or rzp_live_… key — billing is disabled');
    cached = null;
    return cached;
  }

  cached = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return cached;
}

export function getRazorpayKeyId(): string | null {
  return process.env.RAZORPAY_KEY_ID ?? null;
}

/** test / live from the configured key id; null when billing isn't usably configured. */
export function getRazorpayMode(): RazorpayMode | null {
  if (!process.env.RAZORPAY_KEY_SECRET) return null;
  return razorpayModeFromKeyId(process.env.RAZORPAY_KEY_ID);
}
