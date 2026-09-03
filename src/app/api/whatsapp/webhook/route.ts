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
import SupportConversation from '@/models/SupportConversation';
import User from '@/models/User';
import { validateTwilioSignature } from '@/lib/twilioSignature';
import { sendOutboundMessage } from '@/services/whatsapp/send';
import { checkRateLimit } from '@/lib/rateLimit';
import ProcessedWebhookEvent from '@/models/ProcessedWebhookEvent';
import { SUPPORT_MESSAGE } from '@/lib/whatsappCta';

export const dynamic = 'force-dynamic';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twimlOk = () => new NextResponse(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } });

// Keyword signal that a lead mid-sales-chat now wants an actual demo booked
// rather than more nurture — same booking keywords classifyIntent() below
// uses for a brand-new thread, so a lead reads as consistent whichever path
// they came in through. Deliberately keyword-based (not an extra AI call) so
// the handoff is instant and free; a bare "yes"/"2pm" reply to the agent's
// own offer of a demo isn't caught by this and still gets answered by the
// sales agent's (now link/time-fabrication-proof) prompt instead — see
// composeAgentReply in services/sales/salesAgent.ts.
const BOOKING_HANDOFF_RE = /\b(demo|book|schedule|walkthrough|screen.?share)\b/i;

/**
 * Shared by both inbound pipelines below (tenant and platform) so the STOP
 * handling and the consent gate can't drift between the two copies the way
 * the legacy Twilio route drifted from the unified handler.
 *
 * `allowBookingHandoff` — only true on the platform pipeline (see
 * processPlatformInbound), where a demo booking is a real, meaningful thing
 * to hand off to (BookingConversation/DemoBooking). The tenant pipeline has
 * no such concept for a business's own customers, so it's left false there
 * and behaves exactly as before.
 *
 * Returns true if this phone had an active SalesConversation and the message
 * was fully handled here (caller should stop processing it any further).
 */
async function handleActiveSalesConversation(
  salesConvo: any,
  body: string,
  opts: { allowBookingHandoff?: boolean } = {}
): Promise<boolean> {
  const normalized = body.trim().toUpperCase();
  if (['STOP', 'UNSUBSCRIBE', 'CANCEL'].includes(normalized)) {
    salesConvo.status = 'stopped';
    await salesConvo.save();
    // NOTE: the Lead-level opt-out (nurtureStatus='OPTED_OUT' + scheduled-
    // action cancellation) is handled by the caller — processPlatformInbound
    // does it for every platform STOP before this runs (see that function).
    // The tenant pipeline (allowBookingHandoff:false) has no platform Lead to
    // opt out, so nothing to do here either way.
    return true;
  }

  // Booking intent wins over more nurture: a lead who explicitly asks to
  // book/schedule a demo gets moved to the real Booking Agent (grounded
  // date/time handling, files a DemoBooking + CRM lead on completion)
  // instead of the Sales Agent improvising a meeting it can't actually keep
  // — see PRODUCTION_READINESS / Aug 2026 fix notes for the incident this
  // closes (fabricated /demo-call link, a "2 PM" offered at 11:42 PM, and no
  // booking record ever created).
  if (opts.allowBookingHandoff && salesConvo.consentStatus !== 'pending' && BOOKING_HANDOFF_RE.test(body)) {
    salesConvo.status = 'handed_off';
    salesConvo.messages.push({ role: 'lead', text: body, at: new Date() });
    await salesConvo.save();

    const { phoneDedupeKey } = await import('@/lib/phone');
    const { default: BookingConversation } = await import('@/models/BookingConversation');
    const convo = await BookingConversation.create({
      leadPhone: salesConvo.leadPhone,
      phoneKey: phoneDedupeKey(salesConvo.leadPhone),
      leadName: salesConvo.leadName,
      status: 'active',
      messages: [{ role: 'lead', text: body, at: new Date() }],
    });
    await inngest.send({ name: 'booking/agent.reply', data: { conversationId: convo._id.toString(), body } });

    const { logLeadEvent } = await import('@/services/leadEvents');
    logLeadEvent(
      'AGENT_HANDOFF',
      { from: 'sales-agent', to: 'booking-agent', reason: 'booking_keyword_match', fromConversationId: salesConvo._id, toConversationId: convo._id },
      'sales-agent',
      { phone: salesConvo.leadPhone, conversationType: 'sales', conversationId: salesConvo._id }
    );
    return true;
  }

  if (salesConvo.consentStatus === 'pending') {
    const { isAffirmativeReply } = await import('@/lib/whatsappConsent');
    salesConvo.messages.push({ role: 'lead', text: body, at: new Date() });
    salesConvo.lastLeadReplyAt = new Date();
    if (isAffirmativeReply(body)) {
      salesConvo.consentStatus = 'granted';
      await salesConvo.save();
      await inngest.send({ name: 'sales/nurture.consented', data: { conversationId: salesConvo._id.toString() } });
    } else {
      // Not a yes — stay silent rather than re-nudging (avoids turning the
      // consent ask itself into the unsolicited-message problem it exists
      // to prevent). They can still say "yes" later; nothing expires this.
      await salesConvo.save();
    }
    return true;
  }

  salesConvo.messages.push({ role: 'lead', text: body, at: new Date() });
  salesConvo.lastLeadReplyAt = new Date();
  await salesConvo.save();
  await inngest.send({ name: 'sales/agent.reply', data: { conversationId: salesConvo._id.toString(), body } });
  return true;
}

