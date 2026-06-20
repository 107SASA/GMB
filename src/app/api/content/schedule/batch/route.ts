import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';

const batchPostSchema = z.object({
  posts: z
    .array(
      z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        postType: z.string().optional(),
        hashtags: z.array(z.string()).optional(),
        cta: z.string().optional(),
        tone: z.string().optional(),
        scheduledDate: z.string().optional(),
      })
    )
    .min(1, 'At least one post is required'),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = batchPostSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const now = new Date();
    const postsToInsert = [];

    for (const p of parsed.data.posts) {
      let parsedScheduledDate: Date | undefined;
      if (p.scheduledDate) {
        parsedScheduledDate = new Date(p.scheduledDate);
        if (isNaN(parsedScheduledDate.getTime()) || parsedScheduledDate <= now) {
          return NextResponse.json(
            { error: `Scheduled date for "${p.title}" is invalid or in the past` },
            { status: 400 }
          );
        }
      }

      postsToInsert.push({
        tenantId: ctx.organizationId,
        organizationId: ctx.organizationId,
        businessId: new mongoose.Types.ObjectId(ctx.businessId),
        userId: new mongoose.Types.ObjectId(ctx.userId),
        title: p.title,
        content: p.content,
        contentType: p.postType,
        hashtags: p.hashtags || [],
        cta: p.cta,
        tone: p.tone,
        status: parsedScheduledDate ? 'scheduled' : 'draft',
        scheduledDate: parsedScheduledDate,
        aiGenerated: true,
        platform: 'gmb',
      });
    }

    const savedPosts = await Post.insertMany(postsToInsert);

    return NextResponse.json(
      { success: true, count: savedPosts.length, postIds: savedPosts.map((p) => p._id) },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Failed to batch schedule posts:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
