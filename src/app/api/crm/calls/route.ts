import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import CallEvent from '@/models/CallEvent';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Calls the business's connected telephony provider reported (Twilio today).
 * ?state=pending → inbound callers not yet saved / linked / dismissed (the
 * "Save as lead?" list). Otherwise the most recent calls.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    await dbConnect();
    const url = new URL(req.url);
    const businessId = new mongoose.Types.ObjectId(ctx.businessId);
    const filter: Record<string, unknown> = { businessId };
    if (url.searchParams.get('state') === 'pending') {
      filter.leadState = 'pending';
      filter.direction = 'inbound';
    }
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const [calls, pendingCount] = await Promise.all([
      CallEvent.find(filter)
        .populate('leadId', 'name phone lifeCycleStage subStage')
        .sort({ startedAt: -1 })
        .limit(limit)
        .lean(),
      CallEvent.countDocuments({ businessId, leadState: 'pending', direction: 'inbound' }),
    ]);
    return NextResponse.json({ success: true, calls, pendingCount });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
