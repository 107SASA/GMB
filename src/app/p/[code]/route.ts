import { NextRequest, NextResponse } from 'next/server';
import { publicUrl } from '@/lib/publicUrl';
import { REF_COOKIE, safeRedirectPath } from '@/lib/partners/referral';
import { recordReferralClick } from '@/services/partners/referralAttribution';

/**
 * A Growth Partner's referral link: growwmatics.ai/p/GP-XXXXXX[?to=/free-report].
 * Remembers the partner for 30 days (first partner wins), then sends the
 * visitor on. An unknown or inactive code just redirects, no cookie.
 */
export async function GET(req: NextRequest, ctx: RouteContext<'/p/[code]'>) {
  const { code } = await ctx.params;
  const to = safeRedirectPath(req.nextUrl.searchParams.get('to'));
  const res = NextResponse.redirect(publicUrl(to, req));
  await recordReferralClick(code, req.cookies.get(REF_COOKIE)?.value, res);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
