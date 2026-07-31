import { NextResponse } from 'next/server';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import SalesConversation from '@/models/SalesConversation';
import ConversationThread from '@/models/ConversationThread';
import Business from '@/models/Business';
import Conversation from '@/models/Conversation';
import MessageQueue from '@/models/MessageQueue';
import { inngest } from '@/services/inngest/client';
import Customer from '@/models/Customer';
import { validateTwilioSignature } from '@/lib/twilioSignature';
import { sendOutboundMessage } from '@/services/whatsapp/send';

export const dynamic = 'force-dynamic';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twimlOk = () => new NextResponse(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } });

/**
 * Meta webhook verification handshake: Meta calls GET with
 * hub.mode/hub.verify_token/hub.challenge when you register the webhook URL.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: 'Webhook verification failed' }, { status: 403 });
}

export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return handleMetaWebhook(req);
  }
  return handleTwilioWebhook(req);
}

// ---------------------------------------------------------------------------
// Shared inbound pipeline (lead → thread → opt-out → Inngest event). The
// event payload shape is identical for both providers so downstream Inngest
// functions (AI agent, CRM hooks) are provider-agnostic.
// ---------------------------------------------------------------------------

interface InboundMessage {
  business: any;
  phone: string; // E.164 with '+'
  profileName: string;
  body: string;
  messageSid: string;
  numMedia: number;
}

async function processInboundMessage({ business, phone, profileName, body, messageSid, numMedia }: InboundMessage) {
  const tenantId = business.organizationId.toString();
  const businessId = business._id;

  // 0. Platform SALES-AGENT interception. If this phone is in an active
  // post-audit sales conversation, route it to the sales agent instead of the
  // owner's customer agent. Matched on the last-10-digits key so signup vs
  // inbound phone-format differences still collide. Takes priority while active.
  const { phoneDedupeKey } = await import('@/lib/phone');
  const salesConvo = await SalesConversation.findOne({ phoneKey: phoneDedupeKey(phone), status: 'active' });
  if (salesConvo) {
    const normalized = body.trim().toUpperCase();
    if (['STOP', 'UNSUBSCRIBE', 'CANCEL'].includes(normalized)) {
      salesConvo.status = 'stopped';
      await salesConvo.save();
      return;
    }
    salesConvo.messages.push({ role: 'lead', text: body, at: new Date() });
    salesConvo.lastLeadReplyAt = new Date();
    await salesConvo.save();
    await inngest.send({ name: 'sales/agent.reply', data: { conversationId: salesConvo._id.toString(), body } });
    return;
  }

  // 1. Fetch or Create Lead
  let lead = await Lead.findOne({ phone, businessId });
  if (!lead) {
    lead = await Lead.create({
      tenantId,
      businessId,
      name: profileName || phone,
      phone,
      source: 'WhatsApp',
      pipelineStage: 'New',
      status: 'active'
    });

    // Trigger CRM module lead creation hook
    await inngest.send({
      name: 'crm/lead-created',
      data: { leadId: lead._id.toString() }
    });
  }

  // 2. Fetch or Create Conversation Thread
  let thread = await ConversationThread.findOne({ leadId: lead._id });
  if (!thread) {
    thread = await ConversationThread.create({
      tenantId,
      businessId,
      leadId: lead._id,
      unreadCount: 1,
      lastMessage: numMedia > 0 ? '[Media]' : body,
      aiEnabled: true // AI is ON by default
    });
  } else {
    thread.unreadCount += 1;
    thread.lastMessage = numMedia > 0 ? '[Media]' : body;
    thread.lastActivityAt = new Date();
    await thread.save();
  }

  // 2.5 Opt-out processing (Module 9)
  const normalizedBody = body.trim().toUpperCase();
  if (['STOP', 'UNSUBSCRIBE', 'CANCEL'].includes(normalizedBody)) {
    await Customer.findOneAndUpdate(
      { phone, businessId },
      { optedOut: true }
    );
    // We can also disable AI for the thread so the bot doesn't reply
    thread.aiEnabled = false;
    await thread.save();
  }

  // 3. Immediately queue async AI processing
  await inngest.send({
    name: 'whatsapp/incoming',
    data: {
      messageSid,
      from: `whatsapp:${phone}`,
      body,
      profileName,
      numMedia,
      leadId: lead._id.toString(),
      threadId: thread._id.toString(),
      tenantId,
      businessId: businessId.toString()
    }
  });
}

// ---------------------------------------------------------------------------
// Platform (GrowwMatics-owned) inbound pipeline. The public "Book a Demo" CTA
// and the post-audit sales nurture both run on ONE GrowwMatics WhatsApp number
// (owner-only line — never a tenant's). Any message to it routes here:
//   • active post-audit sales conversation → SALES agent
//   • otherwise                            → BOOKING agent (demo bookings)
// ---------------------------------------------------------------------------

/** True when an inbound message hit the GrowwMatics platform number. */
function isPlatformNumber(displayNumber?: string, phoneNumberId?: string): boolean {
  const pid = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (phoneNumberId && pid && phoneNumberId === pid) return true;

  const configured = (process.env.PLATFORM_WHATSAPP_NUMBER || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '')
    .replace(/[^\d]/g, '');
  if (!configured) return false;
  const incoming = (displayNumber || '').replace(/[^\d]/g, '');
  return incoming.length > 0 && incoming === configured;
}

