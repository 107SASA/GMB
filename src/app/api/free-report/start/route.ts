import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { provisionShadowAccount, findAccountForPhone, CLAIMED_OR_PAID_REUSE_ERROR } from '@/lib/shadowAccount';
import { finalizeLogin } from '@/lib/authSession';
import { startOrReuseFreeReport } from '@/services/leads/freeReport';
import { usablePersonName } from '@/lib/personName';
import { normalizePhoneE164 } from '@/lib/phone';
import { getClientIp } from '@/lib/rateLimit';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import { checkFreeReportOtp, consumeFreeReportOtp } from '@/services/auth/freeReportOtp';
import { markPhoneVerified } from '@/services/auth/phoneVerification';
import {
  fileFreeReportPlatformLead,
  linkPlatformLeadAudit,
} from '@/services/leads/platformProspectEntry';

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
    // MongoDB-backed (Sep 2026): the in-memory limiter only counted per
    // server process, so on more than one instance each paid report could be
    // requested N× the limit.
    const ip = getClientIp(req);
    const ipRate = await checkDurableRateLimit(`free-report-ip:${ip}`, 8, 15 * 60 * 1000);
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

    // The number must be proven with the WhatsApp code from
    // POST /api/free-report/send-otp — visitors were entering made-up or
    // other people's numbers. Checked before the per-phone limit below so a
    // mistyped code doesn't use up the real owner's daily reports.
    const otpCheck = await checkFreeReportOtp(normalizedPhone, String(body.otp || ''));
    if (!otpCheck.ok) {
      return NextResponse.json(
        { error: otpCheck.error, otpRequired: true, otpExpired: !!otpCheck.expired },
        { status: 401 }
      );
    }

    // The code proves the number is theirs. A number that already has an
    // established account (a real account, or a paid / trial workspace) is
    // simply logged in and sent to its dashboard — no new report (paying
    // customers get theirs monthly; free accounts got one at sign-up).
    // Replaces the old "An account already exists… please log in" dead end.
    const account = await findAccountForPhone(normalizedPhone);
    if (account.user && account.established) {
      await consumeFreeReportOtp(normalizedPhone);
      await markPhoneVerified(account.user._id, 'whatsapp_otp').catch(() => {});
      const login = await finalizeLogin(account.user, req);
      if (login.status !== 200) return login; // staff / partner accounts sign in elsewhere
      // The session cookie set by finalizeLogin (next/headers) goes out with this response.
      return NextResponse.json({ success: true, loggedIn: true, redirect: '/dashboard' }, { status: 200 });
    }

    // Also cap by phone number so rotating IPs (proxies/VPNs) can't be used
    // to spam reports for the same target number.
    const phoneRate = await checkDurableRateLimit(`free-report-phone:${normalizedPhone}`, 5, 24 * 60 * 60 * 1000);
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

    // The WhatsApp code above proves the number belongs to this visitor.
    await markPhoneVerified(user._id, 'whatsapp_otp').catch((err) =>
      console.warn('[free-report] markPhoneVerified failed:', (err as Error)?.message)
    );

    // CRM: upsert Platform Lead immediately at submit (before audit finishes),
    // apply FREE_REPORT_SUBMITTED, then attach auditId when the audit is known.
    // WhatsApp nurture still waits on the post-audit sales drip + flags.
    const leadResult = await fileFreeReportPlatformLead({
      name: usablePersonName(user.fullName) || businessName,
      phone: normalizedPhone,
      businessName,
      channel: 'website',
    }).catch((err) => {
      console.error('Free Report — CRM lead wiring failed (audit still dispatched):', err);
      return null;
    });

    // Growth Partner referral link: credit a lead / workspace that is new since the click.
    {
      const { attributeLeadFromReferral, attributeBusinessFromReferral } = await import('@/services/partners/referralAttribution');
      await Promise.all([
        leadResult?.leadId ? attributeLeadFromReferral(leadResult.leadId) : Promise.resolve(false),
        attributeBusinessFromReferral(business._id),
      ]);
    }

    const attachAudit = async (auditId: unknown) => {
      if (!leadResult?.leadId || !auditId) return;
      await linkPlatformLeadAudit(leadResult.leadId, String(auditId)).catch((err) =>
        console.warn('[free-report] linkPlatformLeadAudit failed:', (err as Error)?.message)
      );
    };

    // Reuse a recent / in-progress report for a returning number, otherwise
    // start a new one (daily cap applies) — services/leads/freeReport.ts.
    const started = await startOrReuseFreeReport(business, organization, user, { reuse: reused });
    if (!started.ok) {
      return NextResponse.json({ error: started.error }, { status: 429 });
    }
    await attachAudit(started.auditId);
    await consumeFreeReportOtp(normalizedPhone);

    return NextResponse.json(
      { success: true, businessId: business._id, auditId: started.auditId, reused: started.reused },
      { status: started.reused ? 200 : 201 }
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
