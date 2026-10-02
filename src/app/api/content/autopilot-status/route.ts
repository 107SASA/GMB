import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Post from '@/models/Post';
import { requireBusinessContext } from '@/lib/tenant';
import { AUTOPILOT_INTERVAL_MS } from '@/lib/contentAutopilot';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

/** A batch lands within minutes of dispatch; weekly runs can be picked up up to an hour after their due time (hourly cron). */
const GENERATING_WINDOW_MS = 75 * 60 * 1000;

/**
 * Content tab autopilot state — READ-ONLY (web + mobile). Reading it never
 * generates posts: the first batch is started by the events that make a
 * business qualify (intake saved, subscription activated, Google connected —
 * maybeStartContentAutopilot) and, as a safety net, by the hourly
 * weeklyContentAutopilotCron, which is also the only path for every later
 * weekly batch.
 *
 * `generating` = a batch was dispatched in the last 75 minutes and its posts
 * haven't appeared yet — the page shows "your AI agent is creating…" and polls.
 * `stalled` = dispatched over 75 minutes ago and still nothing — the page says so.
 */
export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    await dbConnect();

    const b: any = await Business.findById(ctx.businessId)
      .select('keywords subscriptionStatus googleConnected autopilotNextRunAt')
      .lean();
    const hasKeywords = Array.isArray(b?.keywords) && b.keywords.length > 0;
    const qualified = b?.subscriptionStatus === 'active' && !!b?.googleConnected;
    const nextRunAt: Date | null = b?.autopilotNextRunAt ? new Date(b.autopilotNextRunAt) : null;

    let generating = false;
    let stalled = false;
    if (nextRunAt) {
      // Each run (first or weekly) sets nextRunAt = dispatch time + 7 days.
      const dispatchedAt = new Date(nextRunAt.getTime() - AUTOPILOT_INTERVAL_MS);
      const age = Date.now() - dispatchedAt.getTime();
      if (age >= 0 && age < AUTOPILOT_INTERVAL_MS) {
        const landed = await Post.exists({ businessId: ctx.businessId, createdAt: { $gte: new Date(dispatchedAt.getTime() - 60_000) } });
        generating = !landed && age < GENERATING_WINDOW_MS;
        // Dispatched but nothing arrived after 75 min — the job did not run or failed. Say so.
        stalled = !landed && age >= GENERATING_WINDOW_MS;
      }
    }

    return NextResponse.json({
      success: true,
      hasKeywords,
      qualified,
      nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
      generating,
      stalled,
    });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
