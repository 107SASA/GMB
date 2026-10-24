import dbConnect from '@/lib/mongodb';
import MessagingSuppression from '@/models/MessagingSuppression';
import ProcessedWebhookEvent from '@/models/ProcessedWebhookEvent';
import { normalizePhoneE164 } from '@/lib/phone';
import { checkRateLimit } from '@/lib/rateLimit';

/**
 * Inbound WhatsApp opt-out (STOP / UNSUBSCRIBE / CANCEL), made reliable:
 *
 *  - Durable first. The webhook applies the opt-out BEFORE it claims the
 *    provider message id as processed (ProcessedWebhookEvent). If anything
 *    fails, the id stays unclaimed, the webhook answers with a retryable
 *    status, and a whatsapp/opt-out.retry Inngest job re-applies it — so a
 *    transient error can never leave a message "processed" with the opt-out
 *    missing.
 *  - Idempotent. Every write is a set-to-true / stop / upsert, so a provider
 *    redelivery, the retry job and the original request can all run without
 *    a duplicate effect (and an opt-out never sends anything).
 *  - Persistent. A MessagingSuppression row per (business, E.164 number) is
 *    written first and checked by every review-request send, so deleting and
 *    re-adding the customer does not make them messageable again.
 *  - Not rate-limited like ordinary messages. The ordinary per-phone cap
 *    (10/min) drops messages; an opt-out has its own, larger allowance, and
 *    past it is still applied unless this process already applied an opt-out
 *    for the same number on the same line in the last 10 minutes.
 */

export const OPT_OUT_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'CANCEL'] as const;
export const OPT_OUT_RETRY_EVENT = 'whatsapp/opt-out.retry';

export function isOptOutKeyword(body: string | null | undefined): boolean {
  return (OPT_OUT_KEYWORDS as readonly string[]).includes((body || '').trim().toUpperCase());
}

/** Which line the STOP arrived on: the shared Growwmatics number, or a business's own number. */
export type OptOutLine = { kind: 'platform' } | { kind: 'tenant'; businessId: string };

/** The E.164 address the senders use for this number (normalizePhoneE164), or a +digits fallback. */
export function suppressionPhone(phone: string): string | null {
  const e164 = normalizePhoneE164(phone);
  if (e164) return e164;
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length >= 8 ? `+${digits}` : null;
}

async function recordSuppression(businessId: string, phone: string, source: 'tenant_number' | 'platform_number', keyword: string, messageId?: string): Promise<void> {
  const phoneE164 = suppressionPhone(phone);
  if (!phoneE164) return;
  await MessagingSuppression.updateOne(
    { businessId, phoneE164, channel: 'whatsapp' },
    { $setOnInsert: { businessId, phoneE164, channel: 'whatsapp', source, keyword, firstMessageId: messageId } },
    { upsert: true }
  ).catch((err: any) => {
    if (err?.code === 11000) return; // a concurrent delivery inserted it first — same result
    throw err;
  });
}

/**
 * True when this number replied STOP to this business. `phone` may be a
 * stored Customer.phone in any legacy format; it is compared as the E.164
 * address the sender would actually use.
 */
export async function isWhatsAppSuppressed(businessId: unknown, phone: string | null | undefined): Promise<boolean> {
  const phoneE164 = phone ? normalizePhoneE164(phone) : null;
  if (!businessId || !phoneE164) return false;
  await dbConnect();
  return !!(await MessagingSuppression.exists({ businessId, phoneE164, channel: 'whatsapp' }));
}

/**
 * Applies the opt-out. Idempotent; throws on any failure (the caller retries).
 *  - tenant line: suppression for that business, its matching customers opted
 *    out and their open review requests stopped;
 *  - platform line: for each business that recently asked this number for a
 *    review on the shared line — suppression, customers, requests — and the
 *    platform Lead opt-out (sales nurture).
 */
