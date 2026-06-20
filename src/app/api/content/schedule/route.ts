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
  scheduledDate: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = schedulePostSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const ctx = await requireBusinessContext({ businessIdFromBody: body.businessId });
    if (!ctx.ok) return ctx.response;

    const postData = parsed.data;

    let parsedScheduledDate: Date | undefined;
    if (postData.scheduledDate) {
      parsedScheduledDate = new Date(postData.scheduledDate);
      if (isNaN(parsedScheduledDate.getTime())) {
        return NextResponse.json({ error: 'Invalid scheduledDate format' }, { status: 400 });
      }
      if (parsedScheduledDate <= new Date()) {
        return NextResponse.json({ error: 'Scheduled date must be in the future' }, { status: 400 });
      }
    }

    await dbConnect();

    const newPost = await Post.create({
      tenantId: ctx.organizationId,
      organizationId: ctx.organizationId,
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
      userId: new mongoose.Types.ObjectId(ctx.userId),
      title: postData.title,
      content: postData.content,
      contentType: postData.postType,
      hashtags: postData.hashtags || [],
      cta: postData.cta,
      tone: postData.tone,
      status: parsedScheduledDate ? 'scheduled' : 'draft',
      scheduledDate: parsedScheduledDate,
      aiGenerated: true,
      platform: 'gmb',
    });

    return NextResponse.json({ success: true, postId: newPost._id }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to schedule post:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
