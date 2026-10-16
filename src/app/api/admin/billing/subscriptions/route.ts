import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import BillingEvent from '@/models/BillingEvent';
import BillingRecoveryEpisode from '@/models/BillingRecoveryEpisode';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { buildMonitoringRow, statusFilter, MONITOR_STATUSES, type MonitorStatus } from '@/lib/billing/monitoring';

export const dynamic = 'force-dynamic';

/**
 * Super-admin subscription monitoring list (read-only).
 * GET ?status=<MonitorStatus>&q=<workspace / owner name / Razorpay id>&page=1&limit=25
 * Contact details are masked; no card or payment-credential data exists to show.
 */
const BILLED = {
  $or: [
    { subscriptionStatus: { $in: ['trial_active', 'active', 'past_due', 'canceled'] } },
    { razorpaySubscriptionId: { $exists: true, $ne: null } },
  ],
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  await dbConnect();

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const status = MONITOR_STATUSES.includes(statusParam as MonitorStatus) ? (statusParam as MonitorStatus) : null;
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '25', 10) || 25));
  const now = new Date();

  const and: Record<string, unknown>[] = [status ? statusFilter(status, now) : BILLED, { isDeleted: { $ne: true } }];
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const owners = await User.find({ fullName: rx }).select('_id').limit(200).lean<Array<{ _id: unknown }>>();
    and.push({
      $or: [
        { name: rx },
        { razorpaySubscriptionId: q },
        { billingSubscriptionId: q },
        { userId: { $in: owners.map((o) => o._id) } },
      ],
    });
  }
  const filter = { $and: and };

  const [total, businesses, counts] = await Promise.all([
    Business.countDocuments(filter),
    Business.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean<any[]>(),
    Promise.all(MONITOR_STATUSES.map(async (s) => [s, await Business.countDocuments({ $and: [statusFilter(s, now), { isDeleted: { $ne: true } }] })] as const)),
  ]);

  const ids = businesses.map((b) => b._id);
  const [owners, episodes, charges, rpEvents] = await Promise.all([
    User.find({ _id: { $in: businesses.map((b) => b.userId).filter(Boolean) } })
      .select('fullName phone email isPhoneVerified subscriptionPlan')
      .lean<any[]>(),
    BillingRecoveryEpisode.find({ businessId: { $in: ids } }).sort({ createdAt: -1 }).lean<any[]>(),
    BillingEvent.find({ businessId: { $in: ids }, actions: 'activate_paid' }).sort({ eventAt: -1 }).select('businessId amountPaise currency eventAt').lean<any[]>(),
    BillingEvent.find({ businessId: { $in: ids }, source: { $in: ['webhook', 'reconcile'] } }).sort({ eventAt: -1 }).select('businessId eventType eventAt').lean<any[]>(),
  ]);
  const first = <T extends { businessId?: unknown }>(list: T[]) => {
    const m = new Map<string, T>();
    for (const x of list) if (!m.has(String(x.businessId))) m.set(String(x.businessId), x);
    return m;
  };
  const ownerById = new Map(owners.map((o) => [String(o._id), o]));
  const episodeBy = first(episodes);
  const chargeBy = first(charges);
  const eventBy = first(rpEvents);

  return NextResponse.json({
    success: true,
    rows: businesses.map((b) =>
      buildMonitoringRow({
        business: b,
        owner: ownerById.get(String(b.userId)) ?? null,
        episode: episodeBy.get(String(b._id)) ?? null,
        lastCharge: chargeBy.get(String(b._id)) ?? null,
        lastRazorpayEvent: eventBy.get(String(b._id)) ?? null,
        now,
      })
    ),
    counts: Object.fromEntries(counts),
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
}
