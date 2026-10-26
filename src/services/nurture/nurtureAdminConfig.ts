import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import SalesAgentConfig from '@/models/SalesAgentConfig';
import SalesConversation from '@/models/SalesConversation';
import NurtureConfigAudit from '@/models/NurtureConfigAudit';
import Lead from '@/models/Lead';
import LeadEvent from '@/models/LeadEvent';
import { DEFAULT_FOLLOWUPS } from '@/lib/salesAgentDefaults';
import {
  SALES_FOLLOW_UP_DELAY_MINUTES,
  SALES_INVITE_MIN_DELAY_MINUTES,
  minutesUntilSalesSendable,
} from '@/lib/preSalesRules';
import { isValidTimeZone, nurtureMutationAllowed, MAX_FIRST_DELAY_MINUTES, NURTURE_TIMEZONE_DEFAULT } from '@/services/nurture/nurtureSchedule';
import { followUpBlockedReason, preSalesSendBlockedReason } from '@/services/sales/preSalesPolicy';

/**
 * Nurturing Configuration — only the settings the sender actually reads.
 *
 * The automated sequence is fixed by lib/preSalesRules.ts: ONE invitation (at
 * least SALES_INVITE_MIN_DELAY_MINUTES after the free report) and ONE
 * follow-up SALES_FOLLOW_UP_DELAY_MINUTES later, only if the lead has not
 * replied. What an admin controls here:
 *   - nurturing on/off (separate from the Sales agent's live replies)
 *   - quiet hours on/off, their window and timezone (off = no restriction)
 *   - the invitation on/off and its delay (minimum 2 hours)
 *   - the follow-up on/off
 * Message copy is edited on the Sales Agent page; saving here never touches it.
 */

