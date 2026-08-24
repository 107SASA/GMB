import { NextResponse } from 'next/server';
import { inngest } from '@/services/inngest/client';
import { requireBusinessContext } from '@/lib/tenant';
import { checkRateLimit, getRateLimitConfig } from '@/lib/rateLimit';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

// Burst guard — each dispatch fans out into an AI content-generation job.
// Overridable via SCHEDULER_GENERATE_RATE_LIMIT / SCHEDULER_GENERATE_RATE_WINDOW_MS.
const { limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS } = getRateLimitConfig('SCHEDULER_GENERATE', 10, 10 * 60 * 1000);

export async function POST(req: Request) {
  try {
    const { businessId } = await req.json();

    const ctx = await requireBusinessContext({ businessIdFromBody: businessId });
    if (!ctx.ok) return ctx.response;

    const rl = checkRateLimit(`scheduler-generate:${ctx.userId}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many generation requests — please wait a few minutes and try again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    await inngest.send({
      name: 'scheduler/manual-generate',
      data: { businessId: ctx.businessId, force: true }
    });

    return NextResponse.json({ success: true, message: 'Generation job dispatched successfully.' }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to dispatch manual generation:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
