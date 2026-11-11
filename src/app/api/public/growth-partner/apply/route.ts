import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import PartnerApplication from '@/models/PartnerApplication';
import GrowthPartner from '@/models/GrowthPartner';
import { getClientIp } from '@/lib/rateLimit';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import { validatePartnerApplication } from '@/lib/partners/partnerRules';
import {
  sendApplicationReceivedEmail,
  sendNewApplicationAdminAlert,
} from '@/services/partners/partnerEmails';

/**
 * Public "Apply as a Growth Partner" form (/growth-partner/apply).
 *
 * Files a `pending` PartnerApplication for Admin → Growth Partners. Guards:
 * a durable per-IP limit, a hidden honeypot field bots fill in, and one open
 * application per email/phone at a time. The responses never say whether an
 * email belongs to an existing Growwmatics account.
 */
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rate = await checkDurableRateLimit(`partner-apply-ip:${ip}`, 5, 60 * 60 * 1000);
    if (!rate.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { success: false, error: 'Too many applications from this network. Please try again in an hour.' },
        { status: 429 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Honeypot: a real visitor never sees this field. Pretend success so bots learn nothing.
    if (typeof body.companyUrl === 'string' && body.companyUrl.trim()) {
      return NextResponse.json({ success: true });
    }

    const parsed = validatePartnerApplication(body);
    if (!parsed.ok) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    }
    const input = parsed.value;

    await dbConnect();

    const openApplication = await PartnerApplication.exists({
      status: 'pending',
      $or: [{ email: input.email }, { phone: input.phone }],
    });
    if (openApplication) {
      return NextResponse.json(
        { success: false, error: 'We already have an application from you under review. We will email you soon.' },
        { status: 409 }
      );
    }
    if (await GrowthPartner.exists({ email: input.email })) {
      return NextResponse.json(
        { success: false, error: 'You are already a Growth Partner. Please sign in from the partner login page.' },
        { status: 409 }
      );
    }

    await PartnerApplication.create({ ...input, status: 'pending', ip });

    // Best-effort — neither email can fail the submission.
    await Promise.all([
      sendApplicationReceivedEmail(input.email, input.fullName),
      sendNewApplicationAdminAlert(input),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[growth-partner/apply] failed:', error?.message);
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