export interface NurtureAdminView {
  /** Automated invitation + follow-up. */
  enabled: boolean;
  /** The Sales agent's own switch (live replies). Nurturing also needs it on. Read-only here. */
  salesAgentEnabled: boolean;
  timezone: string;
  quietHours: { enabled: boolean; start: string; end: string };
  firstMessage: { enabled: boolean; delayMinutes: number };
  /**
   * enabled: whether the follow-up will be sent. configured: whether a
   * follow-up message exists at all — false when it was deleted on the Sales
   * Agent page, in which case nothing is sent and it can't be switched on here.
   */
  followUp: { enabled: boolean; configured?: boolean };
  /** The fixed parts of the sequence, for display. */
  rules: { minFirstDelayMinutes: number; followUpDelayMinutes: number; followUps: 1 };
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type NurtureAdminInput = Pick<NurtureAdminView, 'enabled' | 'timezone' | 'quietHours' | 'firstMessage' | 'followUp'>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateNurtureAdminInput(input: any): string | null {
  if (!input || typeof input !== 'object') return 'Invalid config.';
  if (typeof input.enabled !== 'boolean') return 'Nurturing enabled must be true or false.';
  if (typeof input.timezone !== 'string' || !isValidTimeZone(input.timezone)) return 'Timezone is not a valid IANA timezone.';
  const q = input.quietHours;
  if (!q || typeof q.enabled !== 'boolean') return 'Quiet hours need an enabled flag.';
  if (!HHMM.test(q.start) || !HHMM.test(q.end)) return 'Quiet hours must be HH:mm.';
  if (q.enabled && q.start === q.end) return 'Quiet hours start and end must differ.';
  const f = input.firstMessage;
  if (!f || typeof f.enabled !== 'boolean') return 'The invitation needs an enabled flag.';
  if (!Number.isInteger(f.delayMinutes) || f.delayMinutes < SALES_INVITE_MIN_DELAY_MINUTES || f.delayMinutes > MAX_FIRST_DELAY_MINUTES) {
    return `Invitation delay must be between ${SALES_INVITE_MIN_DELAY_MINUTES / 60} hours and 7 days.`;
  }
  if (!input.followUp || typeof input.followUp.enabled !== 'boolean') return 'The follow-up needs an enabled flag.';
  return null;
}

/** Read the live settings without inserting a missing sales-agent document. */
export async function readNurtureAdminView(): Promise<NurtureAdminView> {
  await dbConnect();
  const sales: any = await SalesAgentConfig.findOne({ key: 'default' }).lean();
  const storedDelay = typeof sales?.firstMessage?.delayMinutes === 'number' ? sales.firstMessage.delayMinutes : 0;
  return {
    // Not saved here yet → it has been following the agent switch.
    enabled: (sales?.nurtureEnabled ?? sales?.enabled) === true,
    salesAgentEnabled: sales?.enabled === true,
    timezone: sales?.timezone || NURTURE_TIMEZONE_DEFAULT,
    quietHours: {
      enabled: sales?.quietHours?.enabled === true,
      start: sales?.quietHours?.start || '21:00',
      end: sales?.quietHours?.end || '09:00',
    },
    firstMessage: {
      enabled: sales?.firstMessage?.enabled !== false,
      // What the sender actually waits (an older, shorter stored value is raised to the minimum).
      delayMinutes: Math.max(SALES_INVITE_MIN_DELAY_MINUTES, storedDelay),
    },
    followUp: followUpState(sales),
    rules: { minFirstDelayMinutes: SALES_INVITE_MIN_DELAY_MINUTES, followUpDelayMinutes: SALES_FOLLOW_UP_DELAY_MINUTES, followUps: 1 },
    version: typeof sales?.nurtureConfigVersion === 'number' ? sales.nurtureConfigVersion : 1,
    updatedAt: sales?.updatedAt ? new Date(sales.updatedAt).toISOString() : null,
    updatedBy: sales?.nurtureUpdatedBy || null,
  };
}

/**
 * Mirrors what the sender does (services/sales/salesAgent.ts
 * getSalesAgentConfig): no stored list → the default follow-up is used; an
 * EMPTY list → there is no follow-up.
 */
function followUpState(sales: any): { enabled: boolean; configured: boolean } {
  const list = Array.isArray(sales?.followUps) ? sales.followUps : null;
  if (list === null) return { enabled: true, configured: true };
  if (!list.length) return { enabled: false, configured: false };
  return { enabled: list[0]?.enabled !== false, configured: true };
}

function changeSummary(prev: NurtureAdminView, next: NurtureAdminInput): string[] {
  const lines: string[] = [];
  if (prev.enabled !== next.enabled) lines.push(`Nurturing: ${prev.enabled ? 'on' : 'off'} → ${next.enabled ? 'on' : 'off'}`);
  if (prev.timezone !== next.timezone) lines.push(`Timezone: ${prev.timezone} → ${next.timezone}`);
  const qh = (q: NurtureAdminView['quietHours']) => (q.enabled ? `${q.start}–${q.end}` : 'off');
  if (qh(prev.quietHours) !== qh(next.quietHours)) lines.push(`Quiet hours: ${qh(prev.quietHours)} → ${qh(next.quietHours)}`);
  if (prev.firstMessage.enabled !== next.firstMessage.enabled) lines.push(`Invitation: ${prev.firstMessage.enabled ? 'on' : 'off'} → ${next.firstMessage.enabled ? 'on' : 'off'}`);
  if (prev.firstMessage.delayMinutes !== next.firstMessage.delayMinutes) lines.push(`Invitation delay: ${prev.firstMessage.delayMinutes}m → ${next.firstMessage.delayMinutes}m`);
  if (prev.followUp.enabled !== next.followUp.enabled) lines.push(`Follow-up: ${prev.followUp.enabled ? 'on' : 'off'} → ${next.followUp.enabled ? 'on' : 'off'}`);
  return lines;
}

export async function saveNurtureAdminView(
  input: NurtureAdminInput,
  actor: { userId: string; role: string | null }
): Promise<{ ok: true; version: number; changes: string[] } | { ok: false; error: string }> {
  if (!nurtureMutationAllowed(actor.role)) return { ok: false, error: 'Forbidden' };
  const invalid = validateNurtureAdminInput(input);
  if (invalid) return { ok: false, error: invalid };

  await dbConnect();
  const sales = await SalesAgentConfig.findOne({ key: 'default' });
  if (!sales) return { ok: false, error: 'Sales agent configuration is not stored yet — save the Sales Agent page once first.' };
  const previous = await readNurtureAdminView();
  if (input.followUp.enabled && previous.followUp.configured === false) {
    return { ok: false, error: 'There is no follow-up message to send — add one on the Sales Agent page first.' };
  }
  const changes = changeSummary(previous, input);
  if (!changes.length) return { ok: true, version: previous.version, changes };
  const version = previous.version + 1;

  // Never touches the Sales agent's own `enabled` (live replies).
  sales.set('nurtureEnabled', input.enabled);
  sales.set('timezone', input.timezone);
  sales.set('quietHours', { ...input.quietHours });
  sales.set('firstMessage.enabled', input.firstMessage.enabled);
  sales.set('firstMessage.delayMinutes', input.firstMessage.delayMinutes);
  const stored = sales.get('followUps');
  if (Array.isArray(stored) && stored.length) {
    // Only step 1's switch — copy and any extra (unsent) steps are left as they are.
    const followUps = stored.map((f: any) => (typeof f?.toObject === 'function' ? f.toObject() : f));
    followUps[0] = { ...followUps[0], enabled: input.followUp.enabled };
    sales.set('followUps', followUps);
  } else if (previous.followUp.configured) {
    // Nothing usable stored but the read view says configured → the field was
    // never stored (mongoose shows it as [] once loaded) and the sender uses
    // the default follow-up; record that one with the chosen switch.
    sales.set('followUps', [{ ...DEFAULT_FOLLOWUPS[0], id: 'follow-up-1', enabled: input.followUp.enabled }]);
  }
  // An empty list (deleted on the Sales Agent page) stays empty — never recreated here.
  sales.set('nurtureConfigVersion', version);
  sales.set('nurtureUpdatedBy', actor.userId);
  await sales.save();

  await NurtureConfigAudit.create({ version, previousVersion: previous.version, actorUserId: actor.userId, changes: [...changes, `Config version: ${previous.version} → ${version}`] });
  return { ok: true, version, changes };
}

const REASON_TEXT: Record<string, string> = {
  'agent-disabled': 'The Sales agent is switched off.',
  'nurture-disabled': 'Nurturing is switched off.',
  'lead-replied': 'The lead replied after the invitation — the automated sequence has ended (live replies continue).',
  'no-first-message': 'No invitation has been sent yet.',
  'human-owned': 'A human owns this lead.',
  'already-customer': 'Already a customer.',
  'opted-out': 'The lead opted out.',
  'opted-out-or-do-not-contact': 'Opted out, stopped, lost or do-not-contact.',
  stopped: 'Nurture was stopped for this lead.',
  'not-interested': 'The lead said they are not interested.',
  'demo-in-progress': 'A demo booking conversation is in progress.',
  'demo-booked': 'A demo is booked.',
  'demo-intent-owns-next-step': 'Demo intent — the booking flow owns the next step.',
  'purchase-intent-owns-next-step': 'Purchase intent — sales intelligence owns the next step.',
  'nba-stops-generic-nurture': 'The next best action is a handoff or stop.',
  'trial-or-paid': 'Their workspace has started a trial or paid.',
  'support-conversation-active': 'A support conversation is open.',
  'follow-up-step-disabled': 'The follow-up is switched off for this conversation.',
  'eligibility-check-failed': 'An eligibility check failed — the send is skipped (fails closed).',
  'ownership-mismatch': 'Another agent owns the lead now.',
  'nurture-stopped': 'Nurture was stopped or the lead opted out.',
  'do-not-contact': 'Marked do-not-contact.',
  'cooldown-active': 'Too soon after the last automated message (cooldown).',
  'follow-up-limit': 'The one follow-up was already used.',
  'no-conversation-to-check': 'No sales conversation to check against.',
  'flag-or-cohort-no-longer-applies': 'The scheduled-sending setting no longer applies to this lead.',
  'already-sent': 'Already sent.',
};

export type SkipCategory = 'preparation' | 'consent' | 'invitation' | 'follow-up' | 'live-reply' | 'demo-reminder' | 'other';
export const NURTURE_SKIP_CATEGORIES: SkipCategory[] = ['preparation', 'consent', 'invitation', 'follow-up'];

/** The category of a skipped event — explicit when recorded, else inferred for older events. */
export function skipCategoryOf(payload: any): SkipCategory {
  const explicit = payload?.category;
  if (typeof explicit === 'string' && ['preparation', 'consent', 'invitation', 'follow-up', 'live-reply', 'demo-reminder'].includes(explicit)) return explicit as SkipCategory;
  const agent = String(payload?.agent ?? '');
  if (agent === 'sales-agent-drip') return 'follow-up';
  if (agent === 'sales-agent-invite') return 'invitation';
  if (agent === 'sales-agent') return 'live-reply';
  if (payload?.actionType === 'DEMO_REMINDER') return 'demo-reminder';
  // The scheduled follow-up path's orchestrator records { agent: 'SALES', isReply: false }.
  if (agent === 'SALES' && payload?.isReply === false) return 'follow-up';
  return 'other';
}

export const SKIP_CATEGORY_LABEL: Record<SkipCategory, string> = {
  preparation: 'not started',
  consent: 'consent request',
  invitation: 'invitation',
  'follow-up': 'follow-up',
  'live-reply': 'live reply',
  'demo-reminder': 'demo reminder',
  other: 'other',
};
export const nurtureReasonText = (code: string) => REASON_TEXT[code] || code.replace(/^conversation-/, 'Conversation is ').replace(/-/g, ' ');

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
      step: 'invitation' | 'follow-up' | 'done';
      nurtureEligible: boolean;
      reasonCode: string | null;
      reason: string;
      nextPossibleAction: string;
      dueAt: string | null;
    }
