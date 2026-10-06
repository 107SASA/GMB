import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { listInbox } from '@/services/inbox/platformInbox';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const data = await listInbox({
    q: url.searchParams.get('q') || '',
    filter: url.searchParams.get('filter') || 'all',
    sort: url.searchParams.get('sort') || 'latest',
    viewerUserId: auth.userId,
  });
  return NextResponse.json({ success: true, ...data });
}
