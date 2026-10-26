import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import WhatsAppThread from '@/models/WhatsAppThread';
import WhatsAppMessage from '@/models/WhatsAppMessage';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import { WA_TEMPLATES } from '@/lib/whatsappTemplates';
import { excludedTemplate, inboundText, outboundText } from '@/services/inbox/whatsappLogRules';

/**
 * The record behind the full WhatsApp Inbox: every message on the GrowwMatics
 * platform line, in and out, one thread per phone number.
 *
 *  - Inbound: recordInbound, called by the webhook for every platform-line
 *    message after de-duplication and before any agent routing.
 *  - Outbound: recordOutboundFromQueue, called by the MessageQueue send log
 *    for every new outbound row — so no sender can be missed.
 *
 * Left out: review requests a customer's workspace sends to its own customers
 * (withWhatsAppSendContext({ exclude: 'review-request' }) around those sends,
 * plus the review template SIDs), login codes, and messages to numbers that
 * are not ours — not a platform lead, not a Growwmatics user, and never wrote
 * to us (a customer's own chats with its customers).
 *
 * Recording never throws: a failure is logged and the send / reply goes on.
 */

interface SendContext {
  exclude?: 'review-request' | 'tenant';
  sender?: 'team';
  userId?: string;
  clientKey?: string;
}

const store = new AsyncLocalStorage<SendContext>();

/** Runs `fn` with these facts attached to every WhatsApp send it makes. */
export function withWhatsAppSendContext<T>(ctx: SendContext, fn: () => Promise<T>): Promise<T> {
  return store.run({ ...(store.getStore() || {}), ...ctx }, fn);
}

function sendContext(): SendContext {
  return store.getStore() || {};
}

const PLATFORM = 'gmbboost-internal';

