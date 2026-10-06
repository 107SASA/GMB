import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { listOpenSlots } from '@/services/calendar/publicSlots';

export const dynamic = 'force-dynamic';

/**
 * GET /api/leads/book-demo/slots?date=YYYY-MM-DD
 * Public: open demo slots for one day, used by the /book-demo slot picker.
 * Rate-limited per IP because each call may hit Google Calendar free/busy.
 */
export async function GET(req: Request) {
  const rl = checkRateLimit(`book-demo-slots:${getClientIp(req)}`, 40, 5 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }
  const date = new URL(req.url).searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ success: false, error: 'Invalid date.' }, { status: 400 });
  }
  try {
    const data = await listOpenSlots(date);
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[book-demo/slots] failed:', err);
    return NextResponse.json({ success: false, error: 'Could not load available times.' }, { status: 500 });
  }
}
