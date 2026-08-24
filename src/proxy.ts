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

// Post-payment intake: a subscribed workspace must complete the intake once
// before the rest of the dashboard opens. These pages stay reachable meanwhile
// so the user isn't fully trapped.
const INTAKE_PATH = '/dashboard/onboarding/intake';
const INTAKE_ALLOWED_PREFIXES = [INTAKE_PATH, '/dashboard/profile', '/dashboard/billing'];

// ADDITIVE — shadow accounts (see src/lib/shadowAccount.ts: passwordless
// accounts auto-created by /free-report and the WhatsApp report flow) get
// exactly one real credential-setting gate, checked BEFORE intake, the
// moment their workspace unlocks (i.e. right after paying). Without this a
// paying customer would have no durable way to log back into their account
// on another device/session — see POST /api/onboarding/claim.
const CLAIM_PATH = '/dashboard/onboarding/claim';

function isAllowedBeforeClaim(pathname: string): boolean {
  return pathname === CLAIM_PATH || pathname.startsWith(`${CLAIM_PATH}/`);
}

// Only NEW workspaces (created on/after this date) are HARD-gated into the
// intake. Workspaces that existed before are nudged with a notification instead
// (see scripts backfill), so we don't suddenly wall existing paying customers.
const INTAKE_ENFORCED_SINCE = new Date('2026-07-23T00:00:00.000Z');

function isAllowedBeforeIntake(pathname: string): boolean {
  return INTAKE_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// DIAGNOSTIC ONLY — dev-only CORS so the Expo web preview (localhost:808x,
// a different origin than this server) can call /api/* during local mobile
// testing. Strictly gated on NODE_ENV !== 'production'; never runs deployed.
// Native (Expo Go / built apps) is never subject to browser CORS and does
// not need this — safe to delete once web-preview testing is no longer needed.
function applyDevCors(request: NextRequest, response: NextResponse): NextResponse {
  if (process.env.NODE_ENV === 'production') return response;
  const origin = request.headers.get('origin');
  const isLocalOrigin =
    !!origin && /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+):\d+$/.test(origin);
  if (isLocalOrigin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-business-id, x-client'
    );
  }
  return response;
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (request.method === 'OPTIONS') {
      return applyDevCors(request, new NextResponse(null, { status: 204 }));
    }
    return applyDevCors(request, NextResponse.next());
  }

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
      .select('role subscriptionPlan isShadowAccount isEmailVerified shadowSource email claimSkipped')
      .lean<{
        role?: string;
        subscriptionPlan?: string;
        isShadowAccount?: boolean;
        isEmailVerified?: boolean;
        shadowSource?: string;
        email?: string;
        claimSkipped?: boolean;
      }>();
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
        businessCreatedAt: business.createdAt,
      })
    ) {
      // Paid + still a shadow account -> nudged to set a real email/password
      // before anything else, including intake. Checked as one combined
      // "claim still outstanding" condition (rather than two independent
      // early-return checks) so the intake gate below can never redirect a
      // pending-claim user away from the claim page — that was the exact bug:
      // isAllowedBeforeIntake() didn't exempt CLAIM_PATH, so a brand-new
      // (post-2026-07-23) shadow-account workspace landing on /claim got
      // bounced to /intake, which immediately bounced back to /claim
      // (isShadowAccount still true there) — an infinite redirect loop.
      //
      // NOT a hard block: gated on !claimSkipped (POST /api/onboarding/claim/skip).
      // Every shadow account has a phone number by construction (see
      // provisionShadowAccount) and /api/auth/phone-login already gives it a
      // durable way back in regardless of email/password state — the
      // "no way back in" risk this gate was built to prevent doesn't actually
      // apply once phone+OTP login exists, so this only nudges once and lets
      // the user dismiss it rather than trapping the dashboard behind it.
      const needsClaim =
        !user.claimSkipped &&
        (
          user.isShadowAccount ||
          // Claimed (isShadowAccount just flipped false) but the OTP step was
          // never completed -> the pre-existing session would otherwise let
          // this straight through, silently defeating the whole point of the
          // claim step for anyone relying on POST /api/auth/login (email/password),
          // which refuses unverified accounts. Scoped to former shadow accounts
          // only via shadowSource, so normal /onboarding signups (which never
          // get a session before verifying) are untouched.
          (!!user.shadowSource && !user.isEmailVerified)
        );

      if (needsClaim) {
        if (isAllowedBeforeClaim(pathname)) return NextResponse.next();
        const url = new URL(CLAIM_PATH, request.url);
        if (!user.isShadowAccount) {
          url.searchParams.set('step', 'verify');
          if (user.email) url.searchParams.set('email', user.email);
        }
        return NextResponse.redirect(url);
      }

      const isNewWorkspace = !!business.createdAt && new Date(business.createdAt) >= INTAKE_ENFORCED_SINCE;
      if (isNewWorkspace && !business.intakeCompleted && !isAllowedBeforeIntake(pathname)) {
        return NextResponse.redirect(new URL(INTAKE_PATH, request.url));
      }
      return NextResponse.next();
    }

    // Unsubscribed workspace: let every dashboard page RENDER (no redirect) so
    // the client-side WorkspaceLockGate can show it blurred with an upgrade
    // overlay — a locked user can see what each tab looks like before paying.
    // Data stays protected server-side: per-module API routes (CRM, Inbox,
    // Reviews, GBP insights, …) still enforce requireModule(), so the blurred
    // view never exposes real gated data.
    return NextResponse.next();
  } catch (err) {
    // DB/auth error — fail open to the existing per-page auth rather than
    // taking the whole dashboard down for every user.
    console.error('[proxy] workspace subscription gate check failed:', err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
