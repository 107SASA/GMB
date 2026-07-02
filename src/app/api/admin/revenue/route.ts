import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Subscription from '@/models/Subscription';

const PLAN_PRICES: Record<string, number> = {
  Free: 0,
  Pro: 49,
  Enterprise: 149,
};

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const [
      allSubscriptions,
      planBreakdown,
      monthlyTrend,
      churnedThisMonth,
    ] = await Promise.all([
      Subscription.find({ billingStatus: 'Active' }).lean(),

      Subscription.aggregate([
        { $group: { _id: '$planType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Subscription.aggregate([
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
            },
            count: { $sum: 1 },
            plans: { $push: '$planType' },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        { $limit: 6 },
      ]),

      Subscription.countDocuments({
        billingStatus: 'Canceled',
        updatedAt: {
          $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      }),
    ]);

    // Calculate MRR from active subscriptions
    const mrr = allSubscriptions.reduce((sum, sub) => {
      return sum + (PLAN_PRICES[(sub as any).planType] || 0);
    }, 0);

    const arr = mrr * 12;
    const activePayingUsers = allSubscriptions.filter(
      (s) => (s as any).planType !== 'Free'
    ).length;

    // Format monthly trend
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const formattedTrend = monthlyTrend.map((item: any) => {
      const revenue = item.plans.reduce((sum: number, plan: string) => {
        return sum + (PLAN_PRICES[plan] || 0);
      }, 0);
      return {
        month: `${monthNames[item._id.month - 1]} ${item._id.year}`,
        revenue,
        count: item.count,
      };
    });

    // Plan breakdown with revenue
    const formattedPlanBreakdown = planBreakdown.map((item: any) => ({
      plan: item._id,
      count: item.count,
      revenue: (PLAN_PRICES[item._id] || 0) * item.count,
    }));

    return NextResponse.json({
      success: true,
      data: {
        mrr,
        arr,
        activePayingUsers,
        churnedThisMonth,
        planBreakdown: formattedPlanBreakdown,
        monthlyTrend: formattedTrend,
      },
    });
  } catch (error: any) {
    console.error('Revenue Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch revenue data' },
      { status: 500 }
    );
  }
}