import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import Lead from '@/models/Lead';
import DemoBooking from '@/models/DemoBooking';
import Business from '@/models/Business';
import {
  createdAtFilter,
  deriveFunnelStage,
  resolveDateRange,
  scoped,
} from '@/lib/admin/conversionFunnel';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * GET /api/admin/conversion/pipeline
 *
 * Server-side-filtered, server-side-paginated Lead Engine pipeline table.
 * Platform-tenant scoped. Query params (all optional):
 *   range / from / to        date window on Lead.createdAt
 *   agent                    currentAgent
 *   stage                    currentStage
 *   intent                   intent
 *   nba                      nextBestAction
 *   nurture                  nurtureStatus
 *   ownership                'ai' | 'human' | 'customer'
 *   minScore                 leadScore >=
 *   demo                     'scheduled' | 'completed' | 'none' | 'any'
 *   payment                  'verified' | 'pending' | 'none'
 *   q                        name / phone substring
 *   sort                     field:dir (e.g. leadScore:desc, createdAt:asc)
 *   page                     1-based
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const p = new URL(req.url).searchParams;
    const range = resolveDateRange(p);

    const filter: Record<string, unknown> = { ...createdAtFilter(range) };
    const eq = (key: string, param: string) => {
      const v = p.get(param);
      if (v) filter[key] = v;
    };
    eq('currentAgent', 'agent');
    eq('currentStage', 'stage');
    eq('intent', 'intent');
    eq('nextBestAction', 'nba');
    eq('nurtureStatus', 'nurture');

    const ownership = p.get('ownership');
    if (ownership === 'human') filter.currentAgent = 'HUMAN';
    else if (ownership === 'customer') filter.$or = [{ currentAgent: 'IN_HOUSE' }, { currentStage: 'CUSTOMER' }];
    else if (ownership === 'ai') filter.currentAgent = { $in: ['NONE', 'SALES', 'DEMO'] };

    const minScore = Number(p.get('minScore'));
    if (Number.isFinite(minScore) && minScore > 0) filter.leadScore = { $gte: minScore };

    const q = (p.get('q') || '').trim();
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$and = [{ $or: [{ name: rx }, { phone: rx }] }];
    }

    // Sort
    const [sortField = 'createdAt', sortDir = 'desc'] = (p.get('sort') || 'createdAt:desc').split(':');
    const allowedSort = new Set(['createdAt', 'lastActivityAt', 'leadScore', 'aiLeadScore', 'nextActionAt', 'updatedAt']);
    const sort: Record<string, 1 | -1> = { [allowedSort.has(sortField) ? sortField : 'createdAt']: sortDir === 'asc' ? 1 : -1 };

    const page = Math.max(1, Number(p.get('page')) || 1);

    const baseMatch = scoped(filter);
    const total = await Lead.countDocuments(baseMatch);
    const leads = await Lead.find(baseMatch)
      .sort(sort)
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select(
        'name phone email businessId currentAgent currentStage intent leadScore aiLeadScore ' +
          'nextBestAction nextActionAt nurtureStatus humanHandoff lastActivityAt lastMeaningfulInteractionAt createdAt'
      )
      .lean();

    const leadIds = leads.map((l: any) => l._id);
    const bizIds = leads.map((l: any) => l.businessId).filter(Boolean);

    const [demos, businesses] = await Promise.all([
      DemoBooking.find({ leadId: { $in: leadIds } })
        .select('leadId status date timeSlot updatedAt')
        .sort({ updatedAt: -1 })
        .lean(),
      bizIds.length
        ? Business.find({ _id: { $in: bizIds } }).select('name subscriptionStatus').lean()
        : [],
    ]);
    const demoByLead = new Map<string, any>();
    for (const d of demos as any[]) {
      // keep the most recently updated booking per lead
      if (!demoByLead.has(String(d.leadId))) demoByLead.set(String(d.leadId), d);
    }
    const bizMap = new Map((businesses as any[]).map((b) => [String(b._id), b]));

    const rows = leads.map((l: any) => {
      const demo = demoByLead.get(String(l._id));
      const biz = l.businessId ? bizMap.get(String(l.businessId)) : null;
      const isCustomer = l.currentAgent === 'IN_HOUSE' || l.currentStage === 'CUSTOMER';
      return {
        _id: String(l._id),
        name: l.name,
        phone: l.phone ?? null,
        email: l.email ?? null,
        business: biz?.name ?? null,
        createdAt: l.createdAt,
        currentAgent: l.currentAgent ?? 'NONE',
        currentStage: l.currentStage ?? 'NEW',
        funnelStage: deriveFunnelStage(l),
        intent: l.intent ?? null,
        leadScore: l.leadScore ?? 0,
        aiLeadScore: l.aiLeadScore ?? null,
        nextBestAction: l.nextBestAction ?? null,
        nextActionAt: l.nextActionAt ?? null,
        nurtureStatus: l.nurtureStatus ?? 'ACTIVE',
        lastActivityAt: l.lastMeaningfulInteractionAt ?? l.lastActivityAt ?? null,
        ownership: l.currentAgent === 'HUMAN' ? 'HUMAN' : isCustomer ? 'CUSTOMER' : 'AI',
        humanHandoff: l.humanHandoff?.active
          ? { reason: l.humanHandoff.reason ?? null, since: l.humanHandoff.since ?? null }
          : null,
        demoStatus: demo?.status ?? null,
        paymentStatus: isCustomer
          ? 'verified'
          : l.currentStage === 'CONVERSION_PENDING'
            ? 'pending'
            : biz?.subscriptionStatus === 'active'
              ? 'verified'
              : 'none',
      };
    });

    // Post-filter demo / payment (cheap on a 50-row page; keeps the query simple).
    const demoFilter = p.get('demo');
    const paymentFilter = p.get('payment');
    let filtered = rows;
    if (demoFilter && demoFilter !== 'any') {
      filtered = filtered.filter((r) => {
        if (demoFilter === 'none') return !r.demoStatus;
        if (demoFilter === 'scheduled') return ['Pending', 'Confirmed', 'Rescheduled'].includes(r.demoStatus || '');
        if (demoFilter === 'completed') return r.demoStatus === 'Completed';
        return true;
      });
    }
    if (paymentFilter) filtered = filtered.filter((r) => r.paymentStatus === paymentFilter);

    return NextResponse.json({
      success: true,
      rows: filtered,
      pagination: { page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) },
      note:
        demoFilter || paymentFilter
          ? 'demo/payment filters are applied to the current page only'
          : undefined,
    });
  } catch (error: any) {
    console.error('[admin/conversion/pipeline] failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
