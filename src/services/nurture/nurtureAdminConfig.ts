import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import SalesAgentConfig from '@/models/SalesAgentConfig';
import OrchestrationConfig from '@/models/OrchestrationConfig';
import NurtureConfigAudit from '@/models/NurtureConfigAudit';
import Lead from '@/models/Lead';
import { salesReplyBlockedReason } from '@/services/agentHandoff/isHumanOwned';
import {
  buildTimingSnapshot,
  configChangeSummary,
  defaultNurtureSchedule,
  followUpDelayMinutes,
  genericFollowUpSkipReason,
  nurtureMutationAllowed,
  proactiveCohortDecision,
  validateNurtureSchedule,
  type NurtureFollowUpStep,
  type NurtureScheduleInput,
  type NurtureTimingSnapshot,
} from '@/services/nurture/nurtureSchedule';

export interface NurtureAdminView extends NurtureScheduleInput {
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Keep a step's template when the admin reorders. Synthetic ids encode the original index. */
function priorFollowUp(existing: any[], stepId: string): { mode?: string; template?: string; aiSystemPrompt?: string } {
  const byId = existing.find((row) => row?.id && String(row.id) === stepId);
  const synthetic = /^follow-up-(\d+)$/.exec(stepId);
  const byOriginalIndex = synthetic ? existing[Number(synthetic[1]) - 1] : undefined;
  const row = byId || (byOriginalIndex && !byOriginalIndex.id ? byOriginalIndex : null);
  const plain = row && typeof row.toObject === 'function' ? row.toObject() : row;
  return {
    mode: plain?.mode,
    template: plain?.template,
    aiSystemPrompt: plain?.aiSystemPrompt,
  };
}

function stepFromStored(step: any, index: number): NurtureFollowUpStep {
  return {
    id: typeof step?.id === 'string' && step.id ? step.id : `follow-up-${index + 1}`,
    enabled: step?.enabled !== false,
    delayMinutes: followUpDelayMinutes(step || {}),
    onlyIfNoReply: step?.onlyIfNoReply !== false,
    description: typeof step?.description === 'string' ? step.description : '',
  };
}

/** Read the live schedule without inserting a missing sales-agent document. */
export async function readNurtureAdminView(): Promise<NurtureAdminView> {
  await dbConnect();
  const [sales, orch] = await Promise.all([
    SalesAgentConfig.findOne({ key: 'default' }).lean() as Promise<any>,
    OrchestrationConfig.findOne({ key: 'default' }).select('rolloutPercentage leadIdAllowlist').lean() as Promise<any>,
  ]);
  const base = defaultNurtureSchedule();
  const followUps = Array.isArray(sales?.followUps) && sales.followUps.length
    ? sales.followUps.map(stepFromStored)
    : base.followUps;
  return {
    enabled: sales ? sales.enabled === true : base.enabled,
    rolloutPercentage: typeof orch?.rolloutPercentage === 'number' ? orch.rolloutPercentage : 0,
    timezone: sales?.timezone || base.timezone,
    quietHours: {
      enabled: sales?.quietHours?.enabled === true,
      start: sales?.quietHours?.start || base.quietHours.start,
      end: sales?.quietHours?.end || base.quietHours.end,
    },
    minimumMessageGapMinutes: typeof sales?.minimumMessageGapMinutes === 'number'
      ? sales.minimumMessageGapMinutes
      : base.minimumMessageGapMinutes,
    maxNurtureMessages: typeof sales?.maxNurtureMessages === 'number'
      ? sales.maxNurtureMessages
      : base.maxNurtureMessages,
    firstMessage: {
      enabled: sales?.firstMessage?.enabled !== false,
      delayMinutes: typeof sales?.firstMessage?.delayMinutes === 'number'
        ? sales.firstMessage.delayMinutes
        : base.firstMessage.delayMinutes,
    },
    followUps,
    leadIdAllowlist: (orch?.leadIdAllowlist || []).map((id: any) => String(id)),
    version: typeof sales?.nurtureConfigVersion === 'number' ? sales.nurtureConfigVersion : 1,
    updatedAt: sales?.updatedAt ? new Date(sales.updatedAt).toISOString() : null,
    updatedBy: sales?.nurtureUpdatedBy || null,
  };
}

export async function currentTimingSnapshot(): Promise<NurtureTimingSnapshot> {
  const view = await readNurtureAdminView();
  return buildTimingSnapshot(view, view.version);
}

export async function saveNurtureAdminView(
  input: NurtureScheduleInput,
  actor: { userId: string; role: string | null }
): Promise<{ ok: true; version: number; changes: string[] } | { ok: false; error: string }> {
  if (!nurtureMutationAllowed(actor.role)) {
    return { ok: false, error: 'Forbidden' };
  }
  const invalid = validateNurtureSchedule(input);
  if (invalid) return { ok: false, error: invalid };
  for (const id of input.leadIdAllowlist) {
    if (!mongoose.Types.ObjectId.isValid(id)) return { ok: false, error: 'Allowlist contains an invalid lead id.' };
  }

  await dbConnect();
  const previous = await readNurtureAdminView();
  const version = previous.version + 1;
  const [sales, orchestration] = await Promise.all([
    SalesAgentConfig.findOne({ key: 'default' }),
    OrchestrationConfig.findOne({ key: 'default' }).select('_id'),
  ]);
  if (!sales) return { ok: false, error: 'Sales agent configuration is not stored yet.' };
  if (!orchestration) return { ok: false, error: 'Orchestration configuration is not stored yet.' };

  const existingFollowUps = Array.isArray(sales.followUps) ? sales.followUps : [];
  sales.firstMessage = sales.firstMessage || {};
  sales.firstMessage.delayMinutes = input.firstMessage.delayMinutes;
  sales.firstMessage.enabled = input.firstMessage.enabled;
  sales.enabled = input.enabled;
  sales.timezone = input.timezone;
  sales.quietHours = { ...input.quietHours };
  sales.minimumMessageGapMinutes = input.minimumMessageGapMinutes;
  sales.maxNurtureMessages = input.maxNurtureMessages;
  sales.nurtureConfigVersion = version;
  sales.nurtureUpdatedBy = actor.userId;
  sales.followUps = input.followUps.map((step) => {
    const prior = priorFollowUp(existingFollowUps, step.id);
    return {
      id: step.id,
      enabled: step.enabled,
      delayMinutes: step.delayMinutes,
      delayHours: step.delayMinutes / 60,
      onlyIfNoReply: step.onlyIfNoReply,
      description: step.description || '',
      mode: prior.mode || 'template',
      template: prior.template || '',
      aiSystemPrompt: prior.aiSystemPrompt || '',
    };
  });
  sales.markModified('firstMessage');
  sales.markModified('followUps');
  sales.markModified('quietHours');
  await sales.save();

  await OrchestrationConfig.updateOne(
    { key: 'default' },
    {
      $set: {
        rolloutPercentage: input.rolloutPercentage,
        leadIdAllowlist: input.leadIdAllowlist.map((id) => new mongoose.Types.ObjectId(id)),
      },
    },
    { upsert: false }
  );

  const changes = configChangeSummary(previous, { ...input, version });
  await NurtureConfigAudit.create({
    version,
    previousVersion: previous.version,
    actorUserId: actor.userId,
    changes,
  });
  return { ok: true, version, changes };
}

export async function previewNurtureDecision(leadId: string): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      leadId: string;
      name: string | null;
      leadScore: number;
      intent: string | null;
      nextBestAction: string | null;
      currentStage: string | null;
      currentAgent: string | null;
      nurtureEligible: boolean;
      reason: string;
      nextPossibleAction: string;
    }
