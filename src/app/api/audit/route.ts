import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import Business from '@/models/Business';
import GBPToken from '@/models/GBPToken';
import { requireClient } from '@/lib/auth';
import { requireBusinessContext } from '@/lib/tenant';
import { inngest } from '@/services/inngest/client';
import { checkUsageLimit, incrementUsage } from '@/lib/featureGating';
import { isWorkspaceUnlocked } from '@/lib/workspaceAccess';
import { checkRateLimit } from '@/lib/rateLimit';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

// Each run does a live SerpApi geo-grid check (45 calls) plus Groq calls —
// real, per-request cost on top of the plan's audit-count quota. This is a
// burst guard (per account, short window), independent of that quota.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const auditRequestSchema = z.object({
  businessId: z.string().min(1, 'Business ID is required'),
  categoryOverride: z.string().optional(),
  cityOverride: z.string().optional(),
  // Feature 2A — Review Analysis Range Selector
  reviewPeriodDays: z.union([z.literal(7), z.literal(14), z.literal(21)]).optional(),
  // Feature 2B — Improvement Plan Duration
  actionPlanDurationDays: z.union([z.literal(30), z.literal(45), z.literal(90)]).optional(),
});

export async function POST(req: Request) {
  try {
    const authResult = await requireClient();
    if (!authResult.ok) return authResult.response;

    const rl = checkRateLimit(`audit:${authResult.userId}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many audit requests — please wait a few minutes and try again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const body = await req.json();
    const parsed = auditRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.format() }, { status: 400 });
    }

    const { businessId, categoryOverride, cityOverride, reviewPeriodDays, actionPlanDurationDays } = parsed.data;

    await dbConnect();

    // Verify business ownership and data completeness
    const business = await Business.findById(businessId);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Per-workspace subscription gate: an unsubscribed workspace gets exactly
    // one free audit report. Once freeAuditUsed is set, further audits require
    // an active subscription for THIS workspace (or a paid user-level plan).
    // Owner (SUPER_ADMIN) bypasses.
    const workspaceUnlocked = isWorkspaceUnlocked({
      subscriptionStatus: business.subscriptionStatus,
      userSubscriptionPlan: (authResult.user as any).subscriptionPlan,
      businessCreatedAt: business.createdAt,
    });
    if (
      authResult.user.role !== 'SUPER_ADMIN' &&
      !workspaceUnlocked &&
      business.freeAuditUsed
    ) {
      return NextResponse.json(
        {
          error: 'This workspace has used its free audit. Subscribe to keep auditing this business.',
          code: 'UPGRADE_REQUIRED',
        },
        { status: 403 }
      );
    }

    // Once a workspace is paying, every audit run does a live SerpApi
    // geo-grid check (45 calls) and, on a business's first-ever audit, a
    // SerpApi review backfill — both real costs. Requiring Google to be
    // connected first ensures that spend only happens for businesses the
    // client has actually set up, not ones abandoned mid-onboarding. The
    // one-time free trial audit (workspace not yet unlocked) is exempt so
    // new signups can still see a report before connecting anything.
    if (authResult.user.role !== 'SUPER_ADMIN' && workspaceUnlocked) {
      const gbpToken = await GBPToken.findOne({ businessId: business._id }).select('_id').lean();
      if (!gbpToken) {
        return NextResponse.json(
          {
            error: 'Connect your Google Business Profile before running an audit.',
            code: 'GOOGLE_CONNECTION_REQUIRED',
          },
          { status: 403 }
        );
      }
    }

    const isOwner = business.userId?.toString() === authResult.userId;
    const isOrgMember = authResult.user.organizationId && business.organizationId?.toString() === authResult.user.organizationId?.toString();
    const isSuperAdmin = authResult.user.role === 'SUPER_ADMIN';
    const isDev = process.env.NODE_ENV !== 'production';

    if (!isOwner && !isOrgMember && !isSuperAdmin && !isDev) {
      console.warn(`[AUTH FAILED] User ${authResult.userId} tried to access Business ${businessId}. Business UserId: ${business.userId}, OrgId: ${business.organizationId}`);
      return NextResponse.json({ error: 'Unauthorized to access this business' }, { status: 403 });
    }

    const effectiveCategory = categoryOverride?.trim() || business.userDefinedCategory || business.category;
    if (!effectiveCategory) {
      return NextResponse.json({ error: 'Business Category is required. Enter it in the audit form.' }, { status: 400 });
    }

    // Duplicate-request guard: a double-click, a second browser tab, or a
    // retry after a slow response could otherwise create two PENDING audits
    // for the same business — burning the usage quota and the rate limit
    // twice for one intent. If one's already in flight, hand back that audit
    // instead of starting another. 5 minutes matches cleanupStalePendingAudits
    // (services/inngest/functions.ts) — anything older than that is already
    // considered stale/abandoned by that cron, not "in flight".
    const inFlight = await Audit.findOne({
      businessId: business._id,
      status: 'PENDING',
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
    }).sort({ createdAt: -1 });
    if (inFlight) {
      return NextResponse.json({ success: true, auditId: inFlight._id }, { status: 200 });
    }

    // Check feature gating limits — set AUDIT_BYPASS_MODE=true in .env.local to skip
    const bypassMode = process.env.AUDIT_BYPASS_MODE === 'true';
    if (!bypassMode) {
      const usageCheck = await checkUsageLimit(authResult.userId, business._id, 'audits');
      if (!usageCheck.allowed) {
        return NextResponse.json({ error: usageCheck.reason, code: usageCheck.code ?? 'UPGRADE_REQUIRED', limit: usageCheck.limit, used: usageCheck.used }, { status: 403 });
      }
      await incrementUsage(business._id, 'audits');
    }

    // Create a pending audit
    const locationStr = [business.city, business.state].filter(Boolean).join(', ');
    const finalLocation = locationStr || business.address || 'Location hidden';

    const audit = await Audit.create({
      tenantId: authResult.user.organizationId?.toString() || authResult.userId,
      userId: authResult.userId,
      organizationId: authResult.user.organizationId?.toString() || 'default',

      businessId: business._id,
      businessName: business.name,
      // Store the user-supplied override (or fall back to profile) so auditService uses the right category
      userDefinedCategory: effectiveCategory,
      website: business.website,
      phone: business.phone,
      address: business.address,
      // cityOverride takes precedence over the stored profile city
      city: cityOverride?.trim() || business.city,
      state: business.state,
      country: business.country,

      location: finalLocation,
      status: 'PENDING',
      // Feature 2 — undefined falls through to the schema defaults
      // (reviewPeriodDays: 14, actionPlanDurationDays: 30), preserving
      // existing behavior for any caller that doesn't pass these.
      reviewPeriodDays,
      actionPlanDurationDays,
      metadata: {
        userDefinedCategory: effectiveCategory,
      }
    });

    // Dispatch the job to Inngest for async processing
    try {
      await inngest.send({
        name: 'audit/generate.requested',
        data: { auditId: audit._id.toString() }
      });
    } catch (inngestError: any) {
      console.error('Inngest Dispatch Failed:', inngestError);
      return NextResponse.json({ error: 'Failed to connect to the background worker. Ensure you are running "npx inngest-cli@latest dev" in another terminal tab.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, auditId: audit._id }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create audit request:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = await requireBusinessContext({
      businessIdFromBody: searchParams.get('businessId') || undefined,
    });
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    // Workspace-scoped, not org-wide — an org member with multiple
    // businesses must only see the active workspace's audit history.
    const audits = await Audit.find({ businessId: ctx.businessId }).sort({ createdAt: -1 });

    return NextResponse.json(audits);
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch audits" },
      { status: 500 }
    );
  }
}
