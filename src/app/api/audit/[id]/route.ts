import { NextResponse } from 'next/server';
import { requireAuditAccess } from '@/lib/tenant';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> } // In Next.js 15, params is a Promise and needs to be awaited.
) {
  try {
    const { id } = await params;

    // Single source of truth for "is this caller allowed to view this
    // audit" (owner, org-mate, or SUPER_ADMIN) — no dev-environment bypass;
    // see lib/tenant.ts.
    const ctx = await requireAuditAccess(id);
    if (!ctx.ok) return ctx.response;

    // mobileView: the same verified display values the web report shows,
    // computed here so the mobile app never re-derives (or disagrees on) a number.
    const plain: any = typeof (ctx.audit as any)?.toObject === 'function' ? (ctx.audit as any).toObject() : ctx.audit;
    let mobileView = null;
    try {
      const { buildMobileReportView } = await import('@/services/audit/mobileView');
      if (plain?.status === 'COMPLETED') mobileView = buildMobileReportView(plain);
    } catch (e) {
      console.error('[audit] mobileView build failed:', e);
    }
    return NextResponse.json({ success: true, audit: ctx.audit, mobileView }, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch audit:', error);
    return NextResponse.json({ error: 'Something went wrong on our end. Please try again, and contact support if this keeps happening.' }, { status: 500 });
  }
}