> {
  if (!mongoose.Types.ObjectId.isValid(leadId)) return { ok: false, error: 'Invalid lead id.' };
  await dbConnect();
  const lead = await Lead.findOne({ _id: leadId, tenantId: 'gmbboost-internal' })
    .select('name phone leadScore intent nextBestAction currentStage currentAgent nurtureStatus humanHandoff')
    .lean() as any;
  if (!lead) return { ok: false, error: 'Platform lead not found.' };

  const base = {
    ok: true as const,
    leadId: String(lead._id),
    name: lead.name || null,
    leadScore: typeof lead.leadScore === 'number' ? lead.leadScore : 0,
    intent: lead.intent || null,
    nextBestAction: lead.nextBestAction || null,
    currentStage: lead.currentStage || null,
    currentAgent: lead.currentAgent || null,
  };

  const convo: any = lead.phone
    ? await SalesConversation.findOne({ leadPhone: lead.phone }).sort({ createdAt: -1 }).select('_id consentStatus firstSentAt nurtureSentKeys nurtureTiming status').lean()
    : null;

  // Same checks the sender runs, in the same functions.
  if (!convo || !convo.firstSentAt) {
    const reasonCode = await preSalesSendBlockedReason(
      convo
        ? { kind: 'invite', step: convo.consentStatus === 'pending' ? 'consent' : 'first', conversationId: String(convo._id) }
        : { kind: 'invite', phone: lead.phone, leadId: lead._id }
    );
    return {
      ...base,
      step: 'invitation',
      nurtureEligible: !reasonCode,
      reasonCode,
      reason: reasonCode ? nurtureReasonText(reasonCode) : 'Nothing blocks the invitation.',
      nextPossibleAction: reasonCode
        ? 'No automated invitation.'
        : convo
          ? 'The invitation goes out when its scheduled time comes (after quiet hours, if they are on).'
          : `An invitation is sent at least ${SALES_INVITE_MIN_DELAY_MINUTES / 60} hours after their next completed free report.`,
      dueAt: null,
    };
  }

  if ((convo.nurtureSentKeys || []).includes('followup-0')) {
    return { ...base, step: 'done', nurtureEligible: false, reasonCode: null, reason: 'The invitation and the follow-up have both been sent.', nextPossibleAction: 'No more automated messages. Live replies continue.', dueAt: null };
  }

  const { reason: reasonCode } = await followUpBlockedReason(String(convo._id), 0);
  let dueAt: Date | null = null;
  if (!reasonCode) {
    const at = new Date(new Date(convo.firstSentAt).getTime() + SALES_FOLLOW_UP_DELAY_MINUTES * 60_000);
    dueAt = new Date(at.getTime() + minutesUntilSalesSendable(at, convo.nurtureTiming?.quietHours, convo.nurtureTiming?.timezone) * 60_000);
  }
  return {
    ...base,
    step: 'follow-up',
    nurtureEligible: !reasonCode,
    reasonCode,
    reason: reasonCode ? nurtureReasonText(reasonCode) : 'Nothing blocks the follow-up right now.',
    nextPossibleAction: reasonCode
      ? 'No automated follow-up.'
      : `The follow-up is due ${dueAt!.toISOString()} — checked again right before it sends.`,
    dueAt: dueAt ? dueAt.toISOString() : null,
  };
}

