import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Business from '@/models/Business';
import User from '@/models/User';
import ContentGenerationLog from '@/models/ContentGenerationLog';

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(50, parseInt(searchParams.get('limit') || '20'));
    const search = searchParams.get('search') || '';
    const filter = searchParams.get('filter') || 'all'; // all | google | whatsapp

    const skip = (page - 1) * limit;

    // Build query
    const query: any = {};

    if (search.trim()) {
      query.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { category: { $regex: search.trim(), $options: 'i' } },
        { city: { $regex: search.trim(), $options: 'i' } },
        { address: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    if (filter === 'google') {
      query.googleConnected = true;
    } else if (filter === 'whatsapp') {
      query['whatsappConfig.isConnected'] = true;
    } else if (filter === 'onboarded') {
      query.onboardingCompleted = true;
    }

    const [businesses, total] = await Promise.all([
      Business.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'fullName email subscriptionPlan')
        .lean(),
      Business.countDocuments(query),
    ]);

    // Enrich with content generation counts
    const businessIds = businesses.map((b: any) => b._id);
    const contentCounts = await ContentGenerationLog.aggregate([
      { $match: { businessId: { $in: businessIds } } },
      { $group: { _id: '$businessId', count: { $sum: 1 } } },
    ]);

    const contentCountMap: Record<string, number> = {};
    contentCounts.forEach((c: any) => {
      contentCountMap[c._id.toString()] = c.count;
    });

    const enriched = businesses.map((b: any) => ({
      ...b,
      contentGeneratedCount: contentCountMap[b._id.toString()] || 0,
    }));

    return NextResponse.json({
      success: true,
      data: {
        businesses: enriched,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('Admin Businesses Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch businesses' },
      { status: 500 }
    );
  }
}
