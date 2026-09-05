import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import ShowcaseAsset from '@/models/ShowcaseAsset';
import Testimonial from '@/models/Testimonial';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * "Have we already got a video / review from this business?" — the single
 * source of truth both SuccessStoryPrompt (the dashboard popup) and
 * SuccessStoriesWorkspace (the actual form page) read to decide what to show.
 * Review and video are each one-time-only (owner's explicit call): a
 * 'rejected' submission does NOT count as used — the business gets another
 * try rather than being permanently locked out over something an admin
 * rejected (e.g. a fixable issue with the clip).
 */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();

    const [videoDone, reviewDone] = await Promise.all([
      ShowcaseAsset.exists({ businessId: ctx.businessId, mediaType: 'video', status: { $ne: 'rejected' } }),
      Testimonial.exists({ businessId: ctx.businessId, status: { $ne: 'rejected' } }),
    ]);

    return NextResponse.json({
      success: true,
      videoDone: !!videoDone,
      reviewDone: !!reviewDone,
    });
  } catch (err: any) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}
