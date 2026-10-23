import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import Conversation from '@/models/Conversation';
import Lead from '@/models/Lead';
import LeadEvent from '@/models/LeadEvent';
import ReviewRequest from '@/models/ReviewRequest';
import MessagingSuppression from '@/models/MessagingSuppression';
import { normalizePhoneE164 } from '@/lib/phone';

/**
 * One-off backfill of MessagingSuppression for opt-outs recorded before the
 * collection existed (Segment 3.1). Planning is read-only; applying only
 * inserts missing suppression rows ($setOnInsert upsert on the unique
 * business + number key), so it is idempotent and can be re-run or resumed.
 * It never edits Customer, Lead, ReviewRequest or any other collection — the
 * send-eligibility check brings Customer.optedOut in line on its own.
 *
 * Categories, by strength of evidence:
 *  - tenant_stop:   an inbound STOP / UNSUBSCRIBE / CANCEL stored as a
 *                   Conversation on the business's own number (the tenant
 *                   pipeline logs every inbound message), for that business.
 *  - platform_stop: a platform-number OPT_OUT lead event (reason
 *                   inbound-stop:platform) from a number that had been sent a
 *                   review request on the shared line in the 30 days before
 *                   it — for each business that sent one. Before Segment 3
 *                   that STOP never opted the customer out at all.
 *  - customer_flag_only: Customer.optedOut is true with no STOP evidence —
 *                   it may be an owner's own choice or an import. Making it a
 *                   permanent suppression is a policy decision, so it is only
 *                   written when explicitly selected.
 */

export type BackfillCategory = 'tenant_stop' | 'platform_stop' | 'customer_flag_only';
export const BACKFILL_CATEGORIES: BackfillCategory[] = ['tenant_stop', 'platform_stop', 'customer_flag_only'];

export interface BackfillRow {
  category: BackfillCategory;
  businessId: string;
  phoneE164: string;
  keyword: string;
  evidence: string;
}

export interface BackfillPlan {
  rows: BackfillRow[];
  counts: Record<BackfillCategory, number>;
  alreadySuppressed: number;
  unnormalizablePhones: number;
}

const STOP_TEXT = /^\s*(stop|unsubscribe|cancel)\s*$/i;
const PLATFORM_WINDOW_DAYS = 30;
const key = (businessId: string, phoneE164: string) => `${businessId}|${phoneE164}`;

