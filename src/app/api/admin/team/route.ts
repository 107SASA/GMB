import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import User from '@/models/User';
import { invalidateUserSessions } from '@/lib/sessionInvalidation';

/**
 * Content Studio team members (role TEAM_MEMBER) — Super Admin only.
 * Inviting goes through POST /api/admin/invites with role 'TEAM_MEMBER'.
 */

type Perm = 'blog' | 'cms';
const cleanPerms = (raw: unknown): Perm[] =>
  [...new Set((Array.isArray(raw) ? raw : []).filter((p): p is Perm => p === 'blog' || p === 'cms'))];

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    // Removed members are listed too (isDeleted) so they can be given access back.
    const members = await User.find({ role: 'TEAM_MEMBER', purgedAt: { $exists: false } })
      .select('fullName email phone teamPermissions lastLoginAt createdAt isDeleted deletedAt')
      .sort({ createdAt: -1 })
      .lean();
    return NextResponse.json({ success: true, data: members });
  } catch (error: any) {
    console.error('[admin/team] GET failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to load the team' }, { status: 500 });
  }
}

/**
 * Change which Studio areas a member can use (also gives a removed member
 * access back). Their open sessions are signed out so the change applies at once.
 */
export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const userId = body?.userId;
    if (typeof userId !== 'string' || !mongoose.Types.ObjectId.isValid(userId)) {
      return NextResponse.json({ success: false, error: 'Invalid team member' }, { status: 400 });
    }
    const permissions = cleanPerms(body?.permissions);
    if (permissions.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Keep at least one area, or use Remove to take away all access.' },
        { status: 400 }
      );
    }
    const updated = await User.findOneAndUpdate(
      { _id: userId, role: 'TEAM_MEMBER', purgedAt: { $exists: false } },
      { $set: { teamPermissions: permissions, isDeleted: false }, $unset: { deletedAt: '' } },
      { new: true }
    )
      .select('fullName email teamPermissions')
      .lean<any>();
    if (!updated) return NextResponse.json({ success: false, error: 'Team member not found' }, { status: 404 });

    await invalidateUserSessions(userId, 'team_permissions_changed');
    const { logSecurityEvent } = await import('@/services/security/securityLog');
    await logSecurityEvent(req, {
      type: 'admin.team_update',
      outcome: 'success',
      severity: 'warning',
      userId: auth.userId,
      role: 'SUPER_ADMIN',
      subject: updated.email,
      detail: `Access set to: ${permissions.join(', ')}`,
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('[admin/team] PATCH failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to update access' }, { status: 500 });
  }
}

/** Remove a member: account disabled, all sessions signed out. Their blog posts stay. */
export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const userId = body?.userId;
    if (typeof userId !== 'string' || !mongoose.Types.ObjectId.isValid(userId)) {
      return NextResponse.json({ success: false, error: 'Invalid team member' }, { status: 400 });
    }
    const removed = await User.findOneAndUpdate(
      { _id: userId, role: 'TEAM_MEMBER', isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), teamPermissions: [] } },
      { new: true }
    )
      .select('email')
      .lean<any>();
    if (!removed) return NextResponse.json({ success: false, error: 'Team member not found' }, { status: 404 });

    await invalidateUserSessions(userId, 'team_member_removed');
    const { logSecurityEvent } = await import('@/services/security/securityLog');
    await logSecurityEvent(req, {
      type: 'admin.team_remove',
      outcome: 'success',
      severity: 'warning',
      userId: auth.userId,
      role: 'SUPER_ADMIN',
      subject: removed.email,
      detail: 'Team member removed from Content Studio',
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[admin/team] DELETE failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to remove team member' }, { status: 500 });
  }
}
