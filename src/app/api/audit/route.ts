import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';
import { inngest } from '@/services/inngest/client';
import { checkUsageLimit, incrementUsage } from '@/lib/featureGating';

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

    const body = await req.json();
    const parsed = auditRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.format() }, { status: 400 });
    }

    const { businessId, categoryOverride, cityOverride, reviewPeriodDays, actionPlanDurationDays } = parsed.data;

    await dbConnect();

    // Feature 1 — freemium gate: a gated user gets exactly one COMPLETE
    // audit report total (not per-business, not per-month — a hard,
    // permanent cap until they upgrade). Existing users never have
    // freemiumAuditGate set, so this block is a no-op for them.
    if (authResult.user.freemiumAuditGate?.active && authResult.user.freemiumAuditGate?.auditUsed) {
      return NextResponse.json(
        {
          error: 'Your free plan includes one audit report. Upgrade to generate more.',
          code: 'UPGRADE_REQUIRED',
        },
        { status: 403 }
      );
    }

    // Verify business ownership and data completeness
    const business = await Business.findById(businessId);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
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
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const authResult = await requireClient();
    if (!authResult.ok) return authResult.response;

    await dbConnect();
    
    // Return audits for the active tenant
    const tenantId = authResult.user.organizationId?.toString() || authResult.userId;
    const audits = await Audit.find({ tenantId }).sort({ createdAt: -1 });

    return NextResponse.json(audits);
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch audits" },
      { status: 500 }
    );
  }
}
