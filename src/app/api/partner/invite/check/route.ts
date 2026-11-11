import { NextResponse } from 'next/server';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import { checkPartnerInvite } from '@/services/partners/partnerAccount';

/**
 * Public: is this account-creation link still good? Returns the email the
 * account will be created with, so the page can show it (locked). POST so
 * the token never lands in a URL query string or access log.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`partner-invite-check:${ip}`, 30, 15 * 60 * 1000);
  if (!rl.allowed && !isQaTestingMode()) {
    return NextResponse.json({ success: false, error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const result = await checkPartnerInvite(body?.token);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    const { ok: _ok, ...data } = result;
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[partner/invite/check] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