async function upsertThread(input: {
  phone: string;
  phoneKey: string;
  at: Date;
  text: string;
  direction: 'in' | 'out';
  name?: string;
  leadId?: unknown;
  reviewReply?: boolean;
}): Promise<any> {
  const set: Record<string, unknown> = {
    lastMessageAt: input.at,
    lastMessageText: input.text.slice(0, 300),
    lastDirection: input.direction,
  };
  if (input.direction === 'in') {
    set.lastInboundAt = input.at;
    // A new message from the person reopens a resolved chat.
    set.status = 'open';
  }
  if (input.reviewReply) set.reviewReply = true;
  if (input.leadId && mongoose.isValidObjectId(String(input.leadId))) set.leadId = input.leadId;
  const write = () => WhatsAppThread.findOneAndUpdate(
    { phoneKey: input.phoneKey },
    { $set: set, $setOnInsert: { phone: input.phone, name: input.name || '' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  // Two messages for a new number at the same instant: one insert wins, the other updates it.
  const thread: any = await write().catch((err: any) => (err?.code === 11000 ? write() : Promise.reject(err)));
  if (input.name && !thread.name) {
    thread.name = input.name;
    await WhatsAppThread.updateOne({ _id: thread._id }, { $set: { name: input.name } });
  }
  // The account behind the number, for the account purge and the Customer view.
  if (!thread.userId) {
    const { default: User } = await import('@/models/User');
    const user: any = await User.findOne({ phone: input.phone }).select('_id activeBusinessId').lean();
    if (user) {
      thread.userId = user._id;
      thread.businessId = user.activeBusinessId;
      await WhatsAppThread.updateOne({ _id: thread._id }, { $set: { userId: user._id, ...(user.activeBusinessId ? { businessId: user.activeBusinessId } : {}) } });
    }
  }
  return thread;
}

/** One inbound message on the platform line. Idempotent per provider message id. */
export async function recordInbound(input: {
  phone: string;
  body: string;
  profileName?: string;
  providerMessageId?: string;
  mediaCount?: number;
}): Promise<void> {
  try {
    await dbConnect();
    const phone = normalizePhoneE164(input.phone) || input.phone;
    const phoneKey = phoneDedupeKey(phone);
    if (!phoneKey) return;
    if (input.providerMessageId && await WhatsAppMessage.exists({ providerMessageId: input.providerMessageId })) return;
    const { isRecentReviewRecipient } = await import('@/services/reviews/reviewRecipientInbound');
    const { default: Lead } = await import('@/models/Lead');
    const [reviewReply, lead] = await Promise.all([
      isRecentReviewRecipient(phone).catch(() => false),
      Lead.findOne({ phone, tenantId: PLATFORM }).select('_id').lean() as Promise<any>,
    ]);
    const at = new Date();
    const text = inboundText(input.body, input.mediaCount || 0);
    const thread = await upsertThread({ phone, phoneKey, at, text, direction: 'in', name: input.profileName, leadId: lead?._id, reviewReply });
    await WhatsAppMessage.create({
      threadId: thread._id,
      phone,
      phoneKey,
      direction: 'in',
      text,
      sender: 'customer',
      providerMessageId: input.providerMessageId || undefined,
      mediaCount: input.mediaCount || undefined,
      reviewReply: reviewReply || undefined,
      leadId: lead?._id,
      userId: thread.userId,
      businessId: thread.businessId,
      at,
    });
  } catch (err: any) {
    if (err?.code === 11000) return; // the same message, delivered twice
    console.warn('[whatsappLog] inbound not recorded:', err?.message);
  }
}

/** Is this number one of ours — a chat we already have, a platform lead, or a Growwmatics user? */
async function ourNumber(phone: string, phoneKey: string, leadId: unknown): Promise<{ ok: boolean; leadId?: unknown }> {
  const { default: Lead } = await import('@/models/Lead');
  if (leadId && mongoose.isValidObjectId(String(leadId))) {
    const lead: any = await Lead.findById(leadId).select('tenantId').lean();
    // A workspace's own lead: that business talking to its customer.
    if (lead && lead.tenantId !== PLATFORM) return { ok: false };
    if (lead) return { ok: true, leadId };
  }
  if (await WhatsAppThread.exists({ phoneKey })) return { ok: true };
  const platformLead: any = await Lead.findOne({ phone, tenantId: PLATFORM }).select('_id').lean();
  if (platformLead) return { ok: true, leadId: platformLead._id };
  const { default: User } = await import('@/models/User');
  if (await User.exists({ phone })) return { ok: true };
  return { ok: false };
}

/** One new outbound send-log row (MessageQueue). Called by the MessageQueue model. */
export async function recordOutboundFromQueue(row: { _id: unknown; leadId?: unknown; payload?: any; createdAt?: Date }): Promise<void> {
  try {
    const ctx = sendContext();
    if (ctx.exclude) return;
    const payload = row.payload || {};
    if (excludedTemplate(payload.contentSid, WA_TEMPLATES)) return;
    const phone = normalizePhoneE164(payload.phone) || payload.phone;
    const phoneKey = phoneDedupeKey(phone);
    if (!phone || !phoneKey) return;
    await dbConnect();
    const ours = await ourNumber(phone, phoneKey, row.leadId);
    if (!ours.ok) return;
    const at = row.createdAt ? new Date(row.createdAt) : new Date();
    const { text, template } = outboundText(payload, WA_TEMPLATES);
    const thread = await upsertThread({ phone, phoneKey, at, text, direction: 'out', leadId: ours.leadId });
    await WhatsAppMessage.create({
      threadId: thread._id,
      phone,
      phoneKey,
      direction: 'out',
      text,
      sender: ctx.sender === 'team' ? 'team' : 'bot',
      sentByUserId: ctx.userId && mongoose.isValidObjectId(ctx.userId) ? ctx.userId : undefined,
      clientKey: ctx.clientKey || undefined,
      template,
      queueId: row._id,
      leadId: ours.leadId,
      userId: thread.userId,
      businessId: thread.businessId,
      at,
    });
  } catch (err: any) {
    if (err?.code === 11000) return;
    console.warn('[whatsappLog] outbound not recorded:', err?.message);
  }
}

/** The thread for a number, if we have one. */
export async function threadForPhone(phone: string): Promise<any | null> {
  const phoneKey = phoneDedupeKey(phone);
  if (!phoneKey) return null;
  await dbConnect();
  return WhatsAppThread.findOne({ phoneKey });
}

/**
 * Creates a thread for every number that already had a sales, demo, support
 * or report chat before this Inbox existed, so the Inbox is not empty on day
 * one. Existing threads are left alone. Runs once per server process.
 */
let backfill: Promise<void> | null = null;
export function ensureThreadsBackfilled(): Promise<void> {
  if (!backfill) {
    backfill = backfillThreads().catch((err) => {
      console.warn('[whatsappLog] backfill failed:', err?.message);
      backfill = null;
    });
  }
  return backfill;
}

/** The fill itself (idempotent): a thread for every older chat that has none. */
export async function backfillThreads(): Promise<void> {
  await dbConnect();
  const models = await Promise.all([
    import('@/models/SalesConversation'),
    import('@/models/BookingConversation'),
    import('@/models/SupportConversation'),
    import('@/models/ReportConversation'),
  ]);
  const latest = new Map<string, { phone: string; name: string; at: Date; text: string; direction: 'in' | 'out'; inboundAt?: Date; readAt?: Date }>();
  for (const { default: Model } of models) {
    const rows: any[] = await (Model as any).find({ leadPhone: { $exists: true } })
      .select({ leadPhone: 1, leadName: 1, updatedAt: 1, lastReadAt: 1, lastLeadReplyAt: 1, messages: { $slice: -40 } })
      .lean();
    for (const row of rows) {
      const phone = normalizePhoneE164(row.leadPhone) || row.leadPhone;
      const key = phoneDedupeKey(phone);
      if (!key) continue;
      const messages: any[] = row.messages || [];
      const last = messages[messages.length - 1];
      const at = new Date(last?.at || row.updatedAt);
      const lastIn = [...messages].reverse().find((m) => m.role === 'lead')?.at || row.lastLeadReplyAt;
      const prev = latest.get(key);
      const inboundAt = [prev?.inboundAt, lastIn ? new Date(lastIn) : undefined].filter(Boolean).sort((a: any, b: any) => b - a)[0] as Date | undefined;
      if (!prev || at > prev.at) {
        latest.set(key, {
          phone,
          name: row.leadName || prev?.name || '',
          at,
          text: String(last?.text || '').slice(0, 300),
          direction: last?.role === 'lead' ? 'in' : 'out',
          inboundAt,
          readAt: row.lastReadAt || prev?.readAt,
        });
      } else if (inboundAt) {
        prev.inboundAt = inboundAt;
      }
    }
  }
  if (!latest.size) return;
  const ops = [...latest.entries()].map(([phoneKey, t]) => ({
    updateOne: {
      filter: { phoneKey },
      update: {
        $setOnInsert: {
          phone: t.phone,
          name: t.name,
          lastMessageAt: t.at,
          lastMessageText: t.text,
          lastDirection: t.direction,
          ...(t.inboundAt ? { lastInboundAt: t.inboundAt } : {}),
          // Chats from before the Inbox are not all shown as unread at once.
          lastReadAt: t.readAt || t.at,
          status: 'open',
        },
      },
      upsert: true,
    },
  }));
  for (let i = 0; i < ops.length; i += 500) await WhatsAppThread.bulkWrite(ops.slice(i, i + 500), { ordered: false });
}
