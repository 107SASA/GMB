import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import GrowthPartner from '@/models/GrowthPartner';
import PartnerCommission from '@/models/PartnerCommission';
import PartnerPayout from '@/models/PartnerPayout';
import User from '@/models/User';
import AdminActionLog from '@/models/AdminActionLog';
import {
  availableAt,
  commissionAmount,
  commissionBase,
  commissionStage,
  payoutTotals,
  round2,
  termsAt,
  withinRecurringWindow,
} from '@/lib/partners/commissionRules';

/**
 * Growth Partner commissions and payouts.
 *
 * Commissions are created from company invoices (one per captured payment):
 * right after the invoice job issues one, and by a daily sweep as a safety
 * net. Both are idempotent — PartnerCommission.paymentKey is unique.
 *
 * Who earns it: the partner on the paying workspace's platform lead (they
 * added it, or it came through their link), else the partner whose link the
 * workspace signed up through (Business.partnerId). Nobody else, ever.
 */

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

async function logAction(adminId: string, action: string, metadata: Record<string, unknown>) {
  try {
    const admin = await User.findById(adminId).select('email').lean<{ email?: string }>();
    await AdminActionLog.create({ adminUserId: adminId, adminEmail: admin?.email, action, metadata });
  } catch (err: any) {
    console.error(`[partnerCommissions] admin log failed (${action}):`, err?.message);
  }
}

/** The partner a workspace's payments are credited to, if any. */
export async function resolvePartnerForBusiness(businessId: string, userId: string | null) {
  const { default: Business } = await import('@/models/Business');
  const business: any = await Business.findById(businessId).select('partnerId userId name').lean();
  if (!business) return null;
  const ownerId = userId || (business.userId ? String(business.userId) : null);
  let lead: any = null;
  if (ownerId) {
    const { resolveLeadForPayment } = await import('@/services/billing/customerActivation');
    lead = await resolveLeadForPayment(ownerId, businessId).catch(() => null);
  }
  if (lead?.partnerId) {
    return { partnerId: String(lead.partnerId), leadId: String(lead._id), attribution: 'lead' as const, customerName: business.name || lead.businessType || lead.name || '' };
  }
  if (business.partnerId) {
    return { partnerId: String(business.partnerId), leadId: lead ? String(lead._id) : null, attribution: 'referral' as const, customerName: business.name || '' };
  }
  return null;
}

/** Creates the commission for one company invoice. Safe to call any number of times. */
export async function createCommissionForInvoice(invoiceId: string): Promise<{ created: boolean; reason?: string }> {
  await dbConnect();
  const { default: CompanyInvoice } = await import('@/models/CompanyInvoice');
  const inv: any = await CompanyInvoice.findById(invoiceId).lean();
  if (!inv) return { created: false, reason: 'no-invoice' };
  if (await PartnerCommission.exists({ paymentKey: inv.razorpayPaymentId })) return { created: false, reason: 'exists' };

  const who = await resolvePartnerForBusiness(String(inv.businessId), inv.userId ? String(inv.userId) : null);
  if (!who) return { created: false, reason: 'no-partner' };
  const partner: any = await GrowthPartner.findById(who.partnerId)
    .select('firstPaymentRate recurringRate holdDays recurringMonths termsHistory')
    .lean();
  if (!partner) return { created: false, reason: 'partner-missing' };

  const paidAt = new Date(inv.paidAt);
  const earlier = await CompanyInvoice.findOne({ businessId: inv.businessId, _id: { $ne: inv._id }, paidAt: { $lt: paidAt } })
    .sort({ paidAt: 1 })
    .select('paidAt')
    .lean<any>();
  const kind: 'first' | 'recurring' = earlier ? 'recurring' : 'first';
  const terms = termsAt(partner.termsHistory, partner, paidAt);
  if (kind === 'recurring' && !withinRecurringWindow(earlier ? new Date(earlier.paidAt) : null, paidAt, terms.recurringMonths)) {
    return { created: false, reason: 'outside-recurring-window' };
  }
  const rate = kind === 'first' ? terms.firstPaymentRate : terms.recurringRate;
  const base = commissionBase(inv.amount, inv.taxAmount);
  const amount = commissionAmount(base, rate);
  if (!(amount > 0)) return { created: false, reason: 'zero' };

  try {
    await PartnerCommission.create({
      partnerId: who.partnerId,
      kind,
      paymentKey: inv.razorpayPaymentId,
      businessId: inv.businessId,
      leadId: who.leadId,
      invoiceId: inv._id,
      invoiceNumber: inv.invoiceNumber,
      attribution: who.attribution,
      customerName: who.customerName,
      paidAt,
      paymentAmount: inv.amount,
      baseAmount: base,
      ratePercent: rate,
      amount,
      currency: inv.currency || 'INR',
      availableAt: availableAt(paidAt, terms.holdDays),
      status: 'pending',
    });
  } catch (err: any) {
    if (err?.code === 11000) return { created: false, reason: 'exists' };
    throw err;
  }

  try {
    const { sendCommissionEarnedEmail } = await import('@/services/partners/partnerEmails');
    const p: any = await GrowthPartner.findById(who.partnerId).select('email fullName').lean();
    if (p?.email) await sendCommissionEarnedEmail(p.email, p.fullName, { amount, customerName: who.customerName, kind });
  } catch { /* best-effort */ }
  return { created: true };
}

