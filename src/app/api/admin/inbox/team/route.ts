import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { inboxTeam } from '@/services/inbox/platformInbox';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const team = await inboxTeam();
  return NextResponse.json({ success: true, team });
}
