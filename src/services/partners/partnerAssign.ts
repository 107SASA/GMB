import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import Business from '@/models/Business';
import User from '@/models/User';
import GrowthPartner from '@/models/GrowthPartner';
import AdminActionLog from '@/models/AdminActionLog';
import { logLeadEvent } from '@/services/leadEvents';
import { PLATFORM_TENANT } from '@/lib/admin/conversionFunnel';
import { round2 } from '@/lib/partners/commissionRules';

/**
 * Super admin: link a lead or a customer workspace to a Growth Partner by
 * hand, so a partner never misses commission when the automatic match can't
 * see the connection (we entered the lead ourselves, or the customer signed
 * up / paid from a different number).
 *
 *  - Lead, "credit"  → partner credited, our funnel keeps running the lead.
 *  - Lead, "managed" → handed to the partner: AI off, it shows in their CRM
 *                      as theirs (not for a lead that is already a customer).
 *  - Workspace       → that workspace's payments are credited to the partner,
 *                      ahead of any automatic match. Optionally credits the
 *                      payments it already made.
 *
 * Commissions already created for a payment are never moved or duplicated.
 */

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

async function logAction(adminId: string, action: string, metadata: Record<string, unknown>) {
  try {
    const admin = await User.findById(adminId).select('email').lean<{ email?: string }>();
    await AdminActionLog.create({ adminUserId: adminId, adminEmail: admin?.email, action, metadata });
  } catch (err: any) {
    console.error(`[partnerAssign] admin log failed (${action}):`, err?.message);
  }
}

async function activePartner(partnerId: unknown) {
  if (typeof partnerId !== 'string' || !mongoose.Types.ObjectId.isValid(partnerId)) return null;
  return GrowthPartner.findOne({ _id: partnerId, status: { $ne: 'suspended' } }).select('_id companyName partnerCode status').lean<any>();
}

const partnerRef = (p: any) => (p ? { id: String(p._id), name: p.companyName, code: p.partnerCode } : null);

/** Credits every payment of these workspaces that has no commission yet. */
async function creditPastPayments(businessIds: string[]): Promise<{ created: number; amount: number }> {
  if (!businessIds.length) return { created: 0, amount: 0 };
  const { default: CompanyInvoice } = await import('@/models/CompanyInvoice');
  const { createCommissionForInvoice } = await import('@/services/partners/partnerCommissions');
  const invoices: any[] = await CompanyInvoice.find({ businessId: { $in: businessIds } }).sort({ paidAt: 1 }).select('_id').lean();
  let created = 0;
  let amount = 0;
  // Oldest first, so the first payment is credited as "first" and the rest as renewals.
  for (const inv of invoices) {
    const r = await createCommissionForInvoice(String(inv._id)).catch(() => ({ created: false, amount: 0 }));
    if (r.created) {
      created++;
      amount += r.amount ?? 0;
    }
  }
  return { created, amount: round2(amount) };
}

/** Workspaces that belong to the person on this lead (by the lead's workspace, or the account on the lead's phone). */
async function workspacesForLead(lead: any): Promise<string[]> {
  const ids = new Set<string>();
  if (lead.businessId) ids.add(String(lead.businessId));
  if (lead.phone) {
    const { phoneVariants } = await import('@/services/billing/customerActivation');
    const users: any[] = await User.find({ phone: { $in: phoneVariants(lead.phone) } }).select('_id').lean();
    if (users.length) {
      const owned: any[] = await Business.find({ userId: { $in: users.map((u) => u._id) } }).select('_id').lean();
      owned.forEach((b) => ids.add(String(b._id)));
    }
  }
  return [...ids];
}

// ── Leads ────────────────────────────────────────────────────────────────

export async function getLeadPartner(leadId: string) {
  if (!mongoose.Types.ObjectId.isValid(leadId)) return null;
  await dbConnect();
  const lead: any = await Lead.findOne({ _id: leadId, tenantId: PLATFORM_TENANT }).select('partnerId partnerSource currentStage').lean();
  if (!lead) return null;
  const partner = lead.partnerId ? await GrowthPartner.findById(lead.partnerId).select('companyName partnerCode').lean<any>() : null;
  return { partner: partnerRef(partner), source: lead.partnerSource ?? null, isCustomer: lead.currentStage === 'CUSTOMER' };
}

