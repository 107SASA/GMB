import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import AdminInvite from '@/models/AdminInvite';
import User from '@/models/User';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { buildInviteLink, effectiveInviteStatus, normalizeInviteEmail } from '@/lib/admin/inviteLink';

// GET - list all invites
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const invites = await AdminInvite.find()
      .select('-tokenHash')
      .sort({ createdAt: -1 })
      .populate('invitedBy', 'fullName email')
      .lean();

    // A pending invite past its expiry can no longer be accepted.
    const now = new Date();
    const data = (invites as any[]).map((i) => ({ ...i, status: effectiveInviteStatus(i, now) }));
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Invites GET Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch invites' },
      { status: 500 }
    );
  }
}

const INVITE_TTL_HOURS = 48;

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Emails the invite link. Never throws; the link is also shown in the panel to copy. */
async function emailInvite(to: string, link: string, invitedByName: string) {
  const { sendTransactionalEmail } = await import('@/services/email');
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #eaeaea;border-radius:8px">
    <h2 style="margin:0 0 12px;color:#1a1a2e">You're invited to the Growwmatics AI admin panel</h2>
    <p style="color:#555;font-size:15px">${esc(invitedByName)} invited you to join as a <b>super admin</b>.</p>
    <p style="text-align:center;margin:28px 0"><a href="${link}" style="background:#4f6ef7;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Accept invite</a></p>
    <p style="color:#888;font-size:13px">This link works once and expires in ${INVITE_TTL_HOURS} hours. If you weren't expecting this, ignore this email.</p>
  </div>`;
  const r = await sendTransactionalEmail(to, 'Your Growwmatics AI super admin invite', html, undefined, { ignoreQaSuppression: true });
  if (!r.success) console.error('[admin/invites] invite email failed:', (r as any).error);
  return Boolean(r.success);
}

/** New single-use token for an invite; only its hash is stored. */
function newToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  return { rawToken, tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex') };
}

const inviteExpiry = () => new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

// POST - create a new invite (and email it)
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const body = await req.json().catch(() => ({}));
    const email = normalizeInviteEmail(body?.email);

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'A valid email is required' },
        { status: 400 }
      );
    }

    if (await User.exists({ email })) {
      return NextResponse.json(
        { success: false, error: 'A user with this email already exists' },
        { status: 400 }
      );
    }

    const existingInvite = await AdminInvite.findOne({ email, status: 'pending', expiresAt: { $gt: new Date() } });
    if (existingInvite) {
      return NextResponse.json(
        { success: false, error: 'A pending invite already exists for this email — use Resend on it instead.' },
        { status: 400 }
      );
    }

    const { rawToken, tokenHash } = newToken();
    const inviteLink = buildInviteLink(rawToken, process.env, req.headers, req.url);
    if (!inviteLink) {
      return NextResponse.json(
        { success: false, error: 'Could not build the invite link — set NEXT_PUBLIC_APP_URL.' },
        { status: 500 }
      );
    }

    // An expired pending invite for this email no longer blocks a new one.
    await AdminInvite.updateMany({ email, status: 'pending', expiresAt: { $lte: new Date() } }, { status: 'expired' });

    const invite = await AdminInvite.create({ email, tokenHash, invitedBy: auth.userId, expiresAt: inviteExpiry() });
    const inviteView = invite.toObject();
    delete inviteView.tokenHash;

    const emailSent = await emailInvite(email, inviteLink, (auth.user as any)?.fullName || 'A Growwmatics AI admin');
    const { logSecurityEvent } = await import('@/services/security/securityLog');
    await logSecurityEvent(req, { type: 'admin.invite_create', outcome: 'success', severity: 'warning', userId: auth.userId, role: 'SUPER_ADMIN', subject: email, detail: `New super admin invited${emailSent ? ' (emailed)' : ' (email failed — link shown to copy)'}` });

    return NextResponse.json({ success: true, data: { invite: inviteView, inviteLink, emailSent } });
  } catch (error: any) {
    console.error('Invites POST Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create invite' }, { status: 500 });
  }
}

// PATCH - resend: a fresh link (old one stops working), new 48 h expiry, emailed again
export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const id = body?.id;
    if (typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, error: 'Invalid invite' }, { status: 400 });
    }
    const invite = await AdminInvite.findById(id);
    if (!invite) return NextResponse.json({ success: false, error: 'Invite not found' }, { status: 404 });
    if (invite.status === 'accepted') {
      return NextResponse.json({ success: false, error: 'This invite was already accepted.' }, { status: 400 });
    }
    if (await User.exists({ email: invite.email })) {
      return NextResponse.json({ success: false, error: 'An account with this email already exists.' }, { status: 400 });
    }

    const { rawToken, tokenHash } = newToken();
    const inviteLink = buildInviteLink(rawToken, process.env, req.headers, req.url);
    if (!inviteLink) {
      return NextResponse.json({ success: false, error: 'Could not build the invite link — set NEXT_PUBLIC_APP_URL.' }, { status: 500 });
    }
    // Only one live invite per email.
    await AdminInvite.deleteMany({ email: invite.email, _id: { $ne: invite._id }, status: { $ne: 'accepted' } });
    const updated = await AdminInvite.findOneAndUpdate(
      { _id: invite._id, status: { $ne: 'accepted' } },
      { $set: { tokenHash, status: 'pending', expiresAt: inviteExpiry(), invitedBy: auth.userId } },
      { new: true }
    ).select('-tokenHash').lean();
    if (!updated) return NextResponse.json({ success: false, error: 'This invite was already accepted.' }, { status: 400 });

    const emailSent = await emailInvite(invite.email, inviteLink, (auth.user as any)?.fullName || 'A Growwmatics AI admin');
    const { logSecurityEvent } = await import('@/services/security/securityLog');
    await logSecurityEvent(req, { type: 'admin.invite_create', outcome: 'success', severity: 'warning', userId: auth.userId, role: 'SUPER_ADMIN', subject: invite.email, detail: `Super admin invite re-sent${emailSent ? ' (emailed)' : ' (email failed — link shown to copy)'}` });

    return NextResponse.json({ success: true, data: { invite: updated, inviteLink, emailSent } });
  } catch (error: any) {
    console.error('Invites PATCH Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to resend invite' }, { status: 500 });
  }
}

// DELETE - remove a pending or expired invite (accepted ones stay as a record)
export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const id = body?.id;
    if (typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, error: 'Invalid invite' }, { status: 400 });
    }
    const removed = await AdminInvite.findOneAndDelete({ _id: id, status: { $ne: 'accepted' } }).lean<any>();
    if (!removed) {
      return NextResponse.json({ success: false, error: 'Invite not found, or it was already accepted.' }, { status: 404 });
    }
    const { logSecurityEvent } = await import('@/services/security/securityLog');
    await logSecurityEvent(req, { type: 'admin.invite_delete', outcome: 'success', userId: auth.userId, role: 'SUPER_ADMIN', subject: removed.email, detail: 'Super admin invite deleted' });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Invites DELETE Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete invite' }, { status: 500 });
  }
}
