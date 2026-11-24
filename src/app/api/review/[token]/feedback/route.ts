import { NextResponse } from 'next/server';
import { feedbackForToken } from '@/services/reviews/reviewAssist';

export const dynamic = 'force-dynamic';

/** Public: an optional private note to the owner from /review/[token]. Never replaces posting on Google. */
export async function POST(req: Request, ctx: RouteContext<'/api/review/[token]/feedback'>) {
  const { token } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await feedbackForToken(token, body || {});
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[review feedback] failed:', err?.message);
    return NextResponse.json({ error: 'Could not send your message right now.' }, { status: 500 });
  }
}
