import User from '@/models/User';
import Business from '@/models/Business';
import { createdAtFilter, rangeScopeLabel, resolveDateRange } from '@/lib/admin/conversionFunnel';
import { SEGMENTS, currentFunnelStage, isSegment, phoneSearchDigits } from '@/lib/admin/leadMilestones';
import { crmDisplayName } from '@/lib/admin/platformCrm';
import { loadLeadRows, type LeadRow } from '@/services/admin/conversionReport';

/**
 * The Leads & Pipeline query — every filter applied before paging. Shared by
 * the table (GET /api/admin/conversion/pipeline) and Export CSV
 * (GET /api/admin/crm/export), so an export is exactly what is on screen.
 */
export async function queryPipeline(p: URLSearchParams) {
  const range = resolveDateRange(p);

  // Plain field filters go to Mongo; everything derived is applied below.
  const and: Record<string, unknown>[] = [createdAtFilter(range)];
  const eq = (key: string, param: string) => {
    const v = p.get(param);
    if (v) and.push({ [key]: v });
  };
  eq('currentAgent', 'agent');
  eq('intent', 'intent');
  eq('nextBestAction', 'nba');
  eq('nurtureStatus', 'nurture');
  eq('currentStage', 'crmStage'); // the editable CRM stage, exactly
  // A source matches the first channel OR any later one (captureSources).
  if (p.get('source')) and.push({ $or: [{ source: p.get('source') }, { captureSources: p.get('source') }] });
  if (p.get('assigned') === 'none') and.push({ assignedUserId: null });
  else eq('assignedUserId', 'assigned');

  const ownership = p.get('ownership');
  if (ownership === 'human') and.push({ $or: [{ currentAgent: 'HUMAN' }, { 'humanHandoff.active': true }] });
  else if (ownership === 'customer') and.push({ $or: [{ currentAgent: 'IN_HOUSE' }, { currentStage: 'CUSTOMER' }] });
  else if (ownership === 'ai') {
    and.push({ currentAgent: { $nin: ['HUMAN', 'IN_HOUSE'] }, currentStage: { $ne: 'CUSTOMER' }, 'humanHandoff.active': { $ne: true } });
  }

  const minScore = Number(p.get('minScore'));
  if (Number.isFinite(minScore) && minScore > 0) and.push({ leadScore: { $gte: minScore } });

  const q = (p.get('q') || '').trim();
  if (q) {
    const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const digits = phoneSearchDigits(q);
    and.push({
      $or: [
        { name: new RegExp(escape(q), 'i') },
        { businessType: new RegExp(escape(q), 'i') },
        ...(digits ? [{ phone: new RegExp(escape(digits)) }] : [{ phone: new RegExp(escape(q), 'i') }]),
      ],
    });
  }

  const filter = and.length > 1 ? { $and: and.filter((f) => Object.keys(f).length) } : and[0];
  let rows = await loadLeadRows(filter);
  const workspaces = await linkedWorkspaces(rows);

  const segment = p.get('segment');
  if (segment && isSegment(segment)) {
    rows = rows.filter((r) => SEGMENTS[segment].test({ lead: r.lead, reached: r.reached }));
  }
  const stage = p.get('stage');
  if (stage) rows = rows.filter((r) => currentFunnelStage(r.lead) === stage);

  const demo = p.get('demo');
  if (demo && demo !== 'any') {
    rows = rows.filter((r) => {
      const s = r.bookings[0]?.status; // most recently updated booking
      if (demo === 'none') return r.bookings.length === 0;
      if (demo === 'scheduled') return ['Pending', 'Confirmed', 'Rescheduled'].includes(s);
      if (demo === 'completed') return r.bookings.some((b) => b.status === 'Completed');
      return true;
    });
  }
  const payment = p.get('payment');
  if (payment) rows = rows.filter((r) => paymentStatus(r, workspaces.get(String(r.lead._id))) === payment);

  // Sort — "last activity" sorts by the same value the column shows.
  const [sortField = 'createdAt', sortDir = 'desc'] = (p.get('sort') || 'createdAt:desc').split(':');
  const sortValue: Record<string, (r: LeadRow) => number> = {
    createdAt: (r) => time(r.lead.createdAt),
    lastActivityAt: (r) => time(lastActivity(r.lead)),
    leadScore: (r) => r.lead.leadScore ?? 0,
    aiLeadScore: (r) => r.lead.aiLeadScore ?? -1,
    nextActionAt: (r) => time(r.lead.nextActionAt),
  };
  const pick = sortValue[sortField] ?? sortValue.createdAt;
  const dir = sortDir === 'asc' ? 1 : -1;
  rows.sort((a, b) => (pick(a) - pick(b)) * dir || (time(b.lead.createdAt) - time(a.lead.createdAt)));

  return {
    range: { key: range.key, label: rangeScopeLabel(range.key) },
    segment: segment && isSegment(segment) ? { key: segment, label: SEGMENTS[segment].label, description: SEGMENTS[segment].description } : null,
    rows,
    workspaces,
  };
}

