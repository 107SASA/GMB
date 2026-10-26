import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import AdminInvite from '@/models/AdminInvite';
import User from '@/models/User';
import crypto from 'crypto';
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

// POST - create a new invite
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

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'A user with this email already exists' },
        { status: 400 }
      );
    }

    // Check if pending invite already exists
    const existingInvite = await AdminInvite.findOne({
      email,
      status: 'pending',
      expiresAt: { $gt: new Date() },
    });
    if (existingInvite) {
      return NextResponse.json(
        { success: false, error: 'A pending invite already exists for this email' },
        { status: 400 }
      );
    }

    // Generate a secure token; store ONLY its SHA-256 hash. The raw value is
    // returned once here (in inviteLink) and never persisted — see AdminInvite.ts.
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Expires in 48 hours
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const inviteLink = buildInviteLink(rawToken, process.env, req.headers, req.url);
    if (!inviteLink) {
      return NextResponse.json(
        { success: false, error: 'Could not build the invite link — set NEXT_PUBLIC_APP_URL.' },
        { status: 500 }
      );
    }

    // An expired pending invite for this email no longer blocks a new one.
    await AdminInvite.updateMany({ email, status: 'pending', expiresAt: { $lte: new Date() } }, { status: 'expired' });

    const invite = await AdminInvite.create({
      email,
      tokenHash,
      invitedBy: auth.userId,
      expiresAt,
    });

    // Don't echo the stored hash back to the client.
    const inviteView = invite.toObject();
    delete inviteView.tokenHash;

    {
      const { logSecurityEvent } = await import('@/services/security/securityLog');
      await logSecurityEvent(req, { type: 'admin.invite_create', outcome: 'success', severity: 'warning', userId: auth.userId, role: 'SUPER_ADMIN', subject: email, detail: 'New super admin invited' });
    }
    return NextResponse.json({
      success: true,
      data: { invite: inviteView, inviteLink },
    });
  } catch (error: any) {
    console.error('Invites POST Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create invite' },
      { status: 500 }
    );
  }
}

// DELETE - cancel/delete an invite
export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const { id } = await req.json();
    await AdminInvite.findByIdAndDelete(id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Invites DELETE Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete invite' },
      { status: 500 }
    );
  }
}