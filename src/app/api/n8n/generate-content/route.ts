import { NextResponse } from 'next/server';
import { validateApiKey } from '@/middleware/apiKeyAuth';
import { inngest } from '@/services/inngest/client';

export async function POST(req: Request) {
  const auth = validateApiKey(req);
  if (!auth.ok) return auth.response;

  try {
    const { businessId, missingDays } = await req.json();

    if (!businessId) {
      return NextResponse.json(
        { success: false, error: 'businessId is required' },
        { status: 400 }
      );
    }

    await inngest.send({
      name: 'scheduler/manual-generate',
      data: { businessId, force: true },
    });

    return NextResponse.json({
      success: true,
      triggered: true,
      businessId,
      generatedCount: missingDays ?? 7,
    });
  } catch (error: any) {
    console.error('[n8n/generate-content]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