const time = (d: unknown) => (d ? new Date(d as any).getTime() : 0);
const lastActivity = (l: any) => l.lastMeaningfulInteractionAt ?? l.lastActivityAt ?? null;

interface Workspace { name?: string; subscriptionStatus?: string }

/**
 * The workspace each lead signed up with: the lead's own businessId, else a
 * workspace owned by an account on the same phone (preferring a paying or
 * trial one). Platform prospects usually have no businessId.
 */
async function linkedWorkspaces(rows: LeadRow[]): Promise<Map<string, Workspace>> {
  const out = new Map<string, Workspace>();
  if (!rows.length) return out;
  const bizIds = rows.map((r) => r.lead.businessId).filter(Boolean);
  const phones = rows.map((r) => r.lead.phone).filter(Boolean);
  const users: any[] = phones.length ? await User.find({ phone: { $in: phones } }).select('_id phone').lean() : [];
  const businesses: any[] = await Business.find({
    $or: [{ _id: { $in: bizIds } }, { userId: { $in: users.map((u) => u._id) } }],
  })
    .select('_id userId name subscriptionStatus')
    .lean();
  const byId = new Map(businesses.map((b) => [String(b._id), b]));
  const userByPhone = new Map(users.map((u) => [u.phone, String(u._id)]));
  const rank = (s?: string) => ['active', 'trial_active', 'past_due'].indexOf(s || '') === -1 ? 9 : ['active', 'trial_active', 'past_due'].indexOf(s || '');
  for (const r of rows) {
    let ws = r.lead.businessId ? byId.get(String(r.lead.businessId)) : undefined;
    if (!ws) {
      const uid = userByPhone.get(r.lead.phone);
      const owned = uid ? businesses.filter((b) => String(b.userId) === uid).sort((a, b) => rank(a.subscriptionStatus) - rank(b.subscriptionStatus)) : [];
      ws = owned[0];
    }
    if (ws) out.set(String(r.lead._id), { name: ws.name, subscriptionStatus: ws.subscriptionStatus });
  }
  return out;
}

function paymentStatus(r: LeadRow, ws?: Workspace): 'verified' | 'trial' | 'pending' | 'none' {
  if (r.reached.has('paymentVerified') || ws?.subscriptionStatus === 'active') return 'verified';
  if (ws?.subscriptionStatus === 'trial_active') return 'trial';
  if (r.lead.currentStage === 'CONVERSION_PENDING') return 'pending';
  return 'none';
}

export function toRow(r: LeadRow, ws?: Workspace) {
  const l = r.lead;
  const isCustomer = l.currentAgent === 'IN_HOUSE' || l.currentStage === 'CUSTOMER';
  const isHuman = l.currentAgent === 'HUMAN' || l.humanHandoff?.active === true;
  return {
    _id: String(l._id),
    name: crmDisplayName({ name: l.name, businessType: ws?.name ?? l.businessType, phone: l.phone }),
    source: l.source ?? null,
    captureSources: l.captureSources?.length ? l.captureSources : l.source ? [l.source] : [],
    subStage: l.subStage ?? null,
    subStageId: l.subStageId ?? null,
    city: l.city ?? null,
    tags: l.tags ?? [],
    assignedUserId: l.assignedUserId ? String(l.assignedUserId) : null,
    dealValue: l.deal?.value ?? null,
    phone: l.phone ?? null,
    email: l.email ?? null,
    business: ws?.name ?? l.businessType ?? null,
    createdAt: l.createdAt,
    currentAgent: l.currentAgent ?? 'NONE',
    currentStage: l.currentStage ?? 'NEW',
    funnelStage: currentFunnelStage(l),
    intent: l.intent ?? null,
    leadScore: l.leadScore ?? 0,
    aiLeadScore: l.aiLeadScore ?? null,
    nextBestAction: l.nextBestAction ?? null,
    nextActionAt: l.nextActionAt ?? null,
    nurtureStatus: l.nurtureStatus ?? 'ACTIVE',
    lastActivityAt: lastActivity(l),
    ownership: isHuman ? 'HUMAN' : isCustomer ? 'CUSTOMER' : 'AI',
    humanHandoff: l.humanHandoff?.active ? { reason: l.humanHandoff.reason ?? null, since: l.humanHandoff.since ?? null } : null,
    demoStatus: r.bookings[0]?.status ?? null,
    paymentStatus: paymentStatus(r, ws),
  };
}
