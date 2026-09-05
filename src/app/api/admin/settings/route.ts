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

    const settings = await PlatformSettings.findOne().select('supportEmail').lean();

    return NextResponse.json({
      success: true,
      data: { supportEmail: settings?.supportEmail || '' },
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
    if (typeof body.supportEmail !== 'string') {
      return NextResponse.json({ success: false, error: 'supportEmail is required' }, { status: 400 });
    }

    const settings = await PlatformSettings.findOneAndUpdate(
      {},
      { $set: { supportEmail: body.supportEmail } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select('supportEmail').lean();

    return NextResponse.json({ success: true, data: { supportEmail: settings?.supportEmail || '' } });
  } catch (error: any) {
    console.error('Settings PATCH Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
