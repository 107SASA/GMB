import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Audit from '@/models/Audit';
import { requireClient } from '@/lib/auth';

export interface BusinessContext {
  ok: true;
  userId: string;
  organizationId: string;
  businessId: string;
  business: Record<string, any>;
}

interface ContextFailure {
  ok: false;
  response: NextResponse;
}

export type BusinessContextResult = BusinessContext | ContextFailure;

/**
 * Resolves which business this request is acting on and verifies the caller
 * is allowed to access it.
 *
 * Resolution order:
 *   1. businessIdFromBody — an explicit ID passed by the route handler
 *      (routes that read ?businessId= from the query string pass it here too)
 *   2. x-business-id request header — how mobile clients select a workspace,
 *      since they have no activeBusinessId cookie
 *   3. activeBusinessId cookie — the browser's currently selected workspace
 *
 * Returns 401 if not logged in, 400 if no business can be resolved,
 * 403 if the resolved business does not belong to the caller.
 * Never falls back to a demo/shared tenant.
 */
export async function requireBusinessContext(
  options: { businessIdFromBody?: string } = {}
): Promise<BusinessContextResult> {
  const auth = await requireClient();
  if (!auth.ok) return auth;

  await dbConnect();

  // --- Resolve which business ID to use ---
  let businessId = options.businessIdFromBody;
  if (!businessId) {
    const headerList = await headers();
    businessId = headerList.get('x-business-id') ?? undefined;
  }
  if (!businessId) {
    const cookieStore = await cookies();
    businessId = cookieStore.get('activeBusinessId')?.value;
  }

  if (!businessId) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'No active business selected' },
        { status: 400 }
      ),
    };
  }

  // --- Verify ownership ---
  const userRole = (auth.user as any).role;
  let business: Record<string, any> | null;

  if (userRole === 'SUPER_ADMIN') {
    // Super admins can operate on any business (used with impersonation)
    business = await Business.findById(businessId).lean() as Record<string, any> | null;
  } else {
    // Regular users: must own the business or belong to the same org
    const ownershipConditions: any[] = [{ userId: auth.userId }];
    const userOrgId = (auth.user as any).organizationId;
    if (userOrgId) ownershipConditions.push({ organizationId: userOrgId });

    business = await Business.findOne({
      _id: businessId,
      $or: ownershipConditions,
    }).lean() as Record<string, any> | null;
  }

  if (!business) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Business not found or access denied' },
        { status: 403 }
      ),
    };
  }

  const organizationId: string = business.organizationId?.toString?.() ?? '';

  return {
    ok: true,
    userId: auth.userId,
    organizationId,
    businessId,
    business,
  };
}

export interface AuditContext {
  ok: true;
  userId: string;
  audit: Record<string, any>;
}

/**
 * Single source of truth for "is this caller allowed to view this Audit" —
 * owner, an org-mate of the owner, or SUPER_ADMIN. Previously re-derived by
 * hand in 3 separate routes (audit/[id], audit/[id]/pdf, audit/[id]/geo-map)
 * — two of which (pdf, geo-map) had drifted to a NARROWER owner-or-superadmin-
 * only check, missing the org-member case the third already allowed, so an
 * org-mate could see an audit's data but not its PDF/geo-map image. Also
 * previously each had its own NODE_ENV!=='production' escape hatch — removed
 * (Sep 2026), not replaced; see requireBusinessContext's equivalent note.
 *
 * Returns 401 if not logged in, 404 if the audit doesn't exist, 403 if it
 * exists but this caller isn't allowed to see it.
 */
export async function requireAuditAccess(
  auditId: string
): Promise<AuditContext | ContextFailure> {
  const auth = await requireClient();
  if (!auth.ok) return auth;

  await dbConnect();

  const audit = await Audit.findById(auditId).lean() as Record<string, any> | null;
  if (!audit) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Audit not found' }, { status: 404 }),
    };
  }

  const isOwner = String(audit.userId) === String(auth.userId);
  const userOrgId = (auth.user as any).organizationId?.toString?.();
  const isOrgMember = !!userOrgId && !!audit.organizationId && String(audit.organizationId) === userOrgId;
  const isSuperAdmin = (auth.user as any).role === 'SUPER_ADMIN';

  if (!isOwner && !isOrgMember && !isSuperAdmin) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, userId: auth.userId, audit };
}
