import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import Audit from '@/models/Audit';
import { provisionShadowAccount } from '@/lib/shadowAccount';
import { createPendingAuditAndDispatch } from '@/lib/startAudit';
import { normalizePhoneE164 } from '@/lib/phone';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

/**
 * Entry point for the "Free Business Report" lead-gen form (/free-report).
 * Mirrors the Audit-creation shape of POST /api/audit and the account-shape
 * of POST /api/onboarding, but for a phone-only visitor with no password —
 * see src/lib/shadowAccount.ts for why this is safe to reuse everywhere else
 * downstream (audit engine, dashboard, billing) unmodified.
 */
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rate = checkRateLimit(`free-report:${ip}`, 5, 10 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again in a few minutes.' },
        { status: 429 }
      );
    }

    await dbConnect();
    const body = await req.json();

    const phoneRaw = String(body.phone || '');
    const normalizedPhone = normalizePhoneE164(phoneRaw);
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'Please enter a valid phone number in international format, e.g. +14155550100.' },
        { status: 400 }
      );
    }

    const businessName = String(body.businessName || '').trim();
    if (!businessName) {
      return NextResponse.json({ error: 'Please enter your business name.' }, { status: 400 });
    }

    const { user, business, organization, reused } = await provisionShadowAccount({
      phone: normalizedPhone,
      source: 'free-report-form',
      businessData: {
        name: businessName,
        category: body.category || undefined,
        address: body.address || undefined,
        area: body.area || undefined,
        city: body.city || undefined,
        state: body.state || undefined,
        country: body.country || undefined,
        phone: body.businessPhone || undefined,
        website: body.website || undefined,
        googlePlaceId: body.googlePlaceId || undefined,
        googleMapsUrl: body.googleMapsUrl || undefined,
        coordinates:
          body.latitude && body.longitude ? { lat: body.latitude, lng: body.longitude } : undefined,
      },
    });

    // CRM record for this funnel — phone-only Lead creation is already the
    // proven, schema-legal pattern the WhatsApp booking agent uses.
    await Lead.create({
      tenantId: 'gmbboost-internal',
      name: user.fullName || businessName,
      phone: normalizedPhone,
      source: 'Website',
      leadType: 'Platform Prospect',
      businessType: body.budget || undefined,
      notes: 'Submitted the Free Business Report form',
    });

    // Reuse an existing report instead of generating a duplicate one if this
    // phone number has already been through this flow with a completed audit.
    if (reused) {
      const existingAudit = await Audit.findOne({ businessId: business._id, status: 'COMPLETED' })
        .sort({ createdAt: -1 })
        .lean();
      if (existingAudit) {
        return NextResponse.json(
          { success: true, businessId: business._id, auditId: (existingAudit as any)._id, reused: true },
          { status: 200 }
        );
      }
      const pendingAudit = await Audit.findOne({ businessId: business._id, status: 'PENDING' })
        .sort({ createdAt: -1 })
        .lean();
      if (pendingAudit) {
        return NextResponse.json(
          { success: true, businessId: business._id, auditId: (pendingAudit as any)._id, reused: true },
          { status: 200 }
        );
      }
    }

    const audit = await createPendingAuditAndDispatch(business, organization, user);

    return NextResponse.json(
      { success: true, businessId: business._id, auditId: audit._id, reused: false },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Free Report Start Error:', error);
    return NextResponse.json(
      { error: error?.message || "We couldn't generate your report. Please try again." },
      { status: 500 }
    );
  }
}