interface PlatformInbound {
  phone: string; // E.164 with '+'
  profileName: string;
  body: string;
  messageSid: string;
}

/**
 * First-touch intent for a phone with no active conversation of any kind.
 * Matches the distinct CTA strings first (bookDemoLink / boostProfileLink in
 * src/lib/whatsappCta.ts), then falls back to loose keyword matching so a
 * reply to the menu (e.g. "1", "report") still routes correctly.
 */
function classifyIntent(body: string): 'report' | 'booking' | 'unknown' {
  const text = (body || '').trim().toLowerCase();
  if (!text) return 'unknown';
  if (text === '1' || /\b(report|profile|boost|rank)\b/.test(text)) return 'report';
  if (text === '2' || /\b(demo|book)\b/.test(text)) return 'booking';
  return 'unknown';
}

const INTENT_MENU_MESSAGE =
  'Hi! 👋 Want to:\n1️⃣ Get a *free Google Business report*\n2️⃣ *Book a demo*\n\nJust reply 1 or 2.';

async function processPlatformInbound({ phone, profileName, body }: PlatformInbound) {
  const { phoneDedupeKey, normalizePhoneE164 } = await import('@/lib/phone');
  const key = phoneDedupeKey(phone);
  const normalized = (body || '').trim().toUpperCase();
  const isOptOut = ['STOP', 'UNSUBSCRIBE', 'CANCEL'].includes(normalized);

  // 1. Post-audit SALES nurture takes priority while active.
  const salesConvo = await SalesConversation.findOne({ phoneKey: key, status: 'active' });
  if (salesConvo) {
    if (isOptOut) {
      salesConvo.status = 'stopped';
      await salesConvo.save();
      return;
    }
    salesConvo.messages.push({ role: 'lead', text: body, at: new Date() });
    salesConvo.lastLeadReplyAt = new Date();
    await salesConvo.save();
    await inngest.send({ name: 'sales/agent.reply', data: { conversationId: salesConvo._id.toString(), body } });
    return;
  }

  // 2. An active demo-booking thread wins next.
  const { default: BookingConversation } = await import('@/models/BookingConversation');
  const activeBooking = await BookingConversation.findOne({ phoneKey: key, status: 'active' });
  if (activeBooking) {
    if (isOptOut) {
      activeBooking.status = 'stopped';
      await activeBooking.save();
      return;
    }
    if (!activeBooking.leadName && profileName) activeBooking.leadName = profileName;
    activeBooking.messages.push({ role: 'lead', text: body, at: new Date() });
    await activeBooking.save();
    await inngest.send({ name: 'booking/agent.reply', data: { conversationId: activeBooking._id.toString(), body } });
    return;
  }

  // 3. An active (not yet claimed/stopped) report thread wins next.
  const { default: ReportConversation } = await import('@/models/ReportConversation');
  const activeReport = await ReportConversation.findOne({ phoneKey: key, status: { $ne: 'stopped' } });
  if (activeReport) {
    if (isOptOut) {
      activeReport.status = 'stopped';
      await activeReport.save();
      return;
    }
    if (!activeReport.leadName && profileName) activeReport.leadName = profileName;
    activeReport.messages.push({ role: 'lead', text: body, at: new Date() });
    await activeReport.save();
    await inngest.send({ name: 'report/agent.reply', data: { conversationId: activeReport._id.toString(), body } });
    return;
  }

  if (isOptOut) return; // Nothing active to stop.

  // 4. Brand-new thread — classify by the CTA's prefilled text (or a reply to
  // the menu below), rather than defaulting to one agent over the other.
  const intent = classifyIntent(body);

  if (intent === 'report') {
    const convo = await ReportConversation.create({
      leadPhone: normalizePhoneE164(phone) || phone,
      phoneKey: key,
      leadName: profileName || '',
      status: 'awaiting_connection',
      messages: [{ role: 'lead', text: body, at: new Date() }],
    });
    await inngest.send({ name: 'report/agent.reply', data: { conversationId: convo._id.toString(), body } });
    return;
  }

  if (intent === 'booking') {
    const convo = await BookingConversation.create({
      leadPhone: normalizePhoneE164(phone) || phone,
      phoneKey: key,
      leadName: profileName || '',
      status: 'active',
      messages: [{ role: 'lead', text: body, at: new Date() }],
    });
    await inngest.send({ name: 'booking/agent.reply', data: { conversationId: convo._id.toString(), body } });
    return;
  }

  // Unmatched free text with nothing active — ask rather than guess. No
  // conversation is created yet, so their next reply re-enters this branch.
  await sendOutboundMessage(phone, INTENT_MENU_MESSAGE);
}