// Both providers retry aggressively on anything slower than their own
// timeout, and Meta disables webhooks that keep failing — so a redelivery of
// the exact same message is a routine, expected event, not an edge case.
// Reuses the same (provider, eventId) unique-index claim pattern already
// proven for the Razorpay webhook (src/app/api/webhook/razorpay/route.ts):
// the insert IS the atomicity guarantee — a concurrent/replayed delivery
// hits the duplicate-key error and is skipped, which a "does it already
// exist" read-then-write check can't guarantee under a race. Checked before
// the rate limiter and before either processing function, so a redelivery
// never reaches Groq or a second outbound send, and never spends the
// sender's rate-limit budget either.
async function isDuplicateInboundMessage(provider: 'twilio' | 'meta', messageId: string): Promise<boolean> {
  if (!messageId) return false; // nothing to key on — never treat as a duplicate
  try {
    await ProcessedWebhookEvent.create({ provider: `whatsapp-${provider}`, eventId: messageId });
    return false; // first time we've seen this id — claimed, proceed
  } catch (err: any) {
    if (err?.code === 11000) {
      console.warn(`[whatsapp-webhook] duplicate delivery of message ${messageId} (${provider}) — skipping, no second reply.`);
      return true;
    }
    throw err;
  }
}

// Per-phone abuse cap on INBOUND processing, checked before either provider's
// message reaches processInboundMessage/processPlatformInbound — i.e. before
// any Groq call or outbound send is queued. A real conversation partner never
// approaches this; a script hammering the webhook does. Deliberately
// drop-and-log rather than reject with an error status: an error response
// would make Twilio/Meta retry the same message, compounding the flood
// instead of absorbing it — the provider still gets its normal 200/TwiML ack.
const INBOUND_MESSAGE_MAX = 10;
const INBOUND_MESSAGE_WINDOW_MS = 60 * 1000;

