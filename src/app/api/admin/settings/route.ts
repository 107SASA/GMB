import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import PlatformSettings from '@/models/PlatformSettings';

/**
 * Platform Config — down to just supportEmail (Sep 2026 dead-code sweep).
 * This used to also read/write platformName, maxAuditsPerBusiness,
 * maxPostsPerMonth, maxWhatsAppMessagesPerDay, maintenanceMode and
 * defaultTrialDays, but a repo-wide search turned up nothing else in the
 * app that ever READ any of those fields — editing them here did
 * genuinely nothing (no maintenance banner exists anywhere, usage limits
 * are actually enforced via PlanConfig/lib/planDefaults.ts, not this
 * model — see admin/customers' plan-limits editor for the real one).
 * supportEmail is the one field with a real reader (admin/support/page.tsx's
 * "Open Support Inbox" mailto link), so it's the only one kept.
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const settings = (await PlatformSettings.findOne().select('supportEmail freeSignupEnabled freeSignupAutoReport').lean()) as any;

    return NextResponse.json({
      success: true,
      data: {
        supportEmail: settings?.supportEmail || '',
        // Free account sign-up (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md) — default on.
        freeSignupEnabled: settings?.freeSignupEnabled !== false,
        freeSignupAutoReport: settings?.freeSignupAutoReport !== false,
      },
    });
  } catch (error: any) {
    console.error('Settings GET Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const body = await req.json();
    const update: Record<string, unknown> = {};
    if (body.supportEmail !== undefined) {
      if (typeof body.supportEmail !== 'string') {
        return NextResponse.json({ success: false, error: 'supportEmail must be text' }, { status: 400 });
      }
      update.supportEmail = body.supportEmail;
    }
    for (const key of ['freeSignupEnabled', 'freeSignupAutoReport'] as const) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'boolean') {
          return NextResponse.json({ success: false, error: `${key} must be true or false` }, { status: 400 });
        }
        update[key] = body[key];
      }
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 });
    }

    const settings = (await PlatformSettings.findOneAndUpdate(
      {},
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select('supportEmail freeSignupEnabled freeSignupAutoReport').lean()) as any;

    return NextResponse.json({
      success: true,
      data: {
        supportEmail: settings?.supportEmail || '',
        freeSignupEnabled: settings?.freeSignupEnabled !== false,
        freeSignupAutoReport: settings?.freeSignupAutoReport !== false,
      },
    });
  } catch (error: any) {
    console.error('Settings PATCH Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
