import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Post from '@/models/Post';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';

export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const skip = (page - 1) * limit;

    await dbConnect();

    const query = {
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
      aiGenerated: true,
      status: { $in: ['draft', 'scheduled', 'published', 'pending_approval'] },
    };

    const [posts, total] = await Promise.all([
      Post.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Post.countDocuments(query),
    ]);

    return NextResponse.json({
      success: true,
      posts,
      total,
      page,
      hasMore: skip + posts.length < total,
    });
  } catch (error: any) {
    console.error('Failed to fetch posts:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
