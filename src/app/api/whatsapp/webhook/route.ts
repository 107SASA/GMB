import { NextResponse } from 'next/server';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import ConversationThread from '@/models/ConversationThread';
import Business from '@/models/Business';
import Conversation from '@/models/Conversation';
import MessageQueue from '@/models/MessageQueue';
import { inngest } from '@/services/inngest/client';
import Customer from '@/models/Customer';
import { validateTwilioSignature } from '@/lib/twilioSignature';

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
        const business = await findBusinessByNumber(displayNumber, phoneNumberId);
        if (!business) {
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

    const business = await findBusinessByNumber(toPayload || '');
    if (!business) {
      console.error(`No business found mapped to WhatsApp number: ${toPayload}`);
      return twimlOk();
    }

    const verification = await validateTwilioSignature(req, formData, (business.integrations as any)?.twilioAuthToken);
    if (!verification.ok) return verification.response;

    await processInboundMessage({
      business,
      phone,
      profileName: profileName || '',
      body: body || '',
      messageSid: messageSid || '',
      numMedia,
    });

    // Return instant 200 OK to Twilio (Empty TwiML)
    return twimlOk();
  } catch (error) {
    console.error('Webhook Error:', error);
    // Still return 200 to prevent Twilio retry loops
    return twimlOk();
  }
}