/**
 * Recent nurturing messages that did not go out, and why: sequences not
 * started when the report completed, and consent requests / invitations /
 * follow-ups refused at send time (both follow-up paths). Live replies and
 * demo reminders are other agents' business and are not listed.
 */
export async function recentSkippedNurture(limit = 50) {
  await dbConnect();
  const want = Math.min(Math.max(limit, 1), 200);
  const raw: any[] = await LeadEvent.find({ type: 'NURTURE_ACTION_SKIPPED', conversationType: { $ne: 'tenant' } })
    .sort({ createdAt: -1 })
    .limit(want * 4)
    .select('leadId phone payload actor createdAt')
    .lean();
  const events = raw.filter((e) => NURTURE_SKIP_CATEGORIES.includes(skipCategoryOf(e.payload))).slice(0, want);
  const phones = events.filter((e) => !e.leadId && e.phone).map((e) => e.phone);
  const byPhone = new Map<string, any>();
  if (phones.length) {
    const leads: any[] = await Lead.find({ tenantId: 'gmbboost-internal', phone: { $in: phones } }).select('_id name phone').lean();
    for (const l of leads) byPhone.set(l.phone, l);
  }
  const ids = events.filter((e) => e.leadId).map((e) => e.leadId);
  const byId = new Map<string, any>();
  if (ids.length) {
    const leads: any[] = await Lead.find({ _id: { $in: ids }, tenantId: 'gmbboost-internal' }).select('_id name phone').lean();
    for (const l of leads) byId.set(String(l._id), l);
  }
  return events.map((e) => {
    const l = e.leadId ? byId.get(String(e.leadId)) : byPhone.get(e.phone);
    const code = String(e.payload?.reason ?? 'unknown');
    const category = skipCategoryOf(e.payload);
    return {
      at: e.createdAt,
      leadId: l ? String(l._id) : null,
      name: l?.name ?? null,
      phone: e.phone ?? l?.phone ?? null,
      reasonCode: code,
      reason: nurtureReasonText(code),
      category,
      categoryLabel: SKIP_CATEGORY_LABEL[category],
      path: e.payload?.path === 'scheduled' || (e.payload?.agent === 'SALES') ? 'scheduled' : 'inline',
    };
  });
}