> {
  if (!mongoose.Types.ObjectId.isValid(leadId)) return { ok: false, error: 'Invalid lead id.' };
  await dbConnect();
  const lead = await Lead.findOne({ _id: leadId, tenantId: 'gmbboost-internal' })
    .select('name leadScore intent nextBestAction currentStage currentAgent nurtureStatus humanHandoff')
    .lean() as any;
  if (!lead) return { ok: false, error: 'Platform lead not found.' };

  const safety = salesReplyBlockedReason(lead);
  const intelligence = genericFollowUpSkipReason({
    intent: lead.intent,
    nextBestAction: lead.nextBestAction,
    currentAgent: lead.currentAgent,
    currentStage: lead.currentStage,
    nurtureStatus: lead.nurtureStatus,
    humanHandoffActive: !!lead.humanHandoff?.active,
  });
  const reason = safety || intelligence;
  const nurtureEligible = !reason;
  return {
    ok: true,
    leadId: String(lead._id),
    name: lead.name || null,
    leadScore: typeof lead.leadScore === 'number' ? lead.leadScore : 0,
    intent: lead.intent || null,
    nextBestAction: lead.nextBestAction || null,
    currentStage: lead.currentStage || null,
    currentAgent: lead.currentAgent || null,
    nurtureEligible,
    reason: reason
      ? reason === 'demo-intent-owns-next-step'
        ? 'Lead has an active demo intent and the current next best action is to schedule a demo. Generic nurture must not send.'
        : reason === 'purchase-intent-owns-next-step'
          ? 'Purchase intent is active. Sales intelligence owns the next step, not a generic timer.'
          : `Blocked: ${reason}.`
      : 'No reply, ownership, opt-out, customer, or higher-priority next action is blocking a generic follow-up.',
    nextPossibleAction: reason === 'demo-intent-owns-next-step'
      ? 'Schedule demo / human action / no generic nurture'
      : nurtureEligible
        ? 'Generic follow-up may send after the snapshotted delay, if onlyIfNoReply still holds at send time.'
        : 'No generic nurture',
  };
}

export { proactiveCohortDecision };
