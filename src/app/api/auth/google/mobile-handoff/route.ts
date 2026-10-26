import { NextResponse } from 'next/server';

import { HANDOFF_TTL_MS, issueGbpConnectHandoff } from '@/lib/gbpConnectHandoff';
import { checkRateLimit } from '@/lib/rateLimit';
import { requireBusinessContext } from '@/lib/tenant';
import User from '@/models/User';

/**
 * POST /api/auth/google/mobile-handoff — issues a single-use, 2-minute link
 * the iOS app opens to start Google Business Profile OAuth for the active
 * workspace (see src/lib/gbpConnectHandoff.ts). Requires the app's bearer
 * session and an x-business-id the caller is allowed to act on. The web and
 * Android flows don't use it.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  const limit = checkRateLimit(`gbp-handoff:${ctx.userId}`, 10, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const user: any = await User.findById(ctx.userId).select('sessionEpoch').lean();
  const { rawToken, expiresAt } = await issueGbpConnectHandoff({
    userId: ctx.userId,
    businessId: ctx.businessId,
    sessionEpoch: user?.sessionEpoch ?? 0,
  });

  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  return NextResponse.json(
    {
      url: new URL(`/api/auth/google/mobile-handoff/${rawToken}`, base).toString(),
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: HANDOFF_TTL_MS / 1000,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
