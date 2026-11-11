import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import GrowthPartner from '@/models/GrowthPartner';
import Lead from '@/models/Lead';
import Business from '@/models/Business';
import { logLeadEvent } from '@/services/leadEvents';
import {
  REF_COOKIE,
  REF_MAX_AGE_SECONDS,
  createdAfterClick,
  encodeRef,
  normalizePartnerCode,
  parseRef,
  shouldSetRef,
} from '@/lib/partners/referral';

/**
 * Referral-link attribution (see lib/partners/referral.ts for the rules).
 * Every function here is best-effort: a failure is logged and never breaks
 * the form or sign-up that called it.
 */

/** An active partner for this code, or null. */
export async function findActivePartnerByCode(codeRaw: unknown): Promise<{ _id: mongoose.Types.ObjectId; partnerCode: string } | null> {
  const code = normalizePartnerCode(codeRaw);
  if (!code) return null;
  await dbConnect();
  return GrowthPartner.findOne({ partnerCode: code, status: 'active' }).select('_id partnerCode').lean<any>();
}

/**
 * Records a click on a partner's link: sets the cookie on `res` unless the
 * browser already carries a valid one (first partner wins). Returns whether
 * the cookie was set.
 */
export async function recordReferralClick(codeRaw: unknown, existingCookie: string | undefined, res: NextResponse): Promise<boolean> {
  try {
    if (!shouldSetRef(existingCookie)) return false;
    const partner = await findActivePartnerByCode(codeRaw);
    if (!partner) return false;
    res.cookies.set(REF_COOKIE, encodeRef(partner.partnerCode, Date.now()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: REF_MAX_AGE_SECONDS,
    });
    await GrowthPartner.updateOne({ _id: partner._id }, { $inc: { referralClicks: 1 } });
    return true;
  } catch (err: any) {
    console.warn('[referral] click not recorded:', err?.message);
    return false;
  }
}

/** The referral the current request carries (cookie), resolved to an active partner. */
export async function currentReferral(): Promise<{ partnerId: mongoose.Types.ObjectId; clickedAt: Date } | null> {
  try {
    const store = await cookies();
    const ref = parseRef(store.get(REF_COOKIE)?.value);
    if (!ref) return null;
    const partner = await findActivePartnerByCode(ref.code);
    return partner ? { partnerId: partner._id, clickedAt: ref.clickedAt } : null;
  } catch {
    return null;
  }
}

/**
 * Credits a platform lead to the referring partner — only when it has no
 * partner yet and was created after the click. Keeps our normal funnel
 * (partnerSource 'referral'), so the AI keeps helping this lead.
 */
export async function attributeLeadFromReferral(leadId: unknown): Promise<boolean> {
  try {
    if (!leadId || !mongoose.Types.ObjectId.isValid(String(leadId))) return false;
    const ref = await currentReferral();
    if (!ref) return false;
    const lead: any = await Lead.findById(leadId).select('partnerId createdAt phone tenantId').lean();
    if (!lead || lead.tenantId !== 'gmbboost-internal' || lead.partnerId) return false;
    if (!createdAfterClick(lead.createdAt, ref.clickedAt)) return false;
    const res = await Lead.updateOne(
      { _id: lead._id, partnerId: null },
      { $set: { partnerId: ref.partnerId, partnerSource: 'referral' } }
    );
    if (!res.modifiedCount) return false;
    await logLeadEvent('LEAD_UPDATED', { fields: ['partner'], by: 'referral-link', partnerId: String(ref.partnerId) }, 'referral-link', { leadId: lead._id, phone: lead.phone });
    return true;
  } catch (err: any) {
    console.warn('[referral] lead attribution failed:', err?.message);
    return false;
  }
}

/** Credits a workspace created after the click (sign-up / free report) to the referring partner. */
export async function attributeBusinessFromReferral(businessId: unknown): Promise<boolean> {
  try {
    if (!businessId || !mongoose.Types.ObjectId.isValid(String(businessId))) return false;
    const ref = await currentReferral();
    if (!ref) return false;
    const business: any = await Business.findById(businessId).select('partnerId createdAt').lean();
    if (!business || business.partnerId) return false;
    if (!createdAfterClick(business.createdAt, ref.clickedAt)) return false;
    const res = await Business.updateOne(
      { _id: business._id, partnerId: null },
      { $set: { partnerId: ref.partnerId, partnerAttributedAt: new Date() } }
    );
    return res.modifiedCount > 0;
  } catch (err: any) {
    console.warn('[referral] business attribution failed:', err?.message);
    return false;
  }
}
