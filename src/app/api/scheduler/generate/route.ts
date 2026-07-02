import { NextResponse } from 'next/server';
import { inngest } from '@/services/inngest/client';

export async function POST(req: Request) {
  process.env.INNGEST_DEV = "1";
  process.env.INNGEST_EVENT_KEY = process.env.INNGEST_EVENT_KEY || "local";

  try {
    const { businessId } = await req.json();

    let finalBusinessId = businessId;

    if (!finalBusinessId) {
       const { getActiveBusinessContext } = await import('@/lib/business-context');
       const context = await getActiveBusinessContext();
       if (!context.ok) return NextResponse.json({ error: 'No active business context found' }, { status: 400 });
       finalBusinessId = context.business._id.toString();
    }

    await inngest.send({
      name: 'scheduler/manual-generate',
      data: { businessId: finalBusinessId, force: true }
    });

    return NextResponse.json({ success: true, message: 'Generation job dispatched successfully.' }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to dispatch manual generation:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
