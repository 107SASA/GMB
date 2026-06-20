import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import AutomationLog from '@/models/AutomationLog';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';

const publishSchema = z.object({
  postId: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

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

    post.status = 'published';
    post.publishedAt = new Date();
    await post.save();

    await AutomationLog.create({
      tenantId: ctx.organizationId,
      businessId: ctx.businessId,
      type: 'scheduler',
      workflow: 'manual-publish',
      action: 'publish_post',
      status: 'success',
      message: `Manually published post: ${post.title}`,
    });

    return NextResponse.json({ success: true, post }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to publish post:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
