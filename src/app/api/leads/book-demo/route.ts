import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { normalizePhoneE164 } from '@/lib/phone';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

/**
 * Entry point for the /book-demo page — the business/phone/budget form
 * behind every "Book a Demo" / "Book a Free Consultant" CTA sitewide
 * (Navbar, Hero, every service page — see BookDemoButton). Lighter than
 * /api/free-report/start: this only files a CRM Lead, it doesn't provision a
 * shadow User/Organization/Business — the visitor is about to leave for
 * WhatsApp, not land in the dashboard.
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

    // `source: 'Website'` from /free-report and 'Demo Booking' from this
    // route are already both in the Lead schema — keeping them distinct so
    // the CRM can tell which funnel each lead came from.
    const notesParts = [
      body.origin ? `Requested a demo via the "${body.origin}" CTA` : 'Requested a demo',
      businessName ? `Business: ${businessName}` : null,
    ].filter(Boolean);

    await Lead.create({
      tenantId: 'gmbboost-internal',
      name,
      phone: normalizedPhone,
      source: 'Demo Booking',
      leadType: 'Platform Prospect',
      budget,
      notes: notesParts.join(' — '),
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('Book Demo Lead Error:', error);
    return NextResponse.json(
      { error: "We couldn't submit your request. Please try again." },
      { status: 500 }
    );
  }
}
