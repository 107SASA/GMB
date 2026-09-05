import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import AutomationLog from '@/models/AutomationLog';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { createLocalPost } from '@/lib/gbpClient';
import mongoose from 'mongoose';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { inngest } from '@/services/inngest/client';

const publishSchema = z.object({
  postId: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    // ADDITIVE (Sep 2026) — content_studio was never actually enforced
    // server-side; see lib/moduleGating.ts.
    const gate = await requireModule(ctx.userId, 'content_studio');
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    await dbConnect();
    const { postId } = parsed.data;

    const post = await Post.findOne({
      _id: new mongoose.Types.ObjectId(postId),
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    });

    if (!post) {
      return NextResponse.json({ error: 'Post not found or access denied' }, { status: 404 });
    }

    // Captured before this route moves status away from 'scheduled' below —
    // either branch (published or failed) needs to cancel any sleeping
    // scheduleSinglePostPublish instance so it never fires a late,
    // now-redundant (or worse, doubled) publish at the original time.
    const wasScheduled = post.status === 'scheduled';
    const cancelSleep = () => {
      if (!wasScheduled) return;
      void inngest.send({
        name: 'scheduler/post-unscheduled',
        data: { postId: post._id.toString() },
      }).catch((err) => console.error('[scheduler/publish] post-unscheduled event failed:', err));
    };

    // Pushes the post to the real Google Business Profile. createLocalPost
    // itself is gated behind GBP_LIVE_WRITES_ENABLED (see src/lib/gbpSafety.ts)
    // — it no-ops (liveWriteApplied:false) while live writes are disabled, so
    // this stays a DB-only mock in that case, same as before. Once live writes
    // are on, this now actually reaches Google — matching the photo-publish
    // path (gbpMediaService.ts) and the scheduled-publish cron
    // (processPublishPostJob in services/inngest/functions.ts), which this
    // route had drifted from by never calling createLocalPost at all.
    let liveWriteApplied = false;
    try {
      const summary = [post.title, post.content].filter(Boolean).join('\n\n').slice(0, 1500);
      const result = await createLocalPost(ctx.businessId, {
        summary,
        mediaUrl: post.imageUrl || undefined,
      });
      liveWriteApplied = result.liveWriteApplied;
    } catch (err: any) {
      post.status = 'failed';
      post.failureReason = err.message || 'Failed to publish to Google Business Profile.';
      await post.save();
      cancelSleep();
      return NextResponse.json({ error: post.failureReason }, { status: 502 });
    }

    post.status = 'published';
    post.publishedAt = new Date();
    // The calendar (and other views) place a post using `scheduledDate`, not
    // `publishedAt`. Without updating this too, a post scheduled for a future
    // day would still show up under that future date after being published
    // immediately. Publishing now should supersede any prior schedule.
    post.scheduledDate = post.publishedAt;
    post.failureReason = undefined;
    await post.save();
    cancelSleep();

    await AutomationLog.create({
      tenantId: ctx.organizationId,
      businessId: ctx.businessId,
      type: 'scheduler',
      workflow: 'manual-publish',
      action: 'publish_post',
      status: 'success',
      message: `Manually published post: ${post.title}`,
    });

    return NextResponse.json({ success: true, post, liveWriteApplied }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to publish post:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
