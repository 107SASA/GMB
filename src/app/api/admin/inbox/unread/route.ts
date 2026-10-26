import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { inboxUnreadCount } from '@/services/inbox/platformInbox';

export const dynamic = 'force-dynamic';

/** The WhatsApp Inbox badge in the Super Admin menu: chats with a message nobody has opened. */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ success: true, ...(await inboxUnreadCount()) });
}