function isInboundMessageAllowed(phone: string, messageSid: string): boolean {
  const result = checkRateLimit(`whatsapp-inbound:${phone}`, INBOUND_MESSAGE_MAX, INBOUND_MESSAGE_WINDOW_MS);
  if (!result.allowed) {
    console.warn(
      `[whatsapp-webhook] rate limit exceeded for ${phone} — dropping message ` +
      `${messageSid || '(no sid)'}, retry after ${result.retryAfterSeconds}s. No Groq call, no outbound send.`
    );
  }
  return result.allowed;
}

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
    await handleActiveSalesConversation(salesConvo, body);
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
      // pipelineStage is the legacy free-Kanban field (business.kanbanColumns);
      // lifeCycleStage/subStage is the current stage system every other lead
      // -creation path (quick-add, bulk-import, CSV import) uses. Leaving
      // pipelineStage unset here keeps this lead consistent with those, and
      // with the admin CRM Monitor's conversion stats which read lifeCycleStage.
      pipelineStage: null,
      lifeCycleStage: 'initial',
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
// Platform (GrowwMatics-owned) inbound pipeline. The public "Book a Demo" CTA,
// the post-audit sales nurture, the free-report flow, and the mobile app's
// "Help" button all run on ONE GrowwMatics WhatsApp number (owner-only line —
// never a tenant's). Any message to it routes here:
//   • active post-audit sales conversation      → SALES agent
//   • active booking/report/support thread      → that agent (or, for
//     support, just logged for a human — see SupportConversation)
//   • an existing, verified GrowwMatics customer → SUPPORT agent, always
//     (never the prospect report/demo menu below)
//   • otherwise, brand-new thread                → classified by keyword/CTA
//     text into report / booking / support / unknown (menu)
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
function classifyIntent(body: string): 'report' | 'booking' | 'support' | 'unknown' {
  const text = (body || '').trim().toLowerCase();
  if (!text) return 'unknown';
  // Exact-match first (SUPPORT_MESSAGE/BOOST_PROFILE_MESSAGE from
  // lib/whatsappCta.ts — the mobile Help button and marketing CTAs send
  // these verbatim), then loose keywords for a reply typed by hand.
  if (text === SUPPORT_MESSAGE.toLowerCase() || /\b(help|support|issue|problem)\b/.test(text) || text.includes('not working')) {
    return 'support';
  }
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

  // A platform-line STOP opts the Lead out at the Lead level regardless of
  // which (if any) conversation is currently active — every branch below
  // that handles isOptOut only stands down its own conversation. Best-effort.
  if (isOptOut) {
    const { optOutLeadByPhone } = await import('@/services/leadOwnership/optOutLead');
    await optOutLeadByPhone(phone, 'inbound-stop:platform', 'system');
  }

  // 1. Post-audit SALES nurture takes priority while active.
  const salesConvo = await SalesConversation.findOne({ phoneKey: key, status: 'active' });
  if (salesConvo) {
    await handleActiveSalesConversation(salesConvo, body, { allowBookingHandoff: true });
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

  // 3.5. An active support thread. Pre-sale prospects: append and wait for
  // a human, don't re-fire the AI acknowledgment on every follow-up message
  // (one-shot "we've got it" reply, not a multi-turn conversation like
  // sales/booking/report — repeating it on each message would read as the
  // bot ignoring them). Phase 8: a paying customer (Lead.currentAgent ===
  // 'IN_HOUSE') is the exception — see the currentAgent check below.
  const activeSupport = await SupportConversation.findOne({ phoneKey: key, status: 'active' });
  if (activeSupport) {
    if (isOptOut) {
      activeSupport.status = 'closed';
      await activeSupport.save();
      return;
    }
    activeSupport.messages.push({ role: 'lead', text: body, at: new Date() });
    await activeSupport.save();

    // Phase 8: a paying customer (Lead.currentAgent === 'IN_HOUSE') gets a
    // REAL multi-turn conversation with the In-House Agent — re-fire
    // support/agent.reply on every turn, not just the first. A pre-sale
    // prospect (any other currentAgent, or no Lead at all yet) keeps the
    // exact pre-Phase-8 behavior: append only, no re-fire, human takes over
    // via WhatsApp Business app/Meta Business Suite directly.
    const normalizedForLead = normalizePhoneE164(phone) || phone;
    const lead = await Lead.findOne({ phone: normalizedForLead, tenantId: 'gmbboost-internal' }).select('currentAgent').lean() as any;
    if (lead?.currentAgent === 'IN_HOUSE') {
      await inngest.send({ name: 'support/agent.reply', data: { conversationId: activeSupport._id.toString(), body } });
    }
    return;
  }

  if (isOptOut) return; // Nothing active to stop.

  // 3.7. An existing, verified GrowwMatics customer messaging this line —
  // always route to support, even if their wording doesn't match the
  // support keywords below (a real customer should never see the "want a
  // free report or a demo?" menu meant for prospects).
  const existingUser = await User.findOne({ phone: normalizePhoneE164(phone) || phone, isPhoneVerified: true })
    .select('_id activeBusinessId')
    .lean() as any;

  // 4. Brand-new thread — classify by the CTA's prefilled text (or a reply to
  // the menu below), rather than defaulting to one agent over the other.
  const intent = existingUser ? 'support' : classifyIntent(body);

  if (intent === 'support') {
    const convo = await SupportConversation.create({
      leadPhone: normalizePhoneE164(phone) || phone,
      phoneKey: key,
      leadName: profileName || '',
      status: 'active',
      messages: [{ role: 'lead', text: body, at: new Date() }],
      userId: existingUser?._id,
      businessId: existingUser?.activeBusinessId,
    });
    await inngest.send({ name: 'support/agent.reply', data: { conversationId: convo._id.toString() } });
    return;
  }

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

  // P0 FIX (post-implementation-audit) — this static menu send bypasses
  // every agent-reply function entirely (it's not composed by
  // salesAgentReply/supportAgentReply/reportAgentReply/bookingAgentReply,
  // all of which now check isHumanOwned before sending), so it had no
  // human-handoff awareness of its own. Reachable for a phone with no
  // currently-active conversation of any type (all four branches above
  // fell through) — which a HUMAN-owned lead can genuinely be in, e.g. once
  // their SalesConversation completed/handed_off or their
  // SupportConversation closed, while currentAgent stays 'HUMAN' until an
  // explicit admin "Return to AI" release. A normal, never-contacted phone
  // (the overwhelmingly common case here) has no matching Lead and proceeds
  // exactly as before — read-only lookup, never creates a Lead.
  const { isHumanOwned } = await import('@/services/agentHandoff/isHumanOwned');
  const menuLead = await Lead.findOne({ phone: normalizePhoneE164(phone) || phone, tenantId: 'gmbboost-internal' }).select('currentAgent humanHandoff').lean() as any;
  if (isHumanOwned(menuLead)) return;

  // Unmatched free text with nothing active — ask rather than guess. No
  // conversation is created yet, so their next reply re-enters this branch.
  await sendOutboundMessage(phone, INTENT_MENU_MESSAGE);
}

// ---------------------------------------------------------------------------
// Shadow-mode ownership observation (LEAD_ENGINE_V2 groundwork). Called AFTER
// processPlatformInbound() above has fully executed — it does NOT change,
// short-circuit, or feed back into that function's routing decision in any
// way; it independently re-queries the same four legacy collections
// (read-only, same pattern processPlatformInbound itself uses) to see which
// one is active *now* that processing has finished, and records that onto
// Lead.currentAgent via setLeadOwnership().
//
// This write happens unconditionally (it's just data collection, not a
// decision) — LEAD_ENGINE_V2 is irrelevant to whether this function runs.
// process.env.LEAD_ENGINE_V2 only matters to code that has not been written
// yet: any FUTURE phase that reads Lead.currentAgent/currentStage to decide
// which agent actually replies to a lead MUST check
// `process.env.LEAD_ENGINE_V2 === 'true'` before doing so. Do not skip that
// check just because this observer already runs unconditionally today.
//
// Wrapped in its own try/catch and never awaited by the caller's critical
// path in a way that could change the HTTP response — a failure here must
// never affect the real reply that already went out.
async function observeLeadOwnershipShadow(phone: string): Promise<void> {
  try {
    const { phoneDedupeKey, normalizePhoneE164 } = await import('@/lib/phone');
    const key = phoneDedupeKey(phone);
    if (!key) return;

    // No Lead yet for this phone (true for most platform-agent conversations
    // until a demo is actually booked — see LeadEvent.ts's file-level
    // comment) — nothing to observe onto. Deliberately does NOT create one:
    // this phase only records ownership for Leads that already exist by
    // some other, unrelated flow.
    //
    // Scoped to tenantId 'gmbboost-internal' (the platform funnel's own tenant,
    // set at free-report/start, book-demo and handleCollecting) — without it a
    // tenant customer whose phone happens to collide with a platform inbound
    // would have setLeadOwnership() silently overwrite their Lead's
    // currentAgent/currentStage and cancel their pending nurture. Every other
    // platform-side Lead lookup in this codebase already scopes this way.
    const lead = await Lead.findOne({
      phone: normalizePhoneE164(phone) || phone,
      tenantId: 'gmbboost-internal',
    }).select('_id currentAgent').lean();
    if (!lead) return;

    const { default: BookingConversation } = await import('@/models/BookingConversation');
    const { default: ReportConversation } = await import('@/models/ReportConversation');
    const { setLeadOwnership } = await import('@/services/leadOwnership/setLeadOwnership');

    // Same priority order as processPlatformInbound's own routing checks
    // above, re-read post-processing rather than threaded through as a
    // return value, so this function can be added without touching any of
    // that function's existing branches/returns.
    let agent: 'NONE' | 'SALES' | 'DEMO' | 'IN_HOUSE' | 'HUMAN' = 'NONE';
    const activeSales = await SalesConversation.findOne({ phoneKey: key, status: 'active' }).select('_id').lean();
    if (activeSales) {
      agent = 'SALES';
    } else {
      const activeBooking = await BookingConversation.findOne({ phoneKey: key, status: 'active' }).select('_id').lean();
      if (activeBooking) {
        agent = 'DEMO';
      } else {
        const activeReport = await ReportConversation.findOne({ phoneKey: key, status: { $ne: 'stopped' } }).select('_id').lean();
        if (activeReport) {
          agent = 'DEMO'; // report/connect flow is a pre-demo prospect touchpoint, not a Sales or in-house one
        } else {
          const activeSupport = await SupportConversation.findOne({ phoneKey: key, status: 'active' }).select('_id').lean();
          if (activeSupport) agent = 'IN_HOUSE';
        }
      }
    }

    await setLeadOwnership(lead._id, agent, 'platform_inbound_shadow_sync', 'system');
  } catch (err: any) {
    console.warn('[whatsapp-webhook] shadow ownership observation failed:', err?.message);
  }
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

/**
 * Meta's message_template_status_update webhook field — payload shape per
 * Meta's WhatsApp Business Platform docs:
 *   { event: 'APPROVED'|'PAUSED'|'DISABLED'|'REJECTED'|..., message_template_id,
 *     message_template_name, message_template_language, reason? }
 * Only alerts when the paused/disabled/rejected template is the specific
 * one META_UTILITY_TEMPLATE_NAME points at — that's the only template this
 * codebase's own retry logic (services/whatsapp/send.ts's 24h-window
 * fallback) actually depends on; any other template pausing is Meta/WABA
 * housekeeping this codebase has no dependency on.
 */
const CONCERNING_TEMPLATE_EVENTS = new Set(['PAUSED', 'DISABLED', 'REJECTED']);

async function handleTemplateStatusUpdate(value: any): Promise<void> {
  const event = value?.event;
  const templateName = value?.message_template_name;
  if (!event || !templateName) return;

  console.log(`[meta-webhook] template status update: "${templateName}" -> ${event}`);

  const watchedTemplate = process.env.META_UTILITY_TEMPLATE_NAME;
  if (!watchedTemplate || templateName !== watchedTemplate) return;
  if (!CONCERNING_TEMPLATE_EVENTS.has(event)) return;

  const reason = value?.reason ? ` (reason: ${value.reason})` : '';
  console.error(`[meta-webhook] ALERT: the 24h-window retry template "${templateName}" is now ${event}${reason} — business-initiated sends outside the session window will start failing.`);

  try {
    const { sendPushToSuperAdmins } = await import('@/services/push');
    await sendPushToSuperAdmins({
      title: 'WhatsApp template alert',
      body: `Template "${templateName}" (used for the 24h-window retry fallback) is now ${event}${reason}.`,
      data: { templateName, event, reason: value?.reason || null },
    });
  } catch (e: any) {
    console.error('[meta-webhook] template status alert push failed:', e?.message);
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
        // Meta can pause or reject an approved message template at any
        // time (policy violation, low quality rating, etc) — this
        // silently breaks the 24h-window retry fallback in
        // services/whatsapp/send.ts (which resends via
        // META_UTILITY_TEMPLATE_NAME once a free-text send is rejected for
        // being outside the session window) with no visible symptom other
        // than that fallback itself starting to fail. Alerts the team
        // specifically when the PAUSED/DISABLED/REJECTED template is the
        // one that fallback actually depends on — a different template
        // being paused doesn't affect anything this codebase relies on.
        if (change.field === 'message_template_status_update') {
          try {
            await handleTemplateStatusUpdate(change.value || {});
          } catch (e) {
            console.error('[meta-webhook] template status update error:', e);
          }
          continue;
        }

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

          if (await isDuplicateInboundMessage('meta', message.id || '')) continue;
          if (!isInboundMessageAllowed(phone, message.id || '')) continue;

          if (platform) {
            await processPlatformInbound({ phone, profileName, body, messageSid: message.id || '' });
            // Shadow-mode only — see observeLeadOwnershipShadow's own doc
            // comment. Does not affect the routing/reply decision above.
            await observeLeadOwnershipShadow(phone);
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

export async function handleTwilioWebhook(req: Request) {
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

    // Dedup BEFORE the rate limiter — a rejected/forged request never reaches
    // here (signature already verified above), so claiming the id only after
    // that check can't be used to suppress a real, later redelivery of the
    // same message from ever being processed.
    if (await isDuplicateInboundMessage('twilio', messageSid || '')) return twimlOk();
    if (!isInboundMessageAllowed(phone, messageSid || '')) return twimlOk();

    if (platform) {
      await processPlatformInbound({
        phone,
        profileName: profileName || '',
        body: body || '',
        messageSid: messageSid || '',
      });
      // Shadow-mode only — see observeLeadOwnershipShadow's own doc comment.
      // Does not affect the routing/reply decision above.
      await observeLeadOwnershipShadow(phone);
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
