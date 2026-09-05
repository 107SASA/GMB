import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import mongoose from 'mongoose';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Lightweight poll endpoint for freshly-generated post thumbnails.
 *
 * Thumbnails are generated in the background after /api/content/generate returns
 * (see that route's `after()` block), so the client polls this with the draft
 * post ids to swap the "generating…" placeholder for the real image once ready.
 * Returns only { id -> imageUrl } for the caller's own business.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    // ADDITIVE (Sep 2026) — content_studio was never actually enforced
    // server-side; see lib/moduleGating.ts.
    const gate = await requireModule(ctx.userId, 'content_studio');
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const idsParam = (searchParams.get('ids') || '').trim();
    if (!idsParam) return NextResponse.json({ success: true, images: {} });

    const ids = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => mongoose.Types.ObjectId.isValid(s))
      .slice(0, 50)
      .map((s) => new mongoose.Types.ObjectId(s));

    if (ids.length === 0) return NextResponse.json({ success: true, images: {} });

    await dbConnect();

    const posts = await Post.find(
      { _id: { $in: ids }, businessId: new mongoose.Types.ObjectId(ctx.businessId) },
      { imageUrl: 1 },
    ).lean();

    const images: Record<string, string | null> = {};
    for (const p of posts as any[]) {
      images[p._id.toString()] = p.imageUrl || null;
    }

    return NextResponse.json({ success: true, images });
  } catch (error: any) {
    console.error('Failed to fetch post images:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
