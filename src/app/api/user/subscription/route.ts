import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import { requireClient } from '@/lib/auth';

export async function GET() {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();

  const subscription = await Subscription.findOne({ userId: auth.userId })
    .select('planType billingStatus trialStatus modules')
    .lean();

  if (!subscription) {
    return NextResponse.json({
      subscription: {
        planType: 'Free',
        billingStatus: 'Active',
        trialStatus: { isActive: false },
        modules: {},
      },
    });
  }

  return NextResponse.json({ subscription });
}
