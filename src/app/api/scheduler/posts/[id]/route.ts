import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';

const patchSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  cta: z.string().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const { id } = await params;

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    await dbConnect();

    const post = await Post.findOne({
      _id: new mongoose.Types.ObjectId(id),
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    });

    if (!post) {
      return NextResponse.json({ error: 'Post not found or access denied' }, { status: 404 });
    }

    const { title, content, hashtags, cta } = parsed.data;
    if (title !== undefined) post.title = title;
    if (content !== undefined) post.content = content;
    if (hashtags !== undefined) post.hashtags = hashtags;
    if (cta !== undefined) post.cta = cta;
    await post.save();

    return NextResponse.json({ success: true, post }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to update post:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
