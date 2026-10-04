import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { readNurtureAdminView, saveNurtureAdminView } from '@/services/nurture/nurtureAdminConfig';
import type { NurtureScheduleInput } from '@/services/nurture/nurtureSchedule';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const config = await readNurtureAdminView();
  return NextResponse.json({ success: true, config });
}

export async function PUT(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, error: 'Invalid config' }, { status: 400 });
  }
  const result = await saveNurtureAdminView(body as NurtureScheduleInput, {
    userId: auth.userId,
    role: 'SUPER_ADMIN',
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ success: true, version: result.version, changes: result.changes });
}
