import { handleTwilioWebhook } from '@/app/api/whatsapp/webhook/route';

export const maxDuration = 60; // Webhook handler should be fast, but we'll leave it at 60s
export const dynamic = 'force-dynamic';

/**
 * Legacy URL, kept working rather than deleted: this used to dispatch an
 * incomplete `whatsapp/incoming` event (no leadId/threadId/tenantId/businessId),
 * which failed Mongoose validation downstream, retried 3x, then died silently —
 * after this route had already ACK'd Twilio with an empty 200, so Twilio never
 * retried either. Every message sent here was lost with no trace.
 *
 * The unified handler at /api/whatsapp/webhook already implements Twilio
 * correctly (per-business signature validation, lead/thread resolution, full
 * event payload) because it has to for the JSON/Meta side anyway — so this
 * route now delegates to that same function instead of maintaining a second,
 * divergent copy of the same logic. Twilio's console webhook config is
 * external to this repo; if it's still pointed at this URL, it now works.
 * documentation/modules/module-6-whatsapp-ai.md has been corrected to point
 * at the canonical /api/whatsapp/webhook URL for any new setup.
 */
export async function POST(req: Request) {
  return handleTwilioWebhook(req);
}
