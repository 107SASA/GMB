import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import GrowthPartner from '@/models/GrowthPartner';
import PartnerInvite from '@/models/PartnerInvite';
import { validatePasswordStrength } from '@/lib/passwordPolicy';
import { partnerLoginPhone } from '@/lib/partners/partnerRules';

/**
 * Growth Partner account creation from the approval email link.
 *
 * The account's email is the invite's email — the one the partner applied
 * and was approved with. The partner only chooses a password; the link
 * itself proves they control that inbox, so the email counts as verified.
 */

type Fail = { ok: false; status: number; error: string };

/** Loads a pending, unexpired invite by its raw token. Rejects non-string tokens (no Mongo operators). */
async function findLiveInvite(token: unknown): Promise<{ ok: true; invite: any; partner: any } | Fail> {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return { ok: false, status: 400, error: 'This link is not valid.' };
  }
  await dbConnect();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const invite = await PartnerInvite.findOne({ tokenHash }).lean<any>();
  if (!invite) return { ok: false, status: 400, error: 'This link is not valid.' };
  if (invite.status === 'accepted') {
    return { ok: false, status: 400, error: 'This link was already used. Please sign in to your partner account.' };
  }
  if (invite.status !== 'pending' || new Date(invite.expiresAt).getTime() <= Date.now()) {
    if (invite.status === 'pending') await PartnerInvite.updateOne({ _id: invite._id, status: 'pending' }, { status: 'expired' });
    return { ok: false, status: 400, error: 'This link has expired. Please ask us to send you a new one.' };
  }
  const partner = await GrowthPartner.findById(invite.growthPartnerId).lean<any>();
  if (!partner) return { ok: false, status: 400, error: 'This link is not valid.' };
  if (partner.userId || partner.status !== 'invited') {
    return { ok: false, status: 400, error: 'Your partner account already exists. Please sign in.' };
  }
  return { ok: true, invite, partner };
}

/** What the accept page shows before the partner sets a password. */
export async function checkPartnerInvite(token: unknown) {
  const r = await findLiveInvite(token);
  if (!r.ok) return r;
  return {
    ok: true as const,
    email: r.invite.email as string,
    fullName: r.partner.fullName as string,
    companyName: r.partner.companyName as string,
  };
}

export async function acceptPartnerInvite(token: unknown, password: unknown) {
  if (typeof password !== 'string' || !password) {
    return { ok: false as const, status: 400, error: 'Please choose a password.' };
  }
  const strength = validatePasswordStrength(password);
  if (!strength.isValid) return { ok: false as const, status: 400, error: strength.error as string };

  const r = await findLiveInvite(token);
  if (!r.ok) return r;
  const { invite, partner } = r;

  if (await User.exists({ email: invite.email })) {
    return {
      ok: false as const,
      status: 409,
      error: 'An account with this email already exists. Please contact us to link it.',
    };
  }

  // Single use: claim the invite before creating the account, so two
  // submissions of the same link can't both create one.
  const claimed = await PartnerInvite.findOneAndUpdate(
    { _id: invite._id, status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status: 'accepted', acceptedAt: new Date() } },
    { new: true }
  );
  if (!claimed) return { ok: false as const, status: 400, error: 'This link was already used.' };

  let user: any;
  try {
    user = await User.create({
      fullName: partner.fullName,
      email: invite.email,
      phone: partnerLoginPhone(partner.partnerCode),
      passwordHash: await bcrypt.hash(password, 12),
      role: 'GROWTH_PARTNER',
      companyName: partner.companyName,
      isEmailVerified: true,
    });
    const linked = await GrowthPartner.findOneAndUpdate(
      { _id: partner._id, userId: null, status: 'invited' },
      { $set: { userId: user._id, status: 'active' } },
      { new: true }
    );
    if (!linked) throw new Error('partner already linked');
  } catch (err: any) {
    // Undo so the link still works on retry.
    if (user?._id) await User.deleteOne({ _id: user._id }).catch(() => {});
    await PartnerInvite.updateOne({ _id: invite._id, status: 'accepted' }, { $set: { status: 'pending' }, $unset: { acceptedAt: 1 } });
    console.error('[partners] accept invite failed:', err?.message);
    return { ok: false as const, status: 500, error: 'Could not create your account. Please try again.' };
  }

  return { ok: true as const, email: invite.email as string };
}
