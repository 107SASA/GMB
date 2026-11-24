import { NextResponse } from 'next/server';
import { getClientIp } from '@/lib/rateLimit';
import { draftForToken } from '@/services/reviews/reviewAssist';

export const dynamic = 'force-dynamic';

/** Public: a suggested review for /review/[token] (4–5 stars only). */
export async function POST(req: Request, ctx: RouteContext<'/api/review/[token]/draft'>) {
  const { token } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await draftForToken(token, body || {}, getClientIp(req));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ draft: result.draft, source: result.source }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[review draft] failed:', err?.message);
    return NextResponse.json({ error: 'Could not write a suggestion right now.' }, { status: 500 });
  }
}
