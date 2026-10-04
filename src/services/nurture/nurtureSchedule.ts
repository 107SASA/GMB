/**
 * Pure nurture-schedule rules. Timing is configuration. Whether a generic
 * follow-up may send is still decided by lead state (reply, ownership,
 * opt-out, customer, and the current next-best action).
 *
 * Existing production timing stays the default when the stored sales-agent
 * document has no newer fields: first message 2 minutes, follow-ups 24h then
 * 72h, onlyIfNoReply, quiet hours off, rollout untouched.
 */

export const NURTURE_TIMEZONE_DEFAULT = 'Asia/Kolkata';
export const MAX_FOLLOW_UP_STEPS = 10;
export const MAX_DELAY_MINUTES = 30 * 24 * 60;
export const MAX_FIRST_DELAY_MINUTES = 7 * 24 * 60;
export const MAX_NURTURE_MESSAGES = 20;
export const MAX_GAP_MINUTES = 7 * 24 * 60;

export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}

export interface NurtureFollowUpStep {
  id: string;
  enabled: boolean;
  delayMinutes: number;
  onlyIfNoReply: boolean;
  description?: string;
  /** Copied onto a sequence snapshot so a later reorder does not change an in-flight message. */
  mode?: string;
  template?: string;
  aiSystemPrompt?: string;
}

export interface NurtureTimingSnapshot {
  version: number;
  timezone: string;
  quietHours: QuietHours;
  minimumMessageGapMinutes: number;
  maxNurtureMessages: number;
  firstMessage: { enabled: boolean; delayMinutes: number };
  followUps: NurtureFollowUpStep[];
}