/** Daily safety net: invoices of the last `days` days without a commission. */
export async function sweepMissingCommissions(days = 7): Promise<{ checked: number; created: number }> {
  await dbConnect();
  const { default: CompanyInvoice } = await import('@/models/CompanyInvoice');
  const since = new Date(Date.now() - days * 86_400_000);
  const invoices: any[] = await CompanyInvoice.find({ paidAt: { $gte: since } }).select('_id razorpayPaymentId').limit(2000).lean();
  const done = new Set(
    ((await PartnerCommission.find({ paymentKey: { $in: invoices.map((i) => i.razorpayPaymentId) } }).select('paymentKey').lean()) as any[]).map((c) => c.paymentKey)
  );
  let created = 0;
  for (const inv of invoices) {
    if (done.has(inv.razorpayPaymentId)) continue;
    try {
      if ((await createCommissionForInvoice(String(inv._id))).created) created++;
    } catch (err: any) {
      console.error('[partnerCommissions] sweep failed for invoice', String(inv._id), err?.message);
    }
  }
  return { checked: invoices.length, created };
}

// ── Views ────────────────────────────────────────────────────────────────

export function commissionView(c: any, now = new Date()) {
  return {
    _id: String(c._id),
    kind: c.kind,
    customerName: c.customerName || (c.kind === 'adjustment' ? 'Adjustment' : 'Customer'),
    invoiceNumber: c.invoiceNumber ?? null,
    attribution: c.attribution ?? null,
    paidAt: c.paidAt,
    paymentAmount: c.paymentAmount,
    baseAmount: c.baseAmount,
    ratePercent: c.ratePercent,
    amount: c.amount,
    availableAt: c.availableAt,
    status: c.status,
    stage: commissionStage(c, now),
    payoutId: c.payoutId ? String(c.payoutId) : null,
    reversalReason: c.status === 'reversed' ? c.reversalReason ?? null : null,
  };
}

export function summarize(rows: any[], now = new Date()) {
  const s = { onHold: 0, ready: 0, approved: 0, paid: 0, lifetime: 0 };
  for (const c of rows) {
    if (c.status === 'reversed') continue;
    const stage = commissionStage(c, now);
    if (stage === 'on_hold') s.onHold += c.amount;
    else if (stage === 'ready') s.ready += c.amount;
    else if (stage === 'approved') s.approved += c.amount;
    else if (stage === 'paid') s.paid += c.amount;
    s.lifetime += c.amount;
  }
  return { onHold: round2(s.onHold), ready: round2(s.ready), approved: round2(s.approved), paid: round2(s.paid), lifetime: round2(s.lifetime) };
}

export async function partnerCommissionsFor(partnerId: string) {
  await dbConnect();
  const rows: any[] = await PartnerCommission.find({ partnerId }).sort({ paidAt: -1 }).limit(1000).lean();
  const now = new Date();
  return { summary: summarize(rows, now), commissions: rows.map((c) => commissionView(c, now)) };
}

export function payoutView(p: any) {
  return {
    _id: String(p._id),
    partnerId: String(p.partnerId),
    grossAmount: p.grossAmount,
    tdsPercent: p.tdsPercent,
    tdsAmount: p.tdsAmount,
    netAmount: p.netAmount,
    method: p.method,
    reference: p.reference,
    paidAt: p.paidAt,
    note: p.note ?? null,
    bank: p.bank ?? null,
    count: (p.commissionIds ?? []).length,
  };
}

export async function partnerPayoutsFor(partnerId: string) {
  await dbConnect();
  const rows: any[] = await PartnerPayout.find({ partnerId }).sort({ paidAt: -1 }).limit(500).lean();
  return rows.map(payoutView);
}

// ── Admin actions ────────────────────────────────────────────────────────

