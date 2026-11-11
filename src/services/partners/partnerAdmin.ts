import crypto from 'crypto';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import PartnerApplication from '@/models/PartnerApplication';
import GrowthPartner from '@/models/GrowthPartner';
import PartnerInvite from '@/models/PartnerInvite';
import User from '@/models/User';
import AdminActionLog from '@/models/AdminActionLog';
import { configuredAppBase, requestOrigin } from '@/lib/admin/inviteLink';
import {
  PARTNER_INVITE_DAYS,
  generatePartnerCode,
  partnerInvitePath,
  validatePartnerTerms,
} from '@/lib/partners/partnerRules';
import {
  sendApplicationApprovedEmail,
  sendApplicationRejectedEmail,
} from '@/services/partners/partnerEmails';

/**
 * Super admin actions on Growth Partner applications and partners.
 * Every action is recorded in AdminActionLog under the admin's id.
 */

type Fail = { ok: false; status: number; error: string };
type Result<T> = ({ ok: true } & T) | Fail;

export interface RequestContext {
  headers: { get(name: string): string | null };
  url: string;
}

function fail(status: number, error: string): Fail {
  return { ok: false, status, error };
}

function inviteLinkFor(rawToken: string, req: RequestContext): string | null {
  const base = configuredAppBase(process.env) || requestOrigin(req.headers, req.url);
  return base ? `${base}${partnerInvitePath(rawToken)}` : null;
}

async function logAction(adminId: string, action: string, metadata: Record<string, unknown>) {
  try {
    const admin = await User.findById(adminId).select('email').lean<{ email?: string }>();
    await AdminActionLog.create({ adminUserId: adminId, adminEmail: admin?.email, action, metadata });
  } catch (err: any) {
    console.error(`[partners] admin action log failed (${action}):`, err?.message);
  }
}

/** Expires earlier pending invites for this partner and issues a fresh one. Returns the raw link. */
async function issueInvite(
  partner: { _id: mongoose.Types.ObjectId; email: string },
  adminId: string,
  req: RequestContext
): Promise<Result<{ inviteLink: string; expiresAt: Date }>> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const inviteLink = inviteLinkFor(rawToken, req);
  if (!inviteLink) return fail(500, 'Could not build the invite link — set NEXT_PUBLIC_APP_URL.');

  await PartnerInvite.updateMany(
    { growthPartnerId: partner._id, status: 'pending' },
    { $set: { status: 'expired' } }
  );
  const expiresAt = new Date(Date.now() + PARTNER_INVITE_DAYS * 24 * 60 * 60 * 1000);
  await PartnerInvite.create({
    email: partner.email,
    tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
    growthPartnerId: partner._id,
    invitedBy: adminId,
    expiresAt,
  });
  return { ok: true, inviteLink, expiresAt };
}

async function createPartnerWithUniqueCode(fields: Record<string, unknown>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await GrowthPartner.create({ ...fields, partnerCode: generatePartnerCode(crypto.randomBytes) });
    } catch (err: any) {
      // Retry only a partnerCode collision; anything else (incl. a duplicate email) is real.
      if (err?.code === 11000 && err?.keyPattern?.partnerCode) continue;
      throw err;
    }
  }
  throw new Error('Could not generate a unique partner code');
}

export async function approveApplication(
  applicationId: string,
  body: Record<string, unknown>,
  adminId: string,
  req: RequestContext
): Promise<Result<{ partnerId: string; partnerCode: string; inviteLink: string; emailSent: boolean }>> {
  if (!mongoose.Types.ObjectId.isValid(applicationId)) return fail(404, 'Application not found');
  const terms = validatePartnerTerms(body);
  if (!terms.ok) return fail(400, terms.error);

  await dbConnect();
  const app = await PartnerApplication.findById(applicationId).lean<any>();
  if (!app) return fail(404, 'Application not found');
  if (app.status !== 'pending') return fail(409, `This application is already ${app.status}.`);

  if (await User.exists({ email: app.email })) {
    return fail(409, 'This email already has a Growwmatics AI account. Ask the applicant to apply with a different email.');
  }
  if (await GrowthPartner.exists({ email: app.email })) {
    return fail(409, 'A Growth Partner with this email already exists.');
  }

  // Claim the application atomically so two admins can't approve it twice.
  const claimed = await PartnerApplication.findOneAndUpdate(
    { _id: app._id, status: 'pending' },
    { $set: { status: 'approved', reviewedBy: adminId, reviewedAt: new Date(), rejectReason: null } },
    { new: true }
  );
  if (!claimed) return fail(409, 'This application was just reviewed by someone else.');

  let partner: any;
  try {
    partner = await createPartnerWithUniqueCode({
      applicationId: app._id,
      email: app.email,
      fullName: app.fullName,
      phone: app.phone,
      companyName: app.companyName,
      website: app.website ?? null,
      city: app.city,
      state: app.state,
      applicantType: app.applicantType,
      status: 'invited',
      ...terms.value,
      approvedBy: adminId,
      approvedAt: new Date(),
      termsHistory: [{ ...terms.value, changedBy: adminId, changedAt: new Date() }],
    });
  } catch (err: any) {
    await PartnerApplication.updateOne(
      { _id: app._id },
      { $set: { status: 'pending' }, $unset: { reviewedBy: 1, reviewedAt: 1 } }
    );
    console.error('[partners] create partner failed:', err?.message);
    return fail(500, 'Could not create the partner. Please try again.');
  }

  await PartnerApplication.updateOne({ _id: app._id }, { $set: { growthPartnerId: partner._id } });

  const invite = await issueInvite(partner, adminId, req);
  if (!invite.ok) return invite;

  const email = await sendApplicationApprovedEmail(app.email, app.fullName, invite.inviteLink, PARTNER_INVITE_DAYS);
  await logAction(adminId, 'partner.application_approve', {
    applicationId: String(app._id),
    partnerId: String(partner._id),
    email: app.email,
    ...terms.value,
  });

  return {
    ok: true,
    partnerId: String(partner._id),
    partnerCode: partner.partnerCode,
    inviteLink: invite.inviteLink,
    emailSent: !!(email as any)?.success,
  };
}