/**
 * Map an inbound business phone number to a Business. Numbers may arrive
 * with/without '+' or 'whatsapp:' prefix depending on provider.
 */
async function findBusinessByNumber(rawNumber: string, phoneNumberId?: string) {
  const stripped = rawNumber.replace(/^whatsapp:/i, '').trim();
  const digits = stripped.replace(/[^\d]/g, '');
  const candidates = [...new Set([stripped, digits, `+${digits}`])].filter(Boolean);

  const or: any[] = [
    { 'integrations.whatsappNumber': { $in: candidates } },
    { 'whatsappConfig.businessPhone': { $in: candidates } },
  ];
  if (phoneNumberId) or.unshift({ 'whatsappConfig.phoneNumberId': phoneNumberId });

  return Business.findOne({ $or: or });
}

// ---------------------------------------------------------------------------
// Meta WhatsApp Cloud API (JSON payloads)
// ---------------------------------------------------------------------------

function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    if (process.env.NODE_ENV === 'production') return false;
    console.warn('[meta-webhook] META_APP_SECRET not set — skipping signature validation in development');
    return true;
  }
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  } catch {
    return false;
  }
}

/** Meta delivery receipts → keep Conversation/MessageQueue statuses current. */
async function applyMetaStatus(status: any) {
  const wamid = status?.id;
  const state = status?.status; // sent | delivered | read | failed
  if (!wamid || !state) return;

  if (['delivered', 'read', 'failed'].includes(state)) {
    await Conversation.updateMany({ twilioSid: wamid }, { messageStatus: state });
  }
  if (state === 'failed') {
    const reason = status?.errors?.[0]?.message || status?.errors?.[0]?.title || 'Delivery failed';
    await MessageQueue.updateMany(
      { 'payload.sid': wamid },
      { status: 'FAILED', failedReason: reason }
    );
    console.error(`[meta-webhook] message ${wamid} failed: ${reason}`);
  }
}

