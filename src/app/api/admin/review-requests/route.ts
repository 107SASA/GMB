import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ReviewRequest from '@/models/ReviewRequest';
import Customer from '@/models/Customer';
import Business from '@/models/Business';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toAdminReviewDiagnostics } from '@/lib/reviewRequestFlow';

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['Pending', 'Sent', 'Delivered', 'Read', 'Failed', 'Cancelled']);

export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'all';
    const errorCode = (searchParams.get('errorCode') || '').trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25));

    const filter: Record<string, unknown> = {};
    if (status !== 'all') {
      if (!STATUSES.has(status)) {
        return NextResponse.json({ success: false, error: 'Unknown status filter' }, { status: 400 });
      }
      filter.status = status;
    }
    if (errorCode) filter.errorCode = errorCode;

    const [total, rows] = await Promise.all([
      ReviewRequest.countDocuments(filter),
      ReviewRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const customerIds = rows.map((row) => row.customerId);
    const businessIds = rows.map((row) => row.businessId);
    const [customers, businesses] = await Promise.all([
      Customer.find({ _id: { $in: customerIds } }).select('name phone').lean(),
      Business.find({ _id: { $in: businessIds } }).select('name').lean(),
    ]);
    const customerById = new Map(customers.map((customer) => [String(customer._id), customer]));
    const businessById = new Map(businesses.map((business) => [String(business._id), business]));

    const requests = rows.map((row) => {
      const customer = customerById.get(String(row.customerId));
      const business = businessById.get(String(row.businessId));
      return {
        ...toAdminReviewDiagnostics(row),
        customerName: customer?.name || 'Customer',
        customerPhone: customer?.phone || '',
        businessName: business?.name || 'Business',
      };
    });

    return NextResponse.json({
      success: true,
      requests,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('[admin review-requests] list failed:', error);
    return NextResponse.json({ success: false, error: 'Could not load review requests' }, { status: 500 });
  }
}
