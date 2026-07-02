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

    // Reject anything before midnight UTC today
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    if (targetDate < startOfToday) {
      return NextResponse.json({ error: 'scheduledDate must be today or in the future' }, { status: 400 });
    }

    await dbConnect();

    const post = await Post.findOne({
      _id: new mongoose.Types.ObjectId(postId),
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    });

    if (!post) {
      return NextResponse.json({ error: 'Post not found or access denied' }, { status: 404 });
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
