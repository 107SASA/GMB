import { NextResponse } from 'next/server';
import { inngest } from '@/services/inngest/client';
import { requireBusinessContext } from '@/lib/tenant';

export async function POST(req: Request) {
  try {
    const { businessId } = await req.json();

    const ctx = await requireBusinessContext({ businessIdFromBody: businessId });
    if (!ctx.ok) return ctx.response;

    await inngest.send({
      name: 'scheduler/manual-generate',
      data: { businessId: ctx.businessId, force: true }
    });

    return NextResponse.json({ success: true, message: 'Generation job dispatched successfully.' }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to dispatch manual generation:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
