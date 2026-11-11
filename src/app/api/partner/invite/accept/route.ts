import { NextResponse } from 'next/server';
import { securityLogged } from '@/services/security/securityLog';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import { acceptPartnerInvite } from '@/services/partners/partnerAccount';

/** Public: create the Growth Partner account from the approval link (sets the password). */
async function handlePOST(req: Request) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`partner-invite-accept:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.allowed && !isQaTestingMode()) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Please try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }
  try {
    const body = await req.json().catch(() => ({}));
    const result = await acceptPartnerInvite(body?.token, body?.password);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: { email: result.email } });
  } catch (error: any) {
    console.error('[partner/invite/accept] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not create your account. Please try again.' }, { status: 500 });
  }
}

/** Every call is recorded in the security log (Super Admin → Security Log). */
export const POST = securityLogged('partner.invite_accept', handlePOST, { role: 'GROWTH_PARTNER' });
