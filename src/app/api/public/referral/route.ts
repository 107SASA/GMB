import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { REF_COOKIE } from '@/lib/partners/referral';
import { recordReferralClick } from '@/services/partners/referralAttribution';

/**
 * ?ref=GP-XXXXXX on any page: the page's ReferralCapture posts the code here
 * and we set the same cookie as /p/[code]. Always answers 204 so it reveals
 * nothing about which codes exist.
 */
export async function POST(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  const rl = checkRateLimit(`referral-capture:${getClientIp(req)}`, 30, 15 * 60 * 1000);
  if (!rl.allowed) return res;
  const body = await req.json().catch(() => ({}));
  await recordReferralClick(body?.code, req.cookies.get(REF_COOKIE)?.value, res);
  return res;
}
