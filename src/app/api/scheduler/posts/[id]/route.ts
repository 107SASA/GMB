import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import mongoose from 'mongoose';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { inngest } from '@/services/inngest/client';
import { LivePostError, pushLivePostEdit, removeLivePost } from '@/services/content/livePost';

/** GET -> single post, for the mobile post-detail screen (view a post that
 *  isn't necessarily still in the buffer's ±calendar-window `allPosts`). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    // ADDITIVE (Sep 2026) — content_studio was never actually enforced
    // server-side; see lib/moduleGating.ts.
    const gate = await requireModule(ctx.userId, 'content_studio', ctx.businessId);
    if (!gate.ok) return gate.response;

    const { id } = await params;
    await dbConnect();

    const post = await Post.findOne({
      _id: new mongoose.Types.ObjectId(id),
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    }).lean();

    if (!post) {
      return NextResponse.json({ error: 'Post not found or access denied' }, { status: 404 });
    }

    return NextResponse.json({ success: true, post }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to fetch post:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    // ADDITIVE (Sep 2026) — content_studio was never actually enforced
    // server-side; see lib/moduleGating.ts.
    const gate = await requireModule(ctx.userId, 'content_studio', ctx.businessId);
    if (!gate.ok) return gate.response;

    const { id } = await params;
    await dbConnect();

    const post = await Post.findOne({
      _id: new mongoose.Types.ObjectId(id),
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    });

    if (!post) {
      return NextResponse.json({ error: 'Post not found or access denied' }, { status: 404 });
    }

    // Live on Google: removed there first, then here (services/content/livePost.ts).
    try {
      await removeLivePost(post);
    } catch (err) {
      if (err instanceof LivePostError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      throw err;
    }

    const wasScheduled = post.status === 'scheduled';
    await post.deleteOne();

    if (wasScheduled) {
      void inngest.send({
        name: 'scheduler/post-unscheduled',
        data: { postId: id },
      }).catch((err) => console.error('[scheduler/posts/id DELETE] post-unscheduled event failed:', err));
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to delete post:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}

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
    // ADDITIVE (Sep 2026) — content_studio was never actually enforced
    // server-side; see lib/moduleGating.ts.
    const gate = await requireModule(ctx.userId, 'content_studio', ctx.businessId);
    if (!gate.ok) return gate.response;

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
    // Live on Google: the new text goes to Google first; if Google refuses,
    // nothing is saved here (services/content/livePost.ts).
    if (post.status === 'published' && (title !== undefined || content !== undefined)) {
      try {
        await pushLivePostEdit(post);
      } catch (err) {
        if (err instanceof LivePostError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
        throw err;
      }
    }
    await post.save();

    return NextResponse.json({ success: true, post }, { status: 200 });
  } catch (error: any) {
    console.error('Failed to update post:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
