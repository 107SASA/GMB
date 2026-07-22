import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/session';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';

/**
 * Freemium "Audit-Only Access" gate (Feature 1).
 *
 * Runs on the Node.js runtime (stable as of Next.js 16 — see next.config.ts
 * / package.json "next": "16.2.6") so it can safely query MongoDB via
 * Mongoose, which does not work in the Edge runtime.
 *
 * This is the single, central place that enforces "new users can only
 * access the GMB Audit module until they upgrade" for every navigation —
 * full page loads, client-side transitions, page refresh, browser
 * back/forward, and direct URL entry all go through this file before any
 * /dashboard/* page renders.
 *
 * Existing users are unaffected: `freemiumAuditGate` is only ever set (to
 * `{ active: true, ... }`) for brand-new signups in /api/onboarding. Any
 * user without that flag (i.e. every pre-existing account) sails through
 * untouched.
 */

const SESSION_COOKIE = 'session';

// Pages a gated (audit-only) user is allowed to reach.
const ALLOWED_PREFIXES = [
  '/dashboard/audit',     // the GMB Audit module itself (list, form, results)
  '/dashboard/billing',   // needed to actually upgrade
  '/dashboard/upgrade',   // the "you've used your free audit" explainer page
  '/dashboard/profile',   // basic account/profile management stays available
];

function isAllowedForGatedUser(pathname: string): boolean {
  return ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    // No session — let the existing per-page auth (requireClient /
    // DashboardLayout's requireClient() redirect to /login) handle it.
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
      .select('role freemiumAuditGate')
      .lean<{ role?: string; freemiumAuditGate?: { active?: boolean; auditUsed?: boolean } }>();

    if (!user) return NextResponse.next();
    if (user.role === 'SUPER_ADMIN') return NextResponse.next();

    const gate = user.freemiumAuditGate;
    if (!gate?.active) return NextResponse.next();

    if (isAllowedForGatedUser(pathname)) return NextResponse.next();

    // Where a gated user gets sent when they hit a locked page:
    //  - No report yet  -> /dashboard/audit, which auto-generates their free one
    //    and then shows it with the pricing card alongside (AuditPaywallSidebar).
    //  - Report already used -> straight to pricing. They have had the free
    //    value; the next step is the decision to pay. Their report is still
    //    readable at /dashboard/audit, which stays in ALLOWED_PREFIXES.
    const destination = gate.auditUsed ? '/dashboard/upgrade' : '/dashboard/audit';
    if (pathname === destination) return NextResponse.next();

    return NextResponse.redirect(new URL(destination, request.url));
  } catch (err) {
    // DB/auth error — fail open to the existing per-page auth rather than
    // taking the whole dashboard down for every user.
    console.error('[proxy] freemium gate check failed:', err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
