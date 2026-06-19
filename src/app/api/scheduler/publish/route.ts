import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import AutomationLog from '@/models/AutomationLog';

const publishSchema = z.object({
  postId: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = publishSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    await dbConnect();
    const { postId } = parsed.data;
    
    const post = await Post.findById(postId);
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    post.status = 'published';
    post.publishedAt = new Date();
    await post.save();

    await AutomationLog.create({
      tenantId: post.tenantId,
      businessId: post.businessId?.toString(),
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