export async function applyInboundOptOut(
  line: OptOutLine,
  phone: string,
  meta: { keyword: string; messageId?: string } = { keyword: 'STOP' }
): Promise<{ businesses: number; customers: number; requests: number; leadOptedOut: boolean }> {
  await dbConnect();
  const keyword = (meta.keyword || 'STOP').trim().toUpperCase();
  const { customersAt, recipientRequests, stopCustomers } = await import('@/services/reviews/reviewRecipientInbound');
  // The suppression is written before anything is stopped: a retry after a
  // partial failure must still find the same businesses (a stopped request
  // no longer counts as "still running").
  if (line.kind === 'tenant') {
    await recordSuppression(line.businessId, phone, 'tenant_number', keyword, meta.messageId);
    const customers = await customersAt(phone, line.businessId);
    const res = await stopCustomers(customers.map((c) => String(c._id)));
    return { businesses: 1, ...res, leadOptedOut: false };
  }
  const requests = await recipientRequests(phone);
  const businessIds = Array.from(new Set(requests.map((r) => String(r.businessId))));
  for (const businessId of businessIds) {
    await recordSuppression(businessId, phone, 'platform_number', keyword, meta.messageId);
  }
  const res = await stopCustomers(Array.from(new Set(requests.map((r) => String(r.customerId)))));
  const { optOutLeadByPhone } = await import('@/services/leadOwnership/optOutLead');
  const lead = await optOutLeadByPhone(phone, 'inbound-stop:platform', 'system', { throwOnError: true });
  return { businesses: businessIds.length, ...res, leadOptedOut: lead.changed };
}

// ── Flood allowance for opt-outs (separate from the ordinary message cap) ──

export const OPT_OUT_FLOOD_MAX = 30;
const OPT_OUT_FLOOD_WINDOW_MS = 60_000;
const RECENTLY_APPLIED_MS = 10 * 60_000;
const recentlyApplied = new Map<string, number>();

const lineKey = (line: OptOutLine, phone: string) => `${line.kind === 'tenant' ? line.businessId : 'platform'}:${suppressionPhone(phone) || phone}`;

/** Whether to apply this opt-out now. Past the allowance only a number this process just opted out on this line is skipped. */
export function optOutAllowed(line: OptOutLine, phone: string, now = Date.now()): boolean {
  const key = lineKey(line, phone);
  if (checkRateLimit(`whatsapp-optout:${key}`, OPT_OUT_FLOOD_MAX, OPT_OUT_FLOOD_WINDOW_MS).allowed) return true;
  const last = recentlyApplied.get(key);
  return !(last && now - last < RECENTLY_APPLIED_MS);
}

function markApplied(line: OptOutLine, phone: string, now = Date.now()): void {
  if (recentlyApplied.size > 5000) {
    for (const [k, t] of recentlyApplied) if (now - t >= RECENTLY_APPLIED_MS) recentlyApplied.delete(k);
  }
  recentlyApplied.set(lineKey(line, phone), now);
}

/**
 * The webhook's entry point for an opt-out message, called BEFORE the message
 * id is claimed. Outcomes:
 *  - 'already_processed': this delivery was handled before (the id is claimed only after a successful opt-out);
 *  - 'flood_skipped':     past the opt-out allowance and this number was just opted out on this line;
 *  - 'applied':           durably applied — the caller may now claim the id and route the message;
 *  - 'retry':             failed — leave the id unclaimed and answer with a retryable status; a
 *                         whatsapp/opt-out.retry job was queued as a second path.
 */
export async function handleInboundOptOut(input: {
  provider: 'twilio' | 'meta';
  messageId: string;
  line: OptOutLine;
  phone: string;
  body: string;
}): Promise<'already_processed' | 'flood_skipped' | 'applied' | 'retry'> {
  const { provider, messageId, line, phone, body } = input;
  try {
    await dbConnect();
    if (messageId && await ProcessedWebhookEvent.exists({ provider: `whatsapp-${provider}`, eventId: messageId })) return 'already_processed';
  } catch {
    // Unknown — apply anyway (idempotent).
  }
  if (!optOutAllowed(line, phone)) return 'flood_skipped';
  try {
    const res = await applyInboundOptOut(line, phone, { keyword: body, messageId });
    markApplied(line, phone);
    if (res.customers || res.requests || res.businesses || res.leadOptedOut) {
      console.log(`[whatsapp-opt-out] ${line.kind} STOP applied: ${res.businesses} business(es), ${res.customers} customer(s), ${res.requests} request(s)${res.leadOptedOut ? ', lead opted out' : ''}`);
    }
    return 'applied';
  } catch (err: any) {
    console.error(`[whatsapp-opt-out] ${line.kind} STOP for message ${messageId || '(no id)'} failed — left unprocessed for retry:`, err?.message);
    try {
      const { inngest } = await import('@/services/inngest/client');
      await inngest.send({
        ...(messageId ? { id: `whatsapp-opt-out-${provider}-${messageId}` } : {}),
        name: OPT_OUT_RETRY_EVENT,
        data: { line, phone, keyword: body, messageId, provider },
      });
    } catch (qErr: any) {
      console.error('[whatsapp-opt-out] could not queue the retry job either — relying on provider redelivery:', qErr?.message);
    }
    return 'retry';
  }
}