async function handleMetaWebhook(req: Request) {
  try {
    const rawBody = await req.text();

    if (!verifyMetaSignature(rawBody, req.headers.get('x-hub-signature-256'))) {
      return NextResponse.json({ error: 'Invalid Meta signature' }, { status: 403 });
    }

    const payload = JSON.parse(rawBody);
    if (payload.object !== 'whatsapp_business_account') {
      return NextResponse.json({ ok: true });
    }

    await dbConnect();

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value || {};

        // Delivery receipts for outbound messages
        for (const status of value.statuses || []) {
          try {
            await applyMetaStatus(status);
          } catch (e) {
            console.error('[meta-webhook] status update error:', e);
          }
        }

        const messages = value.messages || [];
        if (!messages.length) continue;

        const displayNumber = value.metadata?.display_phone_number || '';
        const phoneNumberId = value.metadata?.phone_number_id;

        // GrowwMatics-owned line → sales/booking agents. Otherwise a tenant.
        const platform = isPlatformNumber(displayNumber, phoneNumberId);
        const business = platform ? null : await findBusinessByNumber(displayNumber, phoneNumberId);
        if (!platform && !business) {
          console.error(`[meta-webhook] No business mapped to WhatsApp number ${displayNumber} (phone_number_id: ${phoneNumberId})`);
          continue;
        }

        for (const message of messages) {
          const waId = message.from || '';
          if (!waId) continue;
          const phone = `+${waId.replace(/[^\d]/g, '')}`;
          const contact = (value.contacts || []).find((c: any) => c.wa_id === waId) || value.contacts?.[0];
          const profileName = contact?.profile?.name || '';

          const isText = message.type === 'text';
          const body = isText
            ? message.text?.body || ''
            : message[message.type]?.caption || message.button?.text || message.interactive?.button_reply?.title || '';
          const numMedia = ['image', 'video', 'audio', 'document', 'sticker'].includes(message.type) ? 1 : 0;

          if (platform) {
            await processPlatformInbound({ phone, profileName, body, messageSid: message.id || '' });
          } else {
            await processInboundMessage({
              business,
              phone,
              profileName,
              body,
              messageSid: message.id || '',
              numMedia,
            });
          }
        }
      }
    }

    // Always 200 — Meta retries aggressively and disables webhooks that keep failing
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[meta-webhook] Error:', error);
    return NextResponse.json({ ok: true });
  }
}

// ---------------------------------------------------------------------------
// Legacy Twilio webhook (form-encoded) — kept for provider rollback
// ---------------------------------------------------------------------------

async function handleTwilioWebhook(req: Request) {
  try {
    // Twilio sends form data
    const formData = await req.formData();

    const messageSid = formData.get('MessageSid') as string;
    const from = formData.get('From') as string;
    const toPayload = formData.get('To') as string;
    const body = formData.get('Body') as string;
    const profileName = formData.get('ProfileName') as string;
    const numMedia = parseInt(formData.get('NumMedia') as string || '0', 10);

    if (!from) return twimlOk();

    const phone = from.replace('whatsapp:', '');

    await dbConnect();

    // GrowwMatics-owned line → sales/booking agents. Otherwise a tenant.
    const platform = isPlatformNumber(toPayload || '');
    const business = platform ? null : await findBusinessByNumber(toPayload || '');
    if (!platform && !business) {
      console.error(`No business found mapped to WhatsApp number: ${toPayload}`);
      return twimlOk();
    }

    const authToken = platform
      ? process.env.TWILIO_AUTH_TOKEN
      : (business!.integrations as any)?.twilioAuthToken;
    const verification = await validateTwilioSignature(req, formData, authToken);
    if (!verification.ok) return verification.response;

    if (platform) {
      await processPlatformInbound({
        phone,
        profileName: profileName || '',
        body: body || '',
        messageSid: messageSid || '',
      });
    } else {
      await processInboundMessage({
        business,
        phone,
        profileName: profileName || '',
        body: body || '',
        messageSid: messageSid || '',
        numMedia,
      });
    }

    // Return instant 200 OK to Twilio (Empty TwiML)
    return twimlOk();
  } catch (error) {
    console.error('Webhook Error:', error);
    // Still return 200 to prevent Twilio retry loops
    return twimlOk();
  }
}
