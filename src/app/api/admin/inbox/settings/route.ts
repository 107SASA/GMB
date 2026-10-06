import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { getInboxSettings, updateInboxSettings } from '@/services/inbox/platformInbox';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const settings = await getInboxSettings();
  return NextResponse.json({ success: true, settings });
}

export async function PUT(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const result = await updateInboxSettings({
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    assignOnTakeover: typeof body.assignOnTakeover === 'boolean' ? body.assignOnTakeover : undefined,
  });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, settings: result.settings });
}
