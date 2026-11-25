import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

/**
 * Super admin books a demo on a platform lead's behalf (e.g. after a call).
 *
 * GET  ?date=YYYY-MM-DD → open slots that day (same availability as /book-demo).
 * POST { date, time, email?, note? } → books it; the Demo agent then sends the
 *      WhatsApp confirmation + reminders. See services/demo/adminBookDemo.ts.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  await ctx.params;
  const date = new URL(req.url).searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ success: false, error: 'Invalid date.' }, { status: 400 });
  }
  try {
    const { listOpenSlots } = await import('@/services/calendar/publicSlots');
    const data = await listOpenSlots(date);
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, error: 'Invalid lead id.' }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    const date = String(body?.date || '');
    const time = String(body?.time || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return NextResponse.json({ success: false, error: 'Please choose a date and a time slot.' }, { status: 400 });
    }
    const email = body?.email ? String(body.email).slice(0, 200) : undefined;
    const note = body?.note ? String(body.note).trim().slice(0, 500) : undefined;

    const { adminBookDemo } = await import('@/services/demo/adminBookDemo');
    const result = await adminBookDemo({ leadId: id, adminUserId: auth.userId, date, time, email, note });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[admin book-demo] failed:', err);
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}
