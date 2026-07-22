import { NextResponse } from 'next/server';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import ProcessedWebhookEvent from '@/models/ProcessedWebhookEvent';
import { activatePlan, cancelPlan, markPastDue } from '@/lib/billing/applyEntitlements';
import { isPaidPlanType } from '@/lib/billing/planCatalog';

export const dynamic = 'force-dynamic';

/**
 * Razorpay webhook — the ONLY place entitlements change in response to
 * payments. Requirements honored here:
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

/** Razorpay subscription entity → the Growwmatic AI user it belongs to. */
async function resolveUserId(subEntity: any): Promise<string | null> {
  const fromNotes = subEntity?.notes?.userId;
  if (typeof fromNotes === 'string' && fromNotes) return fromNotes;

  if (subEntity?.id) {
    const doc = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id })
      .select('userId')
      .lean() as any;
    if (doc?.userId) return doc.userId.toString();
  }
  return null;
}

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

    const subEntity = event?.payload?.subscription?.entity;
    const paymentEntity = event?.payload?.payment?.entity;

    switch (eventType) {
      case 'subscription.activated':
      case 'subscription.charged': {
        const userId = await resolveUserId(subEntity);
        // planType comes from the notes we set at checkout ('Pro', or
        // 'Enterprise' on legacy subscriptions) — validated, never trusted
        // blindly. Either way there is only one paid plan to activate.
        if (!userId || !isPaidPlanType(subEntity?.notes?.planType)) {
          console.error(`[billing] ${eventType}: cannot resolve user/plan`, subEntity?.id);
          break;
        }
        await activatePlan(userId, {
          razorpaySubscriptionId: subEntity.id,
          currentPeriodEnd:
            typeof subEntity.current_end === 'number'
              ? new Date(subEntity.current_end * 1000)
              : undefined,
        });
        break;
      }

      case 'payment.failed':
      case 'subscription.halted': {
        const userId = await resolveUserId(subEntity ?? { notes: paymentEntity?.notes });
        if (!userId) {
          console.warn(`[billing] ${eventType}: cannot resolve user — ignoring`);
          break;
        }
        await markPastDue(userId);
        break;
      }

      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.expired': {
        const userId = await resolveUserId(subEntity);
        if (!userId) {
          console.warn(`[billing] ${eventType}: cannot resolve user — ignoring`);
          break;
        }
        await cancelPlan(userId);
        break;
      }

      default:
        // Unhandled event types are acknowledged so Razorpay stops retrying.
        break;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Razorpay webhook error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