/** All commissions (optionally one partner), with partner names and per-partner totals. */
export async function adminCommissionList(opts: { partnerId?: string; stage?: string }) {
  await dbConnect();
  const filter: Record<string, unknown> = {};
  if (opts.partnerId && mongoose.Types.ObjectId.isValid(opts.partnerId)) filter.partnerId = opts.partnerId;
  const rows: any[] = await PartnerCommission.find(filter).sort({ paidAt: -1 }).limit(2000).lean();
  const partners: any[] = await GrowthPartner.find({ _id: { $in: [...new Set(rows.map((r) => String(r.partnerId)))] } })
    .select('companyName partnerCode kycStatus status tdsPercent kyc.bank.accountLast4 kyc.bank.ifsc kyc.bank.bankName kyc.bank.accountHolderName')
    .lean();
  const now = new Date();
  const byPartner = new Map<string, any[]>();
  rows.forEach((r) => {
    const k = String(r.partnerId);
    if (!byPartner.has(k)) byPartner.set(k, []);
    byPartner.get(k)!.push(r);
  });
  const partnerRows = partners.map((p) => ({
    _id: String(p._id),
    companyName: p.companyName,
    partnerCode: p.partnerCode,
    kycStatus: p.kycStatus,
    status: p.status,
    tdsPercent: p.tdsPercent ?? null,
    bank: p.kyc?.bank ? { accountHolderName: p.kyc.bank.accountHolderName, accountLast4: p.kyc.bank.accountLast4, ifsc: p.kyc.bank.ifsc, bankName: p.kyc.bank.bankName } : null,
    summary: summarize(byPartner.get(String(p._id)) ?? [], now),
    payable: round2((byPartner.get(String(p._id)) ?? []).filter((c) => c.status === 'approved' && !c.payoutId).reduce((s, c) => s + c.amount, 0)),
  }));
  const nameById = new Map(partners.map((p) => [String(p._id), p.companyName]));
  let commissions = rows.map((c) => ({ ...commissionView(c, now), partnerId: String(c.partnerId), partnerName: nameById.get(String(c.partnerId)) ?? 'Partner' }));
  if (opts.stage) commissions = commissions.filter((c) => c.stage === opts.stage);
  return { partners: partnerRows, commissions };
}

/** Approve commissions whose hold period is over. Others in the list are skipped. */
export async function approveCommissions(ids: unknown, adminId: string) {
  if (!Array.isArray(ids) || !ids.length) return fail(400, 'Choose commissions to approve.');
  const valid = ids.map(String).filter((id) => mongoose.Types.ObjectId.isValid(id)).slice(0, 1000);
  await dbConnect();
  const res = await PartnerCommission.updateMany(
    { _id: { $in: valid }, status: 'pending', availableAt: { $lte: new Date() } },
    { $set: { status: 'approved', approvedAt: new Date(), approvedBy: adminId } }
  );
  await logAction(adminId, 'partner.commission_approve', { count: res.modifiedCount, ids: valid.slice(0, 100) });
  return { ok: true as const, approved: res.modifiedCount, skipped: valid.length - res.modifiedCount };
}

/**
 * Reverse a commission (refund, chargeback, mistake). Not yet paid → it is
 * cancelled. Already paid → a negative adjustment is added, which comes off
 * the partner's next payout.
 */
export async function reverseCommission(id: string, reasonRaw: unknown, adminId: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(404, 'Commission not found.');
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim().slice(0, 300) : '';
  if (reason.length < 3) return fail(400, 'Give a reason (e.g. refund).');
  await dbConnect();
  const c: any = await PartnerCommission.findById(id).lean();
  if (!c) return fail(404, 'Commission not found.');
  if (c.kind === 'adjustment') return fail(400, 'An adjustment can’t be reversed.');
  if (c.status === 'reversed') return fail(409, 'Already reversed.');

  if (c.status === 'paid') {
    if (await PartnerCommission.exists({ sourceCommissionId: c._id })) return fail(409, 'Already clawed back.');
    await PartnerCommission.create({
      partnerId: c.partnerId,
      kind: 'adjustment',
      businessId: c.businessId,
      invoiceNumber: c.invoiceNumber,
      customerName: `Reversal: ${c.customerName || 'payment'}`,
      paidAt: new Date(),
      amount: -Math.abs(c.amount),
      availableAt: new Date(),
      status: 'approved',
      approvedAt: new Date(),
      approvedBy: adminId,
      sourceCommissionId: c._id,
      reversalReason: reason,
    });
    await logAction(adminId, 'partner.commission_clawback', { commissionId: id, amount: c.amount, reason });
    return { ok: true as const, clawback: true };
  }

  const res = await PartnerCommission.updateOne(
    { _id: c._id, status: { $in: ['pending', 'approved'] }, payoutId: null },
    { $set: { status: 'reversed', reversedAt: new Date(), reversedBy: adminId, reversalReason: reason } }
  );
  if (!res.modifiedCount) return fail(409, 'This commission just changed. Refresh and try again.');
  await logAction(adminId, 'partner.commission_reverse', { commissionId: id, amount: c.amount, reason });
  return { ok: true as const, clawback: false };
}

