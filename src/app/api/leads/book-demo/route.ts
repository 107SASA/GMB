import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

/**
 * Entry point for the /book-demo page — the business/phone/budget form
 * behind every "Book a Demo" / "Book a Free Consultant" CTA sitewide
 * (Navbar, Hero, every service page — see BookDemoButton). Lighter than
 * /api/free-report/start: this doesn't provision a shadow User/Organization/
 * Business — the visitor is about to leave for WhatsApp, not land in the
 * dashboard.
 *
 * What it DOES file so the request is visible everywhere the team looks
 * (Aug 2026 fix — before this, the form only wrote a bare NEW Lead, so a
 * submission showed nowhere useful: not on Admin → Demos, and only as an
 * un-triaged "New" row on Admin → Leads):
 *   1. a platform Lead (tenantId 'gmbboost-internal', source 'Demo Booking'),
 *      moved straight to currentAgent DEMO / currentStage DEMO_REQUESTED so
 *      the Conversion pipeline counts it as demo interest, not a raw lead;
 *   2. a DemoBooking with status 'Pending' and no slot yet — lands in the
 *      "Needs scheduling" group on Admin → Demos;
 *   3. a BookingConversation seeded with the details the form already
 *      collected, so (a) it shows on Admin → Booking Agent, (b) the WhatsApp
 *      booking agent has context when the prospect messages the platform
 *      number, and (c) we can fire booking/agent.reply to have the agent
 *      send the first WhatsApp message proactively instead of relying on the
 *      visitor to hit "send" on the pre-filled wa.me draft.
 *
 * Steps 2-4 are best-effort: a failure there is logged but never fails the
 * request, because step 1 (the Lead) is the record that must not be lost.
 */
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const ipRate = checkRateLimit(`book-demo-ip:${ip}`, 5, 15 * 60 * 1000);
    if (!ipRate.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again in a few minutes.' },
        { status: 429 }
      );
    }

    await dbConnect();
    const body = await req.json();

    const name = String(body.name || '').trim();
    if (!name) {
      return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 });
    }

    const normalizedPhone = normalizePhoneE164(String(body.phone || ''));
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'Please enter a valid WhatsApp number in international format, e.g. +14155550100.' },
        { status: 400 }
      );
    }

    const phoneRate = checkRateLimit(`book-demo-phone:${normalizedPhone}`, 5, 24 * 60 * 60 * 1000);
    if (!phoneRate.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { error: 'Too many requests for this phone number. Please try again later.' },
        { status: 429 }
      );
    }

    // Free-text business name the visitor typed/selected on the /book-demo
    // page — not run through Google Places (unlike /free-report), since this
    // flow only needs enough context for a human follow-up, not an audit.
    const businessName = body.businessName ? String(body.businessName).trim() : undefined;
    // One of the three radio choices on /book-demo ("More than ₹5000" etc) —
    // free-text rather than an enum since the CRM's Lead.budget field is
    // already a plain string used elsewhere for AI-qualified leads too.
    const budget = body.budget ? String(body.budget).trim() : undefined;
    const origin = body.origin ? String(body.origin).trim() : undefined;

    const notesParts = [
      origin ? `Requested a demo via the "${origin}" CTA` : 'Requested a demo',
      businessName ? `Business: ${businessName}` : null,
      budget ? `Budget: ${budget}` : null,
    ].filter(Boolean);
    const notes = notesParts.join(' — ');

    // 1. Upsert the platform Lead. Dedupe on phone within the platform tenant
    // so a visitor who submits twice (or already came through free-report /
    // the WhatsApp agent) updates one record instead of spawning duplicates.
    let lead = await Lead.findOne({ phone: normalizedPhone, tenantId: 'gmbboost-internal' });
    if (lead) {
      lead.name = lead.name || name;
      lead.source = 'Demo Booking';
      lead.leadType = 'Platform Prospect';
      if (businessName) lead.businessType = lead.businessType || businessName;
      if (budget) lead.budget = budget;
      lead.notes = notes;
      lead.pipelineStage = 'New Request';
      lead.lastActivityAt = new Date();
      await lead.save();
    } else {
      lead = await Lead.create({
        tenantId: 'gmbboost-internal',
        name,
        phone: normalizedPhone,
        source: 'Demo Booking',
        leadType: 'Platform Prospect',
        pipelineStage: 'New Request',
        budget,
        businessType: businessName,
        notes,
        aiLeadScore: 85,
      });
    }

    // 2-4. Best-effort: surface the request on every admin view and kick off
    // the WhatsApp booking conversation. Never fails the response — the Lead
    // above is already saved.
    await fileDemoRequest(lead, {
      name,
      phone: normalizedPhone,
      businessName,
      budget,
      origin,
    }).catch((err) => {
      console.error('Book Demo — post-lead wiring failed (lead was still saved):', err);
    });

    return NextResponse.json({ success: true, leadId: String(lead._id) }, { status: 201 });
  } catch (error) {
    console.error('Book Demo Lead Error:', error);
    return NextResponse.json(
      { error: "We couldn't submit your request. Please try again." },
      { status: 500 }
    );
  }
}

