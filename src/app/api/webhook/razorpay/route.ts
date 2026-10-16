import { NextResponse } from 'next/server';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import ProcessedWebhookEvent from '@/models/ProcessedWebhookEvent';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { applyRazorpayEvent } from '@/services/billing/billingEvents';

export const dynamic = 'force-dynamic';

/**
 * Razorpay webhook — entitlements change here (and in the self-heal, through
 * the same services/billing/billingEvents.ts rules). Requirements honored here:
 *  - HMAC-SHA256 signature verification against RAZORPAY_WEBHOOK_SECRET
 *    before the payload is trusted (403 otherwise; mirrors the Twilio
 *    pattern in lib/twilioSignature.ts, including the dev-mode skip).
 *  - Idempotent: Razorpay retries deliveries, so each event id is claimed
 *    with a unique insert first; replays exit early.
 */

function verifySignature(rawBody: string, signature: string | null):
  | { ok: true }
  | { ok: false; response: NextResponse } {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Webhook secret not configured' }, { status: 403 }),
      };
    }
    console.warn('[billing] RAZORPAY_WEBHOOK_SECRET not set — skipping signature validation in development');
    return { ok: true };
  }

  if (!signature) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Missing Razorpay signature' }, { status: 403 }),
    };
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid Razorpay signature' }, { status: 403 }),
    };
  }

  return { ok: true };
}

// Razorpay subscription events this app acts on (confirmed against
// razorpay.com/docs/webhooks/subscriptions). The Razorpay dashboard webhook
// must be subscribed to each of these. Anything else is acknowledged and ignored.
const HANDLED_EVENTS = new Set([
  'subscription.authenticated',
  'subscription.activated',
  'subscription.charged',
  'subscription.pending',
  'subscription.halted',
  'subscription.cancelled',
  'subscription.completed',
  'subscription.expired',
  'payment.failed',
]);

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    const verification = verifySignature(rawBody, request.headers.get('x-razorpay-signature'));
    if (!verification.ok) return verification.response;

    const event = JSON.parse(rawBody);
    const eventType: string = event?.event ?? 'unknown';

    await dbConnect();

    // Idempotency: claim the event id before applying anything. Razorpay
    // sends x-razorpay-event-id; fall back to a payload hash if absent.
    const eventId =
      request.headers.get('x-razorpay-event-id') ||
      crypto.createHash('sha256').update(rawBody).digest('hex');
    try {
      await ProcessedWebhookEvent.create({ provider: 'razorpay', eventId, eventType });
    } catch (err: any) {
      if (err?.code === 11000) {
        return NextResponse.json({ success: true, skipped: 'duplicate event' });
      }
      throw err;
    }

    // The dedup row is now claimed. If applying the event throws below, the
    // route returns 500 and Razorpay retries — but the retry would hit the
    // 11000 branch above and skip forever, silently losing the activation
    // (paid customer stays locked out). So release the claim on any failure
    // and let the retry re-process from scratch.
    try {
      const subEntity = event?.payload?.subscription?.entity;
      const paymentEntity = event?.payload?.payment?.entity;

      if (HANDLED_EVENTS.has(eventType)) {
        // One set of rules for every event — see lib/billing/subscriptionMachine.ts.
        // Razorpay's event created_at orders out-of-order deliveries.
        const eventAt =
          typeof event?.created_at === 'number' ? new Date(event.created_at * 1000) : new Date();
        await applyRazorpayEvent({
          type: eventType,
          eventAt,
          subEntity,
          paymentEntity,
          source: 'webhook',
          razorpayEventId: request.headers.get('x-razorpay-event-id') ?? undefined,
        });
      }
      // Unhandled event types are acknowledged so Razorpay stops retrying.
    } catch (applyErr: any) {
      // Release the idempotency claim so Razorpay's retry actually re-runs the
      // handler instead of hitting the 11000 skip above. Best-effort — if the
      // delete itself fails we still surface the original error.
      try {
        await ProcessedWebhookEvent.deleteOne({ provider: 'razorpay', eventId });
      } catch (cleanupErr: any) {
        console.error('[billing] failed to release webhook dedup claim:', cleanupErr?.message);
      }
      throw applyErr;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Razorpay webhook error:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
