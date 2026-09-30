import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import AutomationLog from '@/models/AutomationLog';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { publishPost } from '@/services/content/publishPost';
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

    // Same transition as the scheduled cron (services/content/publishPost.ts):
    // published only when Google confirms; blocked while GBP live writes are
    // off ("Scheduled in GrowwMatics — Google publishing has not been
    // executed"); failed with Google's reason otherwise.
    const result = await publishPost(post._id.toString(), {
      businessId: ctx.businessId,
      allowFrom: ['draft', 'approved', 'scheduled', 'failed', 'blocked', 'pending_approval'],
    });
    cancelSleep();
    if (result.outcome === 'skipped') {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    const fresh = await Post.findById(post._id);
    if (result.outcome === 'failed') {
      return NextResponse.json({ error: result.reason, post: fresh }, { status: 502 });
    }
    if (result.outcome === 'blocked') {
      return NextResponse.json({ success: false, blocked: true, message: result.reason, post: fresh, liveWriteApplied: false }, { status: 200 });
    }
    if (fresh) {
      // The calendar places a post by scheduledDate — publishing now supersedes the old schedule.
      fresh.scheduledDate = fresh.publishedAt;
      await fresh.save();
    }
    const liveWriteApplied = true;

    await AutomationLog.create({
      tenantId: ctx.organizationId,
      businessId: ctx.businessId,
      type: 'scheduler',
      workflow: 'manual-publish',
      action: 'publish_post',
      status: 'success',
      message: `Manually published post: ${post.title}`,
    });

    return NextResponse.json({ success: true, post: fresh, liveWriteApplied }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to publish post:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
