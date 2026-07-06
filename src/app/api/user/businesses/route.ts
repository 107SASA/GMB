import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const authResult = await requireClient();
    if (!authResult.ok) return authResult.response;

    await dbConnect();
    const userId = authResult.userId;

    const user = await User.findById(userId).select('businessIds organizationId').lean() as any;
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Same ownership rules as requireBusinessContext (lib/tenant.ts):
    // businesses owned by the user or belonging to their org. The legacy
    // user.businessIds array is included too — some older accounts only
    // link businesses through it.
    const ownershipConditions: any[] = [{ userId }];
    if (user.organizationId) {
      ownershipConditions.push({ organizationId: user.organizationId });
    }
    if (user.businessIds?.length) {
      ownershipConditions.push({ _id: { $in: user.businessIds } });
    }

    const businesses = await Business.find({ $or: ownershipConditions }).lean();

    return NextResponse.json(businesses, { status: 200 });

  } catch (error: any) {
    console.error('Fetch Businesses Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
