import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { isQaTestingMode } from '@/lib/testingMode';

export const dynamic = 'force-dynamic';

/**
 * DEV / QA ONLY — small companion to /api/dev/simulate-payment for the
 * automated Lead Engine E2E suite (scripts/lead-engine-e2e.mjs). Exposes the
 * safe QA operations the suite needs that are otherwise behind super-admin
 * auth or an Inngest cron.
 *
 * HARD GATED on QA_TESTING_MODE=true — 404 in production (see
 * lib/testingMode.ts). Every action calls the SAME service function the real
 * (authenticated) path calls; nothing here is a shortcut around business
 * logic, only around the session cookie.
 *
 * Body: { action: 'return-to-ai', leadId, targetAgent? }
 */
export async function POST(req: Request) {
  if (!isQaTestingMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === 'return-to-ai') {
      const { leadId } = body;
      const targetAgent = body.targetAgent === 'IN_HOUSE' ? 'IN_HOUSE' : 'SALES';
      if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 });

      const { default: Lead } = await import('@/models/Lead');
      const lead: any = await Lead.findById(leadId).select('_id currentAgent humanHandoff').lean();
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      const isHuman = lead.currentAgent === 'HUMAN' || lead.humanHandoff?.active === true;
      if (!isHuman) {
        return NextResponse.json({ error: `Lead is not HUMAN-owned (currentAgent=${lead.currentAgent ?? 'NONE'})` }, { status: 409 });
      }

      const resumeStage = targetAgent === 'IN_HOUSE' ? 'CUSTOMER' : 'NURTURING';
      const { releaseFromHuman } = await import('@/services/leadOwnership/releaseFromHuman');
      await releaseFromHuman(leadId, targetAgent, 'qa-return-to-ai', 'qa', resumeStage);
      return NextResponse.json({ success: true, leadId, targetAgent, resumeStage });
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    console.error('[dev/lead-engine] failed:', error?.message);
    return NextResponse.json({ error: error?.message || 'failed' }, { status: 500 });
  }
}