export async function assignLeadToPartner(
  leadId: string,
  input: { partnerId?: unknown; mode?: unknown; creditPast?: unknown },
  adminId: string
) {
  if (!mongoose.Types.ObjectId.isValid(leadId)) return fail(404, 'Lead not found.');
  await dbConnect();
  const lead: any = await Lead.findOne({ _id: leadId, tenantId: PLATFORM_TENANT });
  if (!lead) return fail(404, 'Lead not found.');

  // Remove the partner.
  if (input.partnerId === null || input.partnerId === '') {
    if (!lead.partnerId) return { ok: true as const, partner: null, credited: { created: 0, amount: 0 } };
    const was = String(lead.partnerId);
    await Lead.updateOne({ _id: lead._id }, { $set: { partnerId: null, partnerSource: null } });
    await logLeadEvent('LEAD_UPDATED', { fields: ['partner'], by: 'team', removedPartnerId: was }, adminId, { leadId: lead._id, phone: lead.phone });
    await logAction(adminId, 'partner.lead_unassign', { leadId, partnerId: was });
    return { ok: true as const, partner: null, credited: { created: 0, amount: 0 } };
  }

  const partner = await activePartner(input.partnerId);
  if (!partner) return fail(400, 'Choose an active partner.');
  const mode = input.mode === 'managed' ? 'managed' : 'credit';
  if (mode === 'managed' && lead.currentStage === 'CUSTOMER') {
    return fail(400, 'This lead is already a customer — use “credit only”.');
  }

  await Lead.updateOne(
    { _id: lead._id },
    { $set: { partnerId: partner._id, partnerSource: mode === 'managed' ? 'added' : 'credit' } }
  );
  if (mode === 'managed') {
    // Hand it over: the AI stands down for good (same state as a lead the partner added).
    const { setLeadOwnership } = await import('@/services/leadOwnership/setLeadOwnership');
    await setLeadOwnership(lead._id, 'HUMAN', 'assigned-to-partner', adminId);
    if (lead.nurtureStatus !== 'OPTED_OUT') await Lead.updateOne({ _id: lead._id }, { $set: { nurtureStatus: 'STOPPED' } });
    const { cancelScheduledActions } = await import('@/services/scheduler/cancelScheduledActions');
    await cancelScheduledActions(lead._id, 'assigned-to-partner').catch(() => {});
  }
  await logLeadEvent('LEAD_UPDATED', { fields: ['partner'], by: 'team', partnerId: String(partner._id), mode }, adminId, { leadId: lead._id, phone: lead.phone });

  const credited = input.creditPast === true ? await creditPastPayments(await workspacesForLead(lead)) : { created: 0, amount: 0 };
  await logAction(adminId, 'partner.lead_assign', { leadId, partnerId: String(partner._id), mode, credited });
  return { ok: true as const, partner: partnerRef(partner), credited };
}

// ── Workspaces ───────────────────────────────────────────────────────────

/** Customer workspaces matching a name, phone or email — for linking to a partner. */
export async function searchCustomerWorkspaces(qRaw: unknown) {
  const q = typeof qRaw === 'string' ? qRaw.trim().slice(0, 80) : '';
  if (q.length < 2) return [];
  await dbConnect();
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const digits = q.replace(/\D/g, '');
  const users: any[] = await User.find({
    role: 'CLIENT',
    isDeleted: { $ne: true },
    $or: [{ email: rx }, { fullName: rx }, ...(digits.length >= 6 ? [{ phone: new RegExp(digits.slice(-10)) }] : [])],
  }).select('_id').limit(50).lean();
  const businesses: any[] = await Business.find({
    $or: [{ name: rx }, { userId: { $in: users.map((u) => u._id) } }, ...(digits.length >= 6 ? [{ phone: new RegExp(digits.slice(-10)) }] : [])],
  })
    .select('name city subscriptionStatus userId partnerId partnerAssignedBy createdAt')
    .sort({ createdAt: -1 })
    .limit(25)
    .lean();
  const owners: any[] = await User.find({ _id: { $in: businesses.map((b) => b.userId).filter(Boolean) } }).select('fullName email phone').lean();
  const ownerById = new Map(owners.map((o) => [String(o._id), o]));
  const partners: any[] = await GrowthPartner.find({ _id: { $in: businesses.map((b) => b.partnerId).filter(Boolean) } }).select('companyName partnerCode').lean();
  const partnerById = new Map(partners.map((p) => [String(p._id), p]));
  return businesses.map((b) => {
    const o = b.userId ? ownerById.get(String(b.userId)) : null;
    return {
      _id: String(b._id),
      name: b.name,
      city: b.city && b.city !== 'Unknown' ? b.city : null,
      subscriptionStatus: b.subscriptionStatus ?? null,
      owner: o ? { name: o.fullName, phone: o.phone, email: /\.(internal|invalid|local|test)$/i.test(o.email || '') ? null : o.email } : null,
      partner: b.partnerId ? partnerRef(partnerById.get(String(b.partnerId))) : null,
      linkedByTeam: !!b.partnerAssignedBy,
    };
  });
}

export async function linkWorkspaceToPartner(
  businessId: unknown,
  input: { partnerId?: unknown; creditPast?: unknown },
  adminId: string
) {
  if (typeof businessId !== 'string' || !mongoose.Types.ObjectId.isValid(businessId)) return fail(404, 'Workspace not found.');
  await dbConnect();
  const business: any = await Business.findById(businessId).select('partnerId name').lean();
  if (!business) return fail(404, 'Workspace not found.');

  if (input.partnerId === null || input.partnerId === '') {
    await Business.updateOne({ _id: businessId }, { $set: { partnerId: null, partnerAssignedBy: null, partnerAttributedAt: null } });
    await logAction(adminId, 'partner.workspace_unlink', { businessId, partnerId: business.partnerId ? String(business.partnerId) : null });
    return { ok: true as const, partner: null, credited: { created: 0, amount: 0 } };
  }

  const partner = await activePartner(input.partnerId);
  if (!partner) return fail(400, 'Choose an active partner.');
  await Business.updateOne(
    { _id: businessId },
    { $set: { partnerId: partner._id, partnerAssignedBy: adminId, partnerAttributedAt: new Date() } }
  );
  const credited = input.creditPast === true ? await creditPastPayments([businessId]) : { created: 0, amount: 0 };
  await logAction(adminId, 'partner.workspace_link', { businessId, partnerId: String(partner._id), credited });
  return { ok: true as const, partner: partnerRef(partner), credited };
}
