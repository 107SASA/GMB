import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/session';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';
import { isWorkspaceUnlocked } from '@/lib/workspaceAccess';

/**
 * Per-workspace subscription gate.
 *
 * Runs on the Node.js runtime (stable as of Next.js 16 — see next.config.ts
 * / package.json "next": "16.2.6") so it can safely query MongoDB via
 * Mongoose, which does not work in the Edge runtime.
 *
 * This is the single, central place that enforces "each workspace (Business)
 * needs its own active subscription before its dashboard is accessible" for
 * every navigation — full page loads, client-side transitions, refresh,
 * back/forward, and direct URL entry all pass through here before any
 * /dashboard/* page renders.
 *
 * Behaviour for the ACTIVE workspace (the one selected via the
 * `activeBusinessId` cookie):
 *  - SUPER_ADMIN                          -> full access (owner is never gated).
 *  - subscriptionStatus === 'active'      -> full access.
 *  - not active, free audit NOT used yet  -> only the audit / billing / upgrade
 *                                            / profile pages; the free GBP audit
 *                                            is the hook. Other pages redirect
 *                                            to /dashboard/audit.
 *  - not active, free audit already used  -> only billing / upgrade / profile;
 *                                            everything else redirects to
 *                                            /dashboard/upgrade to subscribe.
 *
 * Fails OPEN (lets the request through to the per-page auth) when there is no
 * session, no active workspace selected, the workspace can't be found, or on a
 * DB error — so a transient issue never locks the whole dashboard.
 */

const SESSION_COOKIE = 'session';
const ACTIVE_BUSINESS_COOKIE = 'activeBusinessId';

// Pages an unsubscribed workspace can always reach.
const ALLOWED_PREFIXES = [
  '/dashboard/audit',     // the GMB Audit module itself (list, form, results)
  '/dashboard/billing',   // needed to actually subscribe
  '/dashboard/upgrade',   // the "subscribe to unlock this workspace" screen
  '/dashboard/profile',   // basic account/profile management stays available
];

function isAllowedForLockedWorkspace(pathname: string): boolean {
  return ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Post-payment intake: a subscribed workspace must complete the intake once
// before the rest of the dashboard opens. These pages stay reachable meanwhile
// so the user isn't fully trapped.
const INTAKE_PATH = '/dashboard/onboarding/intake';
const INTAKE_ALLOWED_PREFIXES = [INTAKE_PATH, '/dashboard/profile', '/dashboard/billing'];

// Only NEW workspaces (created on/after this date) are HARD-gated into the
// intake. Workspaces that existed before are nudged with a notification instead
// (see scripts backfill), so we don't suddenly wall existing paying customers.
const INTAKE_ENFORCED_SINCE = new Date('2026-07-23T00:00:00.000Z');

function isAllowedBeforeIntake(pathname: string): boolean {
  return INTAKE_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    // No session — let the existing per-page auth (DashboardLayout's
    // requireClient() redirect to /login) handle it.
    return NextResponse.next();
  }

  let session: { userId: string; role: string } | null = null;
  try {
    session = await verifySessionToken(token);
  } catch {
    return NextResponse.next();
  }
  if (!session) return NextResponse.next();

  try {
    await dbConnect();

    const user = await User.findById(session.userId)
      .select('role subscriptionPlan')
      .lean<{ role?: string; subscriptionPlan?: string }>();
    if (!user) return NextResponse.next();
    // Owner keeps full access to every workspace (incl. their WhatsApp AI).
    if (user.role === 'SUPER_ADMIN') return NextResponse.next();

    // Which workspace is the user acting on? Without a selected workspace we
    // can't decide — fail open and let the page/UI drive workspace selection.
    const businessId = request.cookies.get(ACTIVE_BUSINESS_COOKIE)?.value;
    if (!businessId) return NextResponse.next();

    const business = await Business.findById(businessId)
      .select('subscriptionStatus freeAuditUsed intakeCompleted createdAt')
      .lean<{ subscriptionStatus?: string; freeAuditUsed?: boolean; intakeCompleted?: boolean; createdAt?: Date }>();
    if (!business) return NextResponse.next();

    // Subscribed workspace (or an existing paid user) -> dashboard is open,
    // once the one-time post-payment intake is done. Only NEW workspaces are
    // hard-gated; older ones are nudged via notification instead.
    if (
      isWorkspaceUnlocked({
        subscriptionStatus: business.subscriptionStatus,
        userSubscriptionPlan: user.subscriptionPlan,
      })
    ) {
      const isNewWorkspace = !!business.createdAt && new Date(business.createdAt) >= INTAKE_ENFORCED_SINCE;
      if (isNewWorkspace && !business.intakeCompleted && !isAllowedBeforeIntake(pathname)) {
        return NextResponse.redirect(new URL(INTAKE_PATH, request.url));
      }
      return NextResponse.next();
    }

    // Unsubscribed workspace: gate everything except the allowed pages.
    if (isAllowedForLockedWorkspace(pathname)) return NextResponse.next();

    // Where a locked workspace gets sent:
    //  - Free audit not used yet -> /dashboard/audit, where they can generate
    //    the one free report (the hook).
    //  - Free audit already used -> straight to the subscribe screen.
    const destination = business.freeAuditUsed ? '/dashboard/upgrade' : '/dashboard/audit';
    if (pathname === destination) return NextResponse.next();

    return NextResponse.redirect(new URL(destination, request.url));
  } catch (err) {
    // DB/auth error — fail open to the existing per-page auth rather than
    // taking the whole dashboard down for every user.
    console.error('[proxy] workspace subscription gate check failed:', err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
