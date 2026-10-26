import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { getPlatformSubStages, savePlatformSubStages } from '@/services/admin/platformCrmActivity';

export const dynamic = 'force-dynamic';

/** GET / PUT the team's custom sub-stages ({ subStages: [{ id?, name, stage, color }] }). */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ success: true, subStages: await getPlatformSubStages() });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => null);
    const res = await savePlatformSubStages(body?.subStages, auth.userId);
    if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    return NextResponse.json({ success: true, subStages: res.subStages });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