export async function rejectApplication(
  applicationId: string,
  reasonRaw: unknown,
  adminId: string
): Promise<Result<{ emailSent: boolean }>> {
  if (!mongoose.Types.ObjectId.isValid(applicationId)) return fail(404, 'Application not found');
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim().slice(0, 500) || null : null;

  await dbConnect();
  const app = await PartnerApplication.findOneAndUpdate(
    { _id: applicationId, status: 'pending' },
    { $set: { status: 'rejected', reviewedBy: adminId, reviewedAt: new Date(), rejectReason: reason } },
    { new: true }
  ).lean<any>();
  if (!app) {
    const exists = await PartnerApplication.exists({ _id: applicationId });
    return exists ? fail(409, 'This application was already reviewed.') : fail(404, 'Application not found');
  }

  const email = await sendApplicationRejectedEmail(app.email, app.fullName, reason);
  await logAction(adminId, 'partner.application_reject', { applicationId, email: app.email, reason });
  return { ok: true, emailSent: !!(email as any)?.success };
}

/** New invite link for a partner who hasn't created their account yet (old links stop working). */
export async function resendPartnerInvite(
  partnerId: string,
  adminId: string,
  req: RequestContext
): Promise<Result<{ inviteLink: string; emailSent: boolean }>> {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) return fail(404, 'Partner not found');
  await dbConnect();
  const partner = await GrowthPartner.findById(partnerId).lean<any>();
  if (!partner) return fail(404, 'Partner not found');
  if (partner.userId) return fail(409, 'This partner has already created their account.');
  if (partner.status !== 'invited') return fail(409, 'Reactivate this partner before sending a new link.');

  const invite = await issueInvite(partner, adminId, req);
  if (!invite.ok) return invite;
  const email = await sendApplicationApprovedEmail(partner.email, partner.fullName, invite.inviteLink, PARTNER_INVITE_DAYS);
  await logAction(adminId, 'partner.invite_resend', { partnerId, email: partner.email });
  return { ok: true, inviteLink: invite.inviteLink, emailSent: !!(email as any)?.success };
}

/** Changes a partner's commission terms. Applies to future payments only. */
export async function updatePartnerTerms(
  partnerId: string,
  body: Record<string, unknown>,
  adminId: string
): Promise<Result<{ partner: any }>> {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) return fail(404, 'Partner not found');
  const terms = validatePartnerTerms(body);
  if (!terms.ok) return fail(400, terms.error);

  await dbConnect();
  const before = await GrowthPartner.findById(partnerId)
    .select('firstPaymentRate recurringRate holdDays recurringMonths')
    .lean<any>();
  if (!before) return fail(404, 'Partner not found');

  const partner = await GrowthPartner.findByIdAndUpdate(
    partnerId,
    {
      $set: terms.value,
      $push: { termsHistory: { ...terms.value, changedBy: adminId, changedAt: new Date() } },
    },
    { new: true }
  ).lean();

  await logAction(adminId, 'partner.terms_update', {
    partnerId,
    before: {
      firstPaymentRate: before.firstPaymentRate,
      recurringRate: before.recurringRate,
      holdDays: before.holdDays,
      recurringMonths: before.recurringMonths ?? null,
    },
    after: terms.value,
  });
  return { ok: true, partner };
}

/**
 * Suspend (locks the partner out and signs them out everywhere) or reactivate.
 * A partner who hasn't created their account yet goes back to 'invited'.
 */
export async function setPartnerSuspended(
  partnerId: string,
  suspended: boolean,
  adminId: string
): Promise<Result<{ status: string }>> {
  if (!mongoose.Types.ObjectId.isValid(partnerId)) return fail(404, 'Partner not found');
  await dbConnect();
  const partner = await GrowthPartner.findById(partnerId).select('status userId').lean<any>();
  if (!partner) return fail(404, 'Partner not found');

  const status = suspended ? 'suspended' : partner.userId ? 'active' : 'invited';
  await GrowthPartner.updateOne({ _id: partnerId }, { $set: { status } });
  if (suspended && partner.userId) {
    const { invalidateUserSessions } = await import('@/lib/sessionInvalidation');
    await invalidateUserSessions(String(partner.userId), 'partner_suspended');
  }
  await logAction(adminId, suspended ? 'partner.suspend' : 'partner.reactivate', { partnerId });
  return { ok: true, status };
}
