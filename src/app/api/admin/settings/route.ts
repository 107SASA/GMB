import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import PlatformSettings from '@/models/PlatformSettings';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const settings = await PlatformSettings.findOne().lean();

    if (!settings) {
      // Return defaults — upsert happens on first PATCH
      return NextResponse.json({
        success: true,
        data: {
          platformName:              'GMBBoost',
          supportEmail:              '',
          maxAuditsPerBusiness:      10,
          maxPostsPerMonth:          50,
          maxWhatsAppMessagesPerDay: 100,
          maintenanceMode:           false,
          defaultTrialDays:          14,
          reviewRequestCooldownDays: 30,
        },
      });
    }

    return NextResponse.json({ success: true, data: settings });
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

    const allowed = [
      'platformName',
      'supportEmail',
      'maxAuditsPerBusiness',
      'maxPostsPerMonth',
      'maxWhatsAppMessagesPerDay',
      'maintenanceMode',
      'defaultTrialDays',
      'reviewRequestCooldownDays',
    ];

    const update: Record<string, any> = {};
    for (const key of allowed) {
      if (key in body) update[key] = body[key];
    }

    const settings = await PlatformSettings.findOneAndUpdate(
      {},
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return NextResponse.json({ success: true, data: settings });
  } catch (error: any) {
    console.error('Settings PATCH Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
