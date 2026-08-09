import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import { scheduleAsset } from '@/lib/gbpMediaService';

export const dynamic = 'force-dynamic';

const schema = z.object({
  // null clears the schedule (unschedule); omit entirely = same as null.
  scheduledFor: z.string().datetime().nullable().optional(),
});

/**
 * POST -> sets or clears a staged photo's auto-publish date. Actually
 * publishing it when that date arrives is publishScheduledMediaCron /
 * processScheduledMediaPublishJob (services/inngest/functions.ts), which
 * calls the same publishAsset() this app's manual "Publish" button uses.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  try {
    const date = parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null;
    const asset = await scheduleAsset(ctx.businessId, id, date);
    return NextResponse.json({ success: true, asset });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Failed to schedule photo' }, { status: 400 });
  }
}
