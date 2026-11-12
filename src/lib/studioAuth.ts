import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User, { type TeamPermission, TEAM_PERMISSIONS } from '@/models/User';
import { getSession } from '@/lib/session';
import { isSessionEpochValid } from '@/lib/sessionEpoch';

/**
 * Content Studio (/studio) access.
 *
 * Who gets in:
 *  - SUPER_ADMIN — everything, and is the only one who can approve/publish.
 *  - TEAM_MEMBER — only the areas in user.teamPermissions ('blog', 'cms').
 *
 * A TEAM_MEMBER is rejected by requireSuperAdmin() (all of /admin and
 * /api/admin) and by requireClient() (the customer dashboard), so this file is
 * the ONLY door they have. Every /api/studio/* handler must call
 * requireStudioApi() itself — the page layout guard does not protect APIs.
 */
export interface StudioViewer {
  userId: string;
  fullName: string;
  email: string;
  isSuperAdmin: boolean;
  permissions: TeamPermission[];
}

type Need = TeamPermission | 'any' | 'super_admin';

function allows(viewer: StudioViewer, need: Need): boolean {
  if (viewer.isSuperAdmin) return true;
  if (need === 'super_admin') return false;
  if (need === 'any') return viewer.permissions.length > 0;
  return viewer.permissions.includes(need);
}

/** The signed-in Studio user, or null (not signed in / not staff / session revoked). */
export async function getStudioViewer(): Promise<StudioViewer | null> {
  const session = await getSession();
  if (!session) return null;
  await dbConnect();
  const user = await User.findById(session.userId)
    .select('fullName email role teamPermissions sessionEpoch isDeleted')
    .lean<{ fullName?: string; email?: string; role?: string; teamPermissions?: string[]; sessionEpoch?: number; isDeleted?: boolean }>();
  if (!user || user.isDeleted) return null;
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'TEAM_MEMBER') return null;
  if (!isSessionEpochValid(session.sessionEpoch, user.sessionEpoch)) return null;
  const permissions = (user.teamPermissions || []).filter((p): p is TeamPermission =>
    (TEAM_PERMISSIONS as string[]).includes(p)
  );
  return {
    userId: session.userId,
    fullName: user.fullName || '',
    email: user.email || '',
    isSuperAdmin: user.role === 'SUPER_ADMIN',
    permissions: user.role === 'SUPER_ADMIN' ? [...TEAM_PERMISSIONS] : permissions,
  };
}

/** Page-side check (no response object): the viewer if they may see this area. */
export async function studioViewerFor(need: Need): Promise<StudioViewer | null> {
  const viewer = await getStudioViewer();
  return viewer && allows(viewer, need) ? viewer : null;
}

/** API guard for every /api/studio/* route. */
export async function requireStudioApi(
  need: Need
): Promise<{ ok: true; viewer: StudioViewer } | { ok: false; response: NextResponse }> {
  try {
    const viewer = await getStudioViewer();
    if (!viewer) {
      return {
        ok: false,
        response: NextResponse.json({ success: false, error: 'Please sign in again.' }, { status: 401 }),
      };
    }
    if (!allows(viewer, need)) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            success: false,
            error: need === 'super_admin' ? 'Only a Super Admin can do this.' : 'You do not have access to this area.',
          },
          { status: 403 }
        ),
      };
    }
    return { ok: true, viewer };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Server error during sign-in check' }, { status: 500 }),
    };
  }
}
