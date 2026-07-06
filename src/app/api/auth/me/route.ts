import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Subscription from '@/models/Subscription';
import { requireClient } from '@/lib/auth';

const SAFE_FIELDS = 'fullName email role organizationId activeBusinessId businessIds';

export async function GET() {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();

  const user = await User.findById(auth.userId, SAFE_FIELDS).lean();
  if (!user) {
    return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
  }

  const subscription = await Subscription.findOne(
    { userId: auth.userId },
    'planType billingStatus trialStatus modules'
  ).lean();

  return NextResponse.json({
    success: true,
    user: {
      id: (user._id as any).toString(),
      name: (user as any).fullName,
      email: (user as any).email,
      role: (user as any).role,
      organizationId: (user as any).organizationId?.toString() ?? null,
      activeBusinessId: (user as any).activeBusinessId?.toString() ?? null,
      businessIds: ((user as any).businessIds ?? []).map((id: any) => id.toString()),
      subscription: subscription
        ? {
            planType: (subscription as any).planType,
            billingStatus: (subscription as any).billingStatus,
            trialStatus: (subscription as any).trialStatus,
            modules: (subscription as any).modules,
          }
        : null,
    },
  });
}