/**
 * Record a payout: everything approved and unpaid for this partner (incl.
 * clawbacks). Needs verified KYC and a non-suspended partner. The money is
 * sent outside the app (bank transfer); the admin enters its reference.
 */
export async function createPayout(partnerId: string, input: Record<string, unknown>, adminId: string) {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) return fail(404, 'Partner not found.');
  const reference = typeof input.reference === 'string' ? input.reference.trim().slice(0, 80) : '';
  if (reference.length < 4) return fail(400, 'Enter the bank transfer reference (UTR).');
  const method = input.method === 'upi' || input.method === 'other' ? input.method : 'bank_transfer';
  const paidAt = typeof input.paidAt === 'string' && input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 86_400_000) return fail(400, 'Pick a valid payment date.');
  const tdsRaw = input.tdsPercent === '' || input.tdsPercent == null ? 0 : Number(input.tdsPercent);
  if (!Number.isFinite(tdsRaw) || tdsRaw < 0 || tdsRaw > 30) return fail(400, 'TDS must be between 0 and 30%.');
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 300) || null : null;

  await dbConnect();
  const partner: any = await GrowthPartner.findById(partnerId).select('status kycStatus email fullName kyc.bank').lean();
  if (!partner) return fail(404, 'Partner not found.');
  if (partner.status === 'suspended') return fail(409, 'This partner is suspended. Reactivate them before paying out.');
  if (partner.kycStatus !== 'verified') return fail(409, 'Verify this partner’s KYC and bank details before paying out.');

  const due: any[] = await PartnerCommission.find({ partnerId, status: 'approved', payoutId: null }).select('_id amount').lean();
  const totals = payoutTotals(due.map((d) => d.amount), tdsRaw);
  if (!(totals.gross > 0)) return fail(400, 'Nothing approved to pay for this partner.');

  const payoutId = new mongoose.Types.ObjectId();
  // Claim exactly these rows for this payout; a concurrent payout claims none of them.
  const claim = await PartnerCommission.updateMany(
    { _id: { $in: due.map((d) => d._id) }, status: 'approved', payoutId: null },
    { $set: { payoutId } }
  );
  if (claim.modifiedCount !== due.length) {
    await PartnerCommission.updateMany({ payoutId }, { $set: { payoutId: null } });
    return fail(409, 'These commissions just changed. Refresh and try again.');
  }
  const bank = partner.kyc?.bank ?? {};
  try {
  await PartnerPayout.create({
    _id: payoutId,
    partnerId,
    commissionIds: due.map((d) => d._id),
    grossAmount: totals.gross,
    tdsPercent: totals.tdsPercent,
    tdsAmount: totals.tds,
    netAmount: totals.net,
    method,
    reference,
    paidAt,
    note,
    bank: { accountHolderName: bank.accountHolderName, accountLast4: bank.accountLast4, ifsc: bank.ifsc, bankName: bank.bankName },
    createdBy: adminId,
  });
  } catch (err) {
    // Payout not recorded — release the claimed rows so nothing is stuck.
    await PartnerCommission.updateMany({ payoutId }, { $set: { payoutId: null } });
    throw err;
  }
  await PartnerCommission.updateMany({ payoutId }, { $set: { status: 'paid' } });
  await logAction(adminId, 'partner.payout_create', { partnerId, payoutId: String(payoutId), ...totals, reference });

  try {
    const { sendPayoutSentEmail } = await import('@/services/partners/partnerEmails');
    await sendPayoutSentEmail(partner.email, partner.fullName, { net: totals.net, reference, paidAt, accountLast4: bank.accountLast4 ?? null });
  } catch { /* best-effort */ }
  return { ok: true as const, payoutId: String(payoutId), ...totals };
}

export async function adminPayoutList(partnerId?: string) {
  await dbConnect();
  const filter = partnerId && mongoose.Types.ObjectId.isValid(partnerId) ? { partnerId } : {};
  const rows: any[] = await PartnerPayout.find(filter).sort({ paidAt: -1 }).limit(1000).lean();
  const partners: any[] = await GrowthPartner.find({ _id: { $in: [...new Set(rows.map((r) => String(r.partnerId)))] } }).select('companyName partnerCode').lean();
  const byId = new Map(partners.map((p) => [String(p._id), p]));
  return rows.map((p) => ({ ...payoutView(p), partnerName: byId.get(String(p.partnerId))?.companyName ?? 'Partner', partnerCode: byId.get(String(p.partnerId))?.partnerCode ?? null }));
}