export interface NurtureScheduleInput {
  enabled: boolean;
  rolloutPercentage: number;
  timezone: string;
  quietHours: QuietHours;
  minimumMessageGapMinutes: number;
  maxNurtureMessages: number;
  firstMessage: { enabled: boolean; delayMinutes: number };
  followUps: NurtureFollowUpStep[];
  leadIdAllowlist: string[];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function delayToMinutes(value: number, unit: 'minutes' | 'hours' | 'days'): number {
  if (!Number.isFinite(value)) return NaN;
  if (unit === 'hours') return value * 60;
  if (unit === 'days') return value * 24 * 60;
  return value;
}

export function minutesToDisplay(minutes: number): { value: number; unit: 'minutes' | 'hours' | 'days' } {
  if (minutes > 0 && minutes % (24 * 60) === 0) return { value: minutes / (24 * 60), unit: 'days' };
  if (minutes > 0 && minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

/** Stored follow-ups historically use delayHours. Minute precision wins when present. */
export function followUpDelayMinutes(step: { delayMinutes?: number | null; delayHours?: number | null }): number {
  if (typeof step.delayMinutes === 'number' && Number.isFinite(step.delayMinutes) && step.delayMinutes > 0) {
    return step.delayMinutes;
  }
  const hours = typeof step.delayHours === 'number' ? step.delayHours : 0;
  return Math.round(hours * 60);
}

export function defaultNurtureSchedule(): NurtureScheduleInput {
  return {
    enabled: false,
    rolloutPercentage: 0,
    timezone: NURTURE_TIMEZONE_DEFAULT,
    quietHours: { enabled: false, start: '21:00', end: '09:00' },
    minimumMessageGapMinutes: 0,
    maxNurtureMessages: 5,
    firstMessage: { enabled: true, delayMinutes: 2 },
    followUps: [
      { id: 'follow-up-1', enabled: true, delayMinutes: 24 * 60, onlyIfNoReply: true, description: '' },
      { id: 'follow-up-2', enabled: true, delayMinutes: 72 * 60, onlyIfNoReply: true, description: '' },
    ],
    leadIdAllowlist: [],
  };
}

export function validateNurtureSchedule(input: NurtureScheduleInput): string | null {
  if (typeof input.enabled !== 'boolean') return 'Nurturing enabled must be true or false.';
  if (!Number.isInteger(input.rolloutPercentage) || input.rolloutPercentage < 0 || input.rolloutPercentage > 100) {
    return 'Rollout percentage must be a whole number from 0 to 100.';
  }
  if (!isValidTimeZone(input.timezone)) return 'Timezone is not a valid IANA timezone.';
  if (!input.quietHours || typeof input.quietHours.enabled !== 'boolean') return 'Quiet hours need an enabled flag.';
  if (!HHMM.test(input.quietHours.start) || !HHMM.test(input.quietHours.end)) {
    return 'Quiet hours must be HH:mm.';
  }
  if (!Number.isInteger(input.minimumMessageGapMinutes) || input.minimumMessageGapMinutes < 0 || input.minimumMessageGapMinutes > MAX_GAP_MINUTES) {
    return 'Minimum message gap must be between 0 and 7 days, in minutes.';
  }
  if (!Number.isInteger(input.maxNurtureMessages) || input.maxNurtureMessages < 0 || input.maxNurtureMessages > MAX_NURTURE_MESSAGES) {
    return `Maximum nurture messages must be between 0 and ${MAX_NURTURE_MESSAGES}.`;
  }
  if (!Number.isInteger(input.firstMessage.delayMinutes) || input.firstMessage.delayMinutes < 1 || input.firstMessage.delayMinutes > MAX_FIRST_DELAY_MINUTES) {
    return 'First-message delay must be at least 1 minute and at most 7 days.';
  }
  if (!Array.isArray(input.followUps) || input.followUps.length > MAX_FOLLOW_UP_STEPS) {
    return `At most ${MAX_FOLLOW_UP_STEPS} follow-up steps are allowed.`;
  }
  const ids = new Set<string>();
  for (const step of input.followUps) {
    if (!step.id || typeof step.id !== 'string' || step.id.length > 80) return 'Each follow-up needs a step id.';
    if (ids.has(step.id)) return 'Follow-up step ids must be unique.';
    ids.add(step.id);
    if (typeof step.enabled !== 'boolean') return 'Each follow-up needs an enabled flag.';
    if (typeof step.onlyIfNoReply !== 'boolean') return 'Each follow-up needs onlyIfNoReply.';
    if (!Number.isInteger(step.delayMinutes) || step.delayMinutes < 1 || step.delayMinutes > MAX_DELAY_MINUTES) {
      return 'Each follow-up delay must be at least 1 minute and at most 30 days.';
    }
  }
  if (!Array.isArray(input.leadIdAllowlist)) return 'Allowlist must be a list of lead ids.';
  if (input.leadIdAllowlist.length > 200) return 'Allowlist cannot exceed 200 leads.';
  return null;
}

export function snapshotFromStoredAgent(config: {
  nurtureConfigVersion?: number;
  timezone?: string;
  quietHours?: Partial<QuietHours> | null;
  minimumMessageGapMinutes?: number;
  maxNurtureMessages?: number;
  firstMessage?: { enabled?: boolean; delayMinutes?: number } | null;
  followUps?: Array<{
    id?: string;
    enabled?: boolean;
    delayMinutes?: number;
    delayHours?: number;
    onlyIfNoReply?: boolean;
    description?: string;
    mode?: string;
    template?: string;
    aiSystemPrompt?: string;
  }> | null;
}): NurtureTimingSnapshot {
  const base = defaultNurtureSchedule();
  const followUps = config.followUps?.length
    ? config.followUps.map((step, index) => ({
        id: step.id || `follow-up-${index + 1}`,
        enabled: step.enabled !== false,
        delayMinutes: followUpDelayMinutes(step),
        onlyIfNoReply: step.onlyIfNoReply !== false,
        description: step.description || '',
        mode: step.mode,
        template: step.template,
        aiSystemPrompt: step.aiSystemPrompt,
      }))
    : base.followUps;
  return buildTimingSnapshot(
    {
      ...base,
      timezone: config.timezone || base.timezone,
      quietHours: {
        enabled: config.quietHours?.enabled === true,
        start: config.quietHours?.start || base.quietHours.start,
        end: config.quietHours?.end || base.quietHours.end,
      },
      minimumMessageGapMinutes: typeof config.minimumMessageGapMinutes === 'number'
        ? config.minimumMessageGapMinutes
        : base.minimumMessageGapMinutes,
      maxNurtureMessages: typeof config.maxNurtureMessages === 'number'
        ? config.maxNurtureMessages
        : base.maxNurtureMessages,
      firstMessage: {
        enabled: config.firstMessage?.enabled !== false,
        delayMinutes: typeof config.firstMessage?.delayMinutes === 'number'
          ? config.firstMessage.delayMinutes
          : base.firstMessage.delayMinutes,
      },
      followUps,
    },
    typeof config.nurtureConfigVersion === 'number' ? config.nurtureConfigVersion : 1
  );
}

export function buildTimingSnapshot(
  schedule: NurtureScheduleInput,
  version: number
): NurtureTimingSnapshot {
  return {
    version,
    timezone: schedule.timezone,
    quietHours: { ...schedule.quietHours },
    minimumMessageGapMinutes: schedule.minimumMessageGapMinutes,
    maxNurtureMessages: schedule.maxNurtureMessages,
    firstMessage: { ...schedule.firstMessage },
    followUps: schedule.followUps.map((step) => ({ ...step })),
  };
}

/** A running sequence keeps the snapshot it started with. */
export function timingForSequence(
  snapshot: NurtureTimingSnapshot | null | undefined,
  latest: NurtureTimingSnapshot
): NurtureTimingSnapshot {
  return snapshot ?? latest;
}

export function nurtureMutationAllowed(role: string | null | undefined): boolean {
  return role === 'SUPER_ADMIN';
}

/**
 * Proactive cohort. Safety failures are never overridden by the allowlist
 * or by a 100% rollout. 0% selects nobody who is not allowlisted, and an
 * allowlisted lead still fails closed when safetyBlocked is true.
 */
export function proactiveCohortDecision(input: {
  safetyBlocked: boolean;
  leadId: string;
  allowlist: string[];
  rolloutPercentage: number;
  bucket: number;
}): { allowed: boolean; reason: string } {
  if (input.safetyBlocked) {
    return { allowed: false, reason: 'Blocked by an existing safety rule. Rollout and the allowlist do not override that.' };
  }
  if (input.allowlist.map(String).includes(String(input.leadId))) {
    return { allowed: true, reason: 'Lead is on the allowlist and passed safety checks.' };
  }
  if (input.rolloutPercentage <= 0) {
    return { allowed: false, reason: 'Rollout is 0% and the lead is not allowlisted.' };
  }
  if (input.rolloutPercentage >= 100 || input.bucket < input.rolloutPercentage) {
    return { allowed: true, reason: 'Lead is inside the rollout percentage and passed safety checks.' };
  }
  return { allowed: false, reason: 'Lead is outside the rollout percentage.' };
}

export function genericFollowUpSkipReason(lead: {
  intent?: string | null;
  nextBestAction?: string | null;
  currentAgent?: string | null;
  currentStage?: string | null;
  nurtureStatus?: string | null;
  humanHandoffActive?: boolean;
} | null | undefined): string | null {
  if (!lead) return null;
  if (lead.humanHandoffActive || lead.currentAgent === 'HUMAN' || lead.currentStage === 'HUMAN_HANDOFF') {
    return 'human-owned';
  }
  if (lead.currentAgent === 'IN_HOUSE' || lead.currentStage === 'CUSTOMER') return 'already-customer';
  if (
    lead.nurtureStatus === 'OPTED_OUT' ||
    lead.nurtureStatus === 'STOPPED' ||
    lead.currentStage === 'DO_NOT_CONTACT' ||
    lead.currentStage === 'LOST'
  ) {
    return 'opted-out-or-do-not-contact';
  }
  if (lead.intent === 'DEMO_INTEREST' || lead.nextBestAction === 'SCHEDULE_DEMO') {
    return 'demo-intent-owns-next-step';
  }
  if (lead.intent === 'PURCHASE_INTEREST' || lead.intent === 'READY_TO_BUY') {
    return 'purchase-intent-owns-next-step';
  }
  if (lead.nextBestAction === 'HUMAN_HANDOFF' || lead.nextBestAction === 'STOP') {
    return 'nba-stops-generic-nurture';
  }
  return null;
}

function parseHHMM(value: string): number {
  const [h, m] = value.split(':').map((part) => Number(part));
  return h * 60 + m;
}

export function zonedMinutes(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return (hour % 24) * 60 + minute;
}

export function isWithinQuietHours(date: Date, quiet: QuietHours, timeZone: string): boolean {
  if (!quiet.enabled) return false;
  const start = parseHHMM(quiet.start);
  const end = parseHHMM(quiet.end);
  if (start === end) return false;
  const now = zonedMinutes(date, timeZone);
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

/** Minutes to wait so a send lands outside quiet hours and after the minimum gap. */
export function minutesUntilSendable(input: {
  now: Date;
  quietHours: QuietHours;
  timezone: string;
  minimumMessageGapMinutes: number;
  lastAgentAt?: Date | null;
}): number {
  let wait = 0;
  if (input.lastAgentAt && input.minimumMessageGapMinutes > 0) {
    const elapsed = Math.floor((input.now.getTime() - input.lastAgentAt.getTime()) / 60000);
    if (elapsed < input.minimumMessageGapMinutes) wait = input.minimumMessageGapMinutes - elapsed;
  }
  const at = new Date(input.now.getTime() + wait * 60000);
  if (!isWithinQuietHours(at, input.quietHours, input.timezone)) return wait;
  const start = parseHHMM(input.quietHours.start);
  const end = parseHHMM(input.quietHours.end);
  const nowMin = zonedMinutes(at, input.timezone);
  let quietLeft = 0;
  if (start < end) quietLeft = end - nowMin;
  else if (nowMin >= start) quietLeft = 24 * 60 - nowMin + end;
  else quietLeft = end - nowMin;
  return wait + Math.max(quietLeft, 0);
}

export function onlyIfNoReplyBlocks(input: {
  onlyIfNoReply: boolean;
  lastLeadReplyAt?: Date | null;
  firstSentAt?: Date | null;
}): boolean {
  if (!input.onlyIfNoReply) return false;
  if (!input.lastLeadReplyAt || !input.firstSentAt) return false;
  return input.lastLeadReplyAt.getTime() > input.firstSentAt.getTime();
}

export function configChangeSummary(
  previous: NurtureScheduleInput & { version: number },
  next: NurtureScheduleInput & { version: number }
): string[] {
  const lines: string[] = [];
  if (previous.enabled !== next.enabled) lines.push(`Nurturing enabled: ${previous.enabled} → ${next.enabled}`);
  if (previous.rolloutPercentage !== next.rolloutPercentage) {
    lines.push(`Rollout: ${previous.rolloutPercentage}% → ${next.rolloutPercentage}%`);
  }
  if (previous.firstMessage.delayMinutes !== next.firstMessage.delayMinutes) {
    lines.push(`First message: ${previous.firstMessage.delayMinutes}m → ${next.firstMessage.delayMinutes}m`);
  }
  if (previous.followUps.length !== next.followUps.length) {
    lines.push(`Follow-up steps: ${previous.followUps.length} → ${next.followUps.length}`);
  } else {
    next.followUps.forEach((step, i) => {
      const before = previous.followUps[i];
      if (!before || before.delayMinutes !== step.delayMinutes) {
        lines.push(`Follow-up ${i + 1}: ${before?.delayMinutes ?? 'none'}m → ${step.delayMinutes}m`);
      }
    });
  }
  if (previous.version !== next.version) lines.push(`Config version: ${previous.version} → ${next.version}`);
  return lines;
}
