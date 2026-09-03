import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/lead-engine/status — read-only operator view of the Lead
 * Engine control plane. Answers §35's questions in one call:
 *   - Is V2 enabled? (env flag)
 *   - Rollout percentage / allowlisted leads (OrchestrationConfig)
 *   - Per-lead: agent / stage / intent / score / NBA / nextActionAt /
 *     human ownership / customer status / pending scheduled actions
 *
 * Query params:
 *   ?leadId=<id>       — full detail for one lead
 *   ?phone=<phone>     — same, resolved by normalized phone (platform tenant)
 *   (none)             — control-plane summary + the allowlisted leads
 *
 * Never mutates anything. Never returns secrets.
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const url = new URL(req.url);
    const leadIdParam = url.searchParams.get('leadId');
    const phoneParam = url.searchParams.get('phone');

    const { default: OrchestrationConfig } = await import('@/models/OrchestrationConfig');
    const { default: Lead } = await import('@/models/Lead');
    const { default: ScheduledAction } = await import('@/models/ScheduledAction');

    const v2Enabled = process.env.LEAD_ENGINE_V2 === 'true';
    const config = await OrchestrationConfig.findOne({ key: 'default' }).lean() as any;

    const controlPlane = {
      leadEngineV2Enabled: v2Enabled,
      orchestrationConfig: config
        ? {
            exists: true,
            rolloutPercentage: config.rolloutPercentage ?? 0,
            allowlistCount: (config.leadIdAllowlist || []).length,
            cooldownHours: config.cooldownHours ?? null,
            cooldownHoursEnv: process.env.ORCHESTRATOR_COOLDOWN_HOURS ?? null,
            stuckLeadScoreThreshold: config.stuckLeadScoreThreshold ?? 76,
            stuckNurtureCyclesThreshold: config.stuckNurtureCyclesThreshold ?? 3,
          }
        : { exists: false, note: "Run: node scripts/lead-engine-config.mjs init" },
    };

    async function leadDetail(lead: any) {
      const pending = await ScheduledAction.find({ leadId: lead._id, status: 'PENDING' })
        .select('actionType dueAt createdBy payload')
        .sort({ dueAt: 1 })
        .lean();
      return {
        _id: String(lead._id),
        tenantId: lead.tenantId,
        name: lead.name,
        phone: lead.phone,
        currentAgent: lead.currentAgent ?? 'NONE',
        currentStage: lead.currentStage ?? null,
        nurtureStatus: lead.nurtureStatus ?? null,
        humanOwned: lead.currentAgent === 'HUMAN' || lead.humanHandoff?.active === true,
        humanHandoff: lead.humanHandoff ?? null,
        isCustomer: lead.currentStage === 'CUSTOMER' || lead.currentAgent === 'IN_HOUSE',
        leadScore: lead.leadScore ?? 0,
        intent: lead.intent ?? null,
        objections: (lead.objections || []).map((o: any) => ({ type: o.type, note: o.note, resolved: o.resolved })),
        painPoints: lead.painPoints ?? [],
        nextBestAction: lead.nextBestAction ?? null,
        nextActionAt: lead.nextActionAt ?? null,
        inV2Allowlist: (config?.leadIdAllowlist || []).map(String).includes(String(lead._id)),
        pendingScheduledActions: pending,
      };
    }

    if (leadIdParam || phoneParam) {
      let lead: any = null;
      if (leadIdParam && mongoose.Types.ObjectId.isValid(leadIdParam)) {
        lead = await Lead.findById(leadIdParam).lean();
      } else if (phoneParam) {
        const { normalizePhoneE164 } = await import('@/lib/phone');
        const norm = normalizePhoneE164(phoneParam) || phoneParam;
        lead = await Lead.findOne({ phone: norm, tenantId: 'gmbboost-internal' }).lean();
      }
      if (!lead) return NextResponse.json({ success: false, error: 'Lead not found.' }, { status: 404 });
      return NextResponse.json({ success: true, controlPlane, lead: await leadDetail(lead) });
    }

    // Summary view: control plane + every allowlisted lead's state.
    const allowlistIds = (config?.leadIdAllowlist || []) as mongoose.Types.ObjectId[];
    const allowlisted = allowlistIds.length
      ? await Lead.find({ _id: { $in: allowlistIds } }).lean()
      : [];
    const leads = await Promise.all(allowlisted.map((l: any) => leadDetail(l)));

    return NextResponse.json({ success: true, controlPlane, allowlistedLeads: leads });
  } catch (error: any) {
    console.error('[admin/lead-engine/status] failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