interface DemoRequestInput {
  name: string;
  phone: string; // E.164 with '+'
  businessName?: string;
  budget?: string;
  origin?: string;
}

/**
 * Files the DemoBooking + BookingConversation and hands the thread to the
 * WhatsApp booking agent. Split out from POST so the whole block can be a
 * single best-effort unit — any throw here is caught by the caller and only
 * logged, because the Lead is already persisted by that point.
 */
async function fileDemoRequest(lead: any, input: DemoRequestInput): Promise<void> {
  const { name, phone, businessName, budget, origin } = input;

  const [{ default: DemoBooking }, { default: BookingConversation }, { setLeadOwnership }, { logLeadEvent }, { inngest }] =
    await Promise.all([
      import('@/models/DemoBooking'),
      import('@/models/BookingConversation'),
      import('@/services/leadOwnership/setLeadOwnership'),
      import('@/services/leadEvents'),
      import('@/services/inngest/client'),
    ]);

  // Move the lead into the demo funnel so the Conversion pipeline / funnel
  // counts it as demo interest rather than an un-triaged NEW lead.
  await setLeadOwnership(lead._id, 'DEMO', 'book-demo-form', 'book-demo-form', 'DEMO_REQUESTED').catch((err: any) =>
    console.warn('[book-demo] setLeadOwnership failed:', err?.message)
  );
  if (lead.intent !== 'DEMO_INTEREST') {
    await Lead.updateOne({ _id: lead._id }, { $set: { intent: 'DEMO_INTEREST' } }).catch(() => {});
  }

  // A DemoBooking with no real slot yet → "Needs scheduling" on Admin → Demos
  // (that group is exactly `status === 'Pending' && unparseable date`).
  let booking = await DemoBooking.findOne({ leadId: lead._id, status: 'Pending' });
  if (!booking) {
    booking = await DemoBooking.create({
      leadId: lead._id,
      name,
      phone,
      company: businessName,
      challenges: budget ? `Monthly marketing budget: ${budget}` : undefined,
      date: 'To be scheduled',
      timeSlot: 'To be scheduled',
      status: 'Pending',
      channel: 'form',
    });
  }

  // Seed a booking conversation so the WhatsApp agent has context and the
  // webhook can match the prospect's first inbound message to this thread.
  const phoneKey = phoneDedupeKey(phone);
  const existingConvo = await BookingConversation.findOne({ phoneKey, status: 'active' });

  const openingLine = businessName
    ? `Hi, I just requested a demo for ${businessName} through the website${budget ? ` (budget: ${budget})` : ''}.`
    : `Hi, I just requested a demo through the website.`;

  let convo = existingConvo;
  const isNewConvo = !existingConvo;
  if (!convo) {
    convo = await BookingConversation.create({
      leadPhone: phone,
      phoneKey,
      leadName: name,
      status: 'active',
      leadId: lead._id,
      bookingId: booking._id,
      details: {
        name,
        businessName: businessName || '',
        notes: [origin ? `Website CTA: ${origin}` : null, budget ? `Budget: ${budget}` : null]
          .filter(Boolean)
          .join(' | '),
      },
      messages: [{ role: 'lead', text: openingLine, at: new Date() }],
    });
  } else {
    if (!convo.leadId) convo.leadId = lead._id;
    if (!convo.bookingId) convo.bookingId = booking._id;
    await convo.save();
  }

  await logLeadEvent(
    'DEMO_REQUESTED',
    { channel: 'website-form', origin: origin || null, businessName: businessName || null, budget: budget || null },
    'book-demo-form',
    { leadId: lead._id, phone, conversationType: 'booking', conversationId: convo._id }
  );

  // Have the booking agent send the first WhatsApp message proactively —
  // the visitor may never hit "send" on the pre-filled wa.me draft. Best
  // effort: this only lands if a WhatsApp provider is configured and the
  // 24h-window / template rules allow a business-initiated message. Only for
  // a freshly-created thread — if the prospect already has an active booking
  // conversation, they're mid-flow and shouldn't be interrupted.
  if (isNewConvo) {
    await inngest
      .send({ name: 'booking/agent.reply', data: { conversationId: String(convo._id), body: openingLine } })
      .catch((err: any) => console.warn('[book-demo] inngest booking/agent.reply dispatch failed:', err?.message));
  }
}
