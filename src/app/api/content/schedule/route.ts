import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';

const schedulePostSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  content: z.string().min(1, 'Content is required'),
  postType: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().optional(),
  tone: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = schedulePostSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }

    // businessId may be passed explicitly in the body or falls back to activeBusinessId cookie
    const ctx = await requireBusinessContext({ businessIdFromBody: body.businessId });
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const postData = parsed.data;

    const newPost = await Post.create({
      tenantId: ctx.organizationId,
      organizationId: ctx.organizationId,
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
      title: postData.title,
      content: postData.content,
      postType: postData.postType,
      hashtags: postData.hashtags || [],
      cta: postData.cta,
      tone: postData.tone,
      status: 'draft',
      aiGenerated: true,
      platform: 'gmb',
    });

    return NextResponse.json({ success: true, postId: newPost._id }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to schedule post:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
