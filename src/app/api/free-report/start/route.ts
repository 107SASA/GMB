import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import Audit from '@/models/Audit';
import { provisionShadowAccount, CLAIMED_OR_PAID_REUSE_ERROR } from '@/lib/shadowAccount';
import { createPendingAuditAndDispatch } from '@/lib/startAudit';
import { normalizePhoneE164 } from '@/lib/phone';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

/**
 * Entry point for the "Free Business Report" lead-gen form (/free-report).
 * Mirrors the Audit-creation shape of POST /api/audit and the account-shape
 * of POST /api/onboarding, but for a phone-only visitor with no password —
 * see src/lib/shadowAccount.ts for why this is safe to reuse everywhere else
 * downstream (audit engine, dashboard, billing) unmodified.
 */
export async function POST(req: Request) {
  try {
    // Each successful call provisions a real User+Organization+Business+
    // Subscription+Lead and dispatches an audit job, so this is rate-limited
    // more like a signup than a read endpoint. Was tightened to 3/15min
    // during the Aug 2026 security pass, then raised to 8/15min a few days
    // later — 3 was tripping legitimate testing/demo sessions (a real person
    // retrying after a typo, or someone showing the form to a colleague,
    // easily hits 3 attempts) well before any actual abuser would notice a
    // limit exists. Still tight enough to block a scripted hammering loop.
    const ip = getClientIp(req);
    const ipRate = checkRateLimit(`free-report-ip:${ip}`, 8, 15 * 60 * 1000);
    if (!ipRate.allowed && !isQaTestingMode()) {
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

    // Also cap by phone number so rotating IPs (proxies/VPNs) can't be used
    // to spam reports for the same target number.
    const phoneRate = checkRateLimit(`free-report-phone:${normalizedPhone}`, 5, 24 * 60 * 60 * 1000);
    if (!phoneRate.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { error: 'Too many requests for this phone number. Please try again later.' },
        { status: 429 }
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
        // Live Places snapshot — see ShadowBusinessData for why these exist
        // separately from a synced rating/reviewCount.
        placesRating: typeof body.placesRating === 'number' ? body.placesRating : undefined,
        placesReviewCount: typeof body.placesReviewCount === 'number' ? body.placesReviewCount : undefined,
        editorialSummary: body.editorialSummary || undefined,
        // Closes 2 of the free-report checklist's "Unknown" fields (Business
        // Photos, Business Hours) — see calculateProfileCompletion in
        // seoAnalyzer.ts — at zero marginal Google API cost (photos = Basic
        // Data, opening_hours = Contact Data, a tier already paid for on
        // this same Details call).
        photoCount: typeof body.photoCount === 'number' ? body.photoCount : undefined,
        hasHours: typeof body.hasHours === 'boolean' ? body.hasHours : undefined,
        // Real Places types[] for this listing — powers the competitor
        // relevance filter in competitorService.ts (type-to-type overlap
        // instead of guessing from a label string). Same "already fetched
        // at intake, just persist it" pattern as photoCount/hasHours above.
        googleTypes: Array.isArray(body.googleTypes)
          ? body.googleTypes.filter((t: unknown) => typeof t === 'string')
          : undefined,
      },
    });

    // CRM record for this funnel. Upsert on phone within the platform tenant
    // (same dedupe rule /api/leads/book-demo uses) so a visitor who submits
    // twice — or already came through book-demo / the WhatsApp agent —
    // updates one record instead of spawning duplicates, and then wire it
    // into the Lead Engine funnel (currentAgent SALES / currentStage
    // NURTURING + a LEAD_CREATED event) so it shows correctly staged on the
    // SuperAdmin conversion dashboard instead of sitting at NEW forever. The
    // actual WhatsApp nurture is the existing post-audit sales drip
    // (sales/nurture.requested, dispatched from generateAuditJob).
    await fileFreeReportLead({
      name: user.fullName || businessName,
      phone: normalizedPhone,
      businessName,
    }).catch((err) => {
      console.error('Free Report — CRM lead wiring failed (audit still dispatched):', err);
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
        // A PENDING audit older than this is treated as abandoned (e.g. the
        // Inngest job never ran — a dev-server restart mid-job, a dropped
        // event). Fast-mode audits normally complete in ~15-20s; without this
        // check, resubmitting the form just handed the visitor back the SAME
        // stuck audit forever, with no way to actually get a report.
        const STALE_PENDING_MS = 2 * 60 * 1000;
        const isStale = Date.now() - new Date((pendingAudit as any).createdAt).getTime() > STALE_PENDING_MS;
        if (!isStale) {
          return NextResponse.json(
            { success: true, businessId: business._id, auditId: (pendingAudit as any)._id, reused: true },
            { status: 200 }
          );
        }
        await Audit.updateOne({ _id: (pendingAudit as any)._id }, { $set: { status: 'FAILED' } });
      }
    }

    const audit = await createPendingAuditAndDispatch(business, organization, user);

    return NextResponse.json(
      { success: true, businessId: business._id, auditId: audit._id, reused: false },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Free Report Start Error:', error);

    if (error?.message === CLAIMED_OR_PAID_REUSE_ERROR) {
      return NextResponse.json({ error: CLAIMED_OR_PAID_REUSE_ERROR }, { status: 409 });
    }

    // Never leak raw driver/validation errors (collection/index names, dup
    // key values) to an unauthenticated client — matches the sanitizing
    // pattern /api/onboarding already uses for the same class of errors.
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: 'Something about these details is already registered. Please try again or log in.' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "We couldn't generate your report. Please try again." },
      { status: 500 }
    );
  }
}

