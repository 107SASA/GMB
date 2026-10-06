import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import {
  assignInbox,
  cancelInboxDemo,
  resolveInbox,
  returnInboxToAi,
  saveInboxNotes,
  sendInboxMessage,
  takeOverInbox,
} from '@/services/inbox/platformInbox';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id, action } = await ctx.params;
  const conversationId = decodeURIComponent(id);
  const body = await req.json().catch(() => ({}));

  const result = await (async () => {
    if (action === 'send') return sendInboxMessage(conversationId, body);
    if (action === 'takeover') return takeOverInbox(conversationId, auth.userId);
    if (action === 'return-to-ai') return returnInboxToAi(conversationId, auth.userId);
    if (action === 'assign') return assignInbox(conversationId, body.userId || null);
    if (action === 'resolve') return resolveInbox(conversationId, false);
    if (action === 'reopen') return resolveInbox(conversationId, true);
    if (action === 'notes') return saveInboxNotes(conversationId, body);
    if (action === 'cancel-demo') return cancelInboxDemo(conversationId, auth.userId);
    return { ok: false as const, error: 'Unknown action', status: 404 };
  })();

  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, duplicate: 'duplicate' in result ? result.duplicate : false });
}
