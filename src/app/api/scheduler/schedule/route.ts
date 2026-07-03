import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';

const scheduleSchema = z.object({
  postId: z.string().min(1),
  scheduledDate: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const body = await req.json();
    const parsed = scheduleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { postId, scheduledDate } = parsed.data;
    const targetDate = new Date(scheduledDate);

    if (isNaN(targetDate.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduledDate format' }, { status: 400 });
    }

    // Reject anything that has already passed (previously only checked against
    // midnight, which let past times on the current day slip through)
    if (targetDate.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'scheduledDate must be in the future' }, { status: 400 });
    }

    await dbConnect();

    const post = await Post.findOne({
      _id: new mongoose.Types.ObjectId(postId),
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    });

    if (!post) {
      return NextResponse.json({ error: 'Post not found or access denied' }, { status: 404 });
    }

    // A published post is a completed action — it must never be silently
    // moved back to "scheduled" (e.g. via a drag-and-drop drop event).
    // Enforced here so this holds regardless of which UI path calls this
    // endpoint (calendar drag, manual reschedule modal, Content History).
    if (post.status === 'published') {
      return NextResponse.json({ error: 'Published posts cannot be rescheduled' }, { status: 409 });
    }

    post.status = 'scheduled';
    post.scheduledDate = targetDate;
    await post.save();

    return NextResponse.json({ success: true, post }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to schedule post:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