interface FreeReportLeadInput {
  name: string;
  phone: string; // E.164 with '+'
  businessName: string;
}

/**
 * Upserts the platform Lead for a free-report submission and wires it into
 * the Lead Engine funnel. Split out from POST so the whole block is one
 * best-effort unit — a failure here is logged by the caller and never fails
 * the response, because the audit dispatch is what the visitor is waiting on.
 */
async function fileFreeReportLead(input: FreeReportLeadInput): Promise<void> {
  const { name, phone, businessName } = input;
  const notes = `Submitted the Free Business Report form for "${businessName}"`;

  let lead = await Lead.findOne({ phone, tenantId: 'gmbboost-internal' });
  if (lead) {
    if (!lead.name || lead.name === lead.phone) lead.name = name;
    // Don't stomp a 'Demo Booking' source with a weaker 'Website' one.
    if (!lead.source || lead.source === 'Website') lead.source = 'Website';
    lead.leadType = 'Platform Prospect';
    if (!lead.businessType) lead.businessType = businessName;
    lead.notes = notes;
    lead.lastActivityAt = new Date();
    await lead.save();
  } else {
    lead = await Lead.create({
      tenantId: 'gmbboost-internal',
      name,
      phone,
      source: 'Website',
      leadType: 'Platform Prospect',
      businessType: businessName,
      notes,
      aiLeadScore: 60,
    });
  }

  const [{ setLeadOwnership }, { logLeadEvent }] = await Promise.all([
    import('@/services/leadOwnership/setLeadOwnership'),
    import('@/services/leadEvents'),
  ]);

  // Only move a lead that isn't already further along (e.g. it came through
  // book-demo first and is DEMO-owned) — SALES/NURTURING is the entry stage
  // for the post-audit sales drip, not a downgrade for a hotter lead.
  const owner = (lead.currentAgent || 'NONE') as string;
  if (owner === 'NONE' || owner === 'SALES') {
    await setLeadOwnership(lead._id, 'SALES', 'free-report-form', 'free-report-form', 'NURTURING').catch(
      (err: any) => console.warn('[free-report] setLeadOwnership failed:', err?.message)
    );
  }
  if (!lead.intent) {
    await Lead.updateOne({ _id: lead._id }, { $set: { intent: 'EXPLORING' } }).catch(() => {});
  }

  await logLeadEvent(
    'LEAD_CREATED',
    { channel: 'free-report', businessName },
    'free-report-form',
    { leadId: lead._id, phone }
  );
}
