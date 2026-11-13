import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';
import { freeCrmAllowed } from '@/lib/freeCrm';
import { listingFacts } from '@/lib/reportConnect';
import { startOrReuseFreeReport } from '@/services/leads/freeReport';
import { reportShareLink } from '@/services/leads/reportLink';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

/**
 * The free Google profile report inside the app — shown on the lock screens
 * of a Free CRM workspace (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md).
 *
 * GET  → { hasListing, report: { status, score, topFixes, createdAt, reportUrl } | null }
 *        reportUrl opens the full report in "app mode" (no prices / buy buttons).
 * POST { googlePlaceId? } → attach the listing if the workspace has none,
 *        then start (or reuse) the report. Free CRM workspaces only — paid
 *        workspaces get their reports from the normal monthly cycle.
 */

async function summary(businessId: string, userId: string) {
  const audit: any = await Audit.findOne({ businessId: new mongoose.Types.ObjectId(businessId) })
    .sort({ createdAt: -1 })
    .select('status overallScore auditData.priorityFixes auditData.profileScore createdAt')
    .lean();
  if (!audit) return null;
  const done = audit.status === 'COMPLETED';
  const fixes: any[] = Array.isArray(audit.auditData?.priorityFixes) ? audit.auditData.priorityFixes : [];
  return {
    auditId: String(audit._id),
    status: done ? 'ready' : audit.status === 'FAILED' ? 'failed' : 'preparing',
    score: done ? (audit.overallScore ?? audit.auditData?.profileScore?.overallScore ?? null) : null,
    topFixes: done ? fixes.map((f) => String(f?.title || '')).filter(Boolean).slice(0, 3) : [],
    createdAt: audit.createdAt,
    reportUrl: done ? await reportShareLink(audit._id, userId, { app: true }).catch(() => null) : null,
  };
}

export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    await dbConnect();
    const business: any = await Business.findById(ctx.businessId).select('googlePlaceId name').lean();
    return NextResponse.json({
      success: true,
      hasListing: !!business?.googlePlaceId,
      businessName: business?.name ?? null,
      report: await summary(ctx.businessId, ctx.userId),
    });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    if (!(await freeCrmAllowed(ctx.userId, ctx.businessId))) {
      return NextResponse.json({ error: 'Your reports are part of your plan — see the Performance tab.' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    await dbConnect();
    const business: any = await Business.findById(ctx.businessId);
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    // Attach the picked listing to a workspace that has none (never replaces one).
    const placeId = typeof body.googlePlaceId === 'string' ? body.googlePlaceId.trim().slice(0, 200) : '';
    if (!business.googlePlaceId) {
      if (!placeId) return NextResponse.json({ error: 'Pick your business on Google first.' }, { status: 400 });
      const facts: any = await listingFacts(placeId);
      business.googlePlaceId = placeId;
      for (const [k, v] of Object.entries(facts)) {
        if (v !== undefined && v !== null && v !== '' && (business.get(k) === undefined || business.get(k) === null || business.get(k) === '')) {
          business.set(k, v);
        }
      }
      await business.save();
    }

    const started = await startOrReuseFreeReport(business, { _id: business.organizationId ?? ctx.organizationId }, { _id: ctx.userId });
    if (!started.ok) return NextResponse.json({ error: started.error }, { status: 429 });
    return NextResponse.json({ success: true, reused: started.reused, report: await summary(ctx.businessId, ctx.userId) });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