export async function planSuppressionBackfill(opts: { batchSize?: number } = {}): Promise<BackfillPlan> {
  await dbConnect();
  const batchSize = opts.batchSize ?? 500;
  const found = new Map<string, BackfillRow>();
  let unnormalizablePhones = 0;
  const add = (row: BackfillRow) => { if (!found.has(key(row.businessId, row.phoneE164))) found.set(key(row.businessId, row.phoneE164), row); };

  // 1. tenant_stop — inbound STOP messages logged by the tenant pipeline.
  const stops = Conversation.find({ direction: 'inbound', messageText: { $regex: STOP_TEXT } })
    .select('businessId leadId messageText timestamp').lean().cursor({ batchSize });
  for await (const msg of stops as any) {
    const lead: any = await Lead.findById(msg.leadId).select('phone').lean();
    const phoneE164 = lead?.phone ? normalizePhoneE164(lead.phone) : null;
    if (!phoneE164) { unnormalizablePhones++; continue; }
    add({ category: 'tenant_stop', businessId: String(msg.businessId), phoneE164, keyword: String(msg.messageText).trim().toUpperCase(), evidence: `conversation ${msg._id} at ${new Date(msg.timestamp).toISOString()}` });
  }

  // 2. platform_stop — platform STOP lead events + a review request in the 30 days before.
  const events = LeadEvent.find({ type: 'OPT_OUT', 'payload.reason': 'inbound-stop:platform' })
    .select('phone createdAt').lean().cursor({ batchSize });
  for await (const ev of events as any) {
    const phoneE164 = ev.phone ? normalizePhoneE164(ev.phone) : null;
    if (!phoneE164) { unnormalizablePhones++; continue; }
    const last10 = phoneE164.replace(/\D/g, '').slice(-10);
    const candidates: any[] = await Customer.find({ phone: { $regex: `${last10.split('').join('\\D*')}\\D*$` } }).select('_id phone').lean();
    const customers = candidates.filter((c) => normalizePhoneE164(c.phone || '') === phoneE164);
    if (!customers.length) continue;
    const at = new Date(ev.createdAt);
    const since = new Date(at.getTime() - PLATFORM_WINDOW_DAYS * 86_400_000);
    const requests: any[] = await ReviewRequest.find({
      customerId: { $in: customers.map((c) => c._id) },
      $or: [{ sentAt: { $gte: since, $lte: at } }, { messageHistory: { $elemMatch: { sentAt: { $gte: since, $lte: at } } } }],
    }).select('businessId').lean();
    for (const businessId of new Set(requests.map((r) => String(r.businessId)))) {
      add({ category: 'platform_stop', businessId, phoneE164, keyword: 'STOP', evidence: `lead event ${ev._id} at ${at.toISOString()}` });
    }
  }

  // 3. customer_flag_only — opted out with no STOP evidence above.
  const flagged = Customer.find({ optedOut: true, phone: { $type: 'string' } }).select('businessId phone').lean().cursor({ batchSize });
  for await (const c of flagged as any) {
    const phoneE164 = normalizePhoneE164(c.phone);
    if (!phoneE164) { unnormalizablePhones++; continue; }
    add({ category: 'customer_flag_only', businessId: String(c.businessId), phoneE164, keyword: 'CUSTOMER_FLAG', evidence: `customer ${c._id} optedOut` });
  }

  // Drop what already exists (live STOPs since Segment 3.1, or an earlier run).
  const rows: BackfillRow[] = [];
  let alreadySuppressed = 0;
  const all = Array.from(found.values());
  for (let i = 0; i < all.length; i += batchSize) {
    const chunk = all.slice(i, i + batchSize);
    const existing: any[] = await MessagingSuppression.find({
      channel: 'whatsapp',
      $or: chunk.map((r) => ({ businessId: r.businessId, phoneE164: r.phoneE164 })),
    }).select('businessId phoneE164').lean();
    const have = new Set(existing.map((e) => key(String(e.businessId), e.phoneE164)));
    for (const r of chunk) {
      if (have.has(key(r.businessId, r.phoneE164))) alreadySuppressed++;
      else rows.push(r);
    }
  }
  const counts = { tenant_stop: 0, platform_stop: 0, customer_flag_only: 0 } as Record<BackfillCategory, number>;
  for (const r of rows) counts[r.category]++;
  return { rows, counts, alreadySuppressed, unnormalizablePhones };
}

const SOURCE: Record<BackfillCategory, 'tenant_number' | 'platform_number' | 'legacy_customer_flag'> = {
  tenant_stop: 'tenant_number',
  platform_stop: 'platform_number',
  customer_flag_only: 'legacy_customer_flag',
};

/** Inserts the planned rows of the selected categories that are still missing. Returns how many were inserted. */
export async function applySuppressionBackfill(rows: BackfillRow[], categories: BackfillCategory[], now = new Date()): Promise<{ inserted: number; considered: number }> {
  await dbConnect();
  const selected = rows.filter((r) => categories.includes(r.category));
  let inserted = 0;
  for (let i = 0; i < selected.length; i += 500) {
    const ops = selected.slice(i, i + 500).map((r) => ({
      updateOne: {
        filter: { businessId: r.businessId, phoneE164: r.phoneE164, channel: 'whatsapp' },
        update: { $setOnInsert: { businessId: r.businessId, phoneE164: r.phoneE164, channel: 'whatsapp', source: SOURCE[r.category], keyword: r.keyword, backfill: { category: r.category, evidence: r.evidence, at: now } } },
        upsert: true,
      },
    }));
    try {
      const res = await MessagingSuppression.bulkWrite(ops, { ordered: false });
      inserted += res.upsertedCount ?? 0;
    } catch (err: any) {
      // A live STOP inserted the same key meanwhile: that row is the same result. Anything else is a real error.
      const writeErrors: any[] = err?.writeErrors || err?.result?.result?.writeErrors || [];
      if (!writeErrors.length || writeErrors.some((e) => (e.code ?? e.err?.code) !== 11000)) throw err;
      inserted += err?.result?.upsertedCount ?? err?.result?.nUpserted ?? 0;
    }
  }
  return { inserted, considered: selected.length };
}
