/**
 * Free-trial offer rules — pure (no imports), so tests load it directly.
 *
 * The browser never takes part in the decision: checkout passes only the
 * billing cycle it validated, the stored policy and the server-side
 * eligibility verdict. Anything else the client sent (a "trial" flag, dates)
 * is never read.
 */

export const DEFAULT_TRIAL_MONTHS = 3;
export const MAX_TRIAL_MONTHS = 12;

/**
 * After the trial ends, Razorpay charges at start_at; the charged / pending
 * webhook normally lands within minutes. Access continues for this long while
 * the charge is processing, so a slow webhook doesn't lock a customer who is
 * about to be charged. A confirmed failure (subscription.pending) locks
 * immediately; a trial cancelled by the customer ends exactly at trialEndsAt.
 */
export const TRIAL_CHARGE_PROCESSING_MS = 48 * 60 * 60 * 1000;

export interface TrialPolicy {
  offerEnabled: boolean;
  trialMonths: number;
  eligibleCycle: 'yearly';
  version: number;
}

const OFF: TrialPolicy = { offerEnabled: false, trialMonths: DEFAULT_TRIAL_MONTHS, eligibleCycle: 'yearly', version: 0 };

/** Stored BillingPolicy doc → policy. Missing, partial or malformed → offer OFF. */
export function parseTrialPolicy(doc: unknown): TrialPolicy {
  if (!doc || typeof doc !== 'object') return OFF;
  const trial = (doc as any).trial;
  const version = Number.isInteger((doc as any).version) ? (doc as any).version : 0;
  if (!trial || typeof trial !== 'object') return { ...OFF, version };
  const months = trial.trialMonths;
  const valid =
    trial.offerEnabled === true &&
    Number.isInteger(months) &&
    months >= 1 &&
    months <= MAX_TRIAL_MONTHS &&
    (trial.eligibleCycle === undefined || trial.eligibleCycle === 'yearly');
  if (!valid) return { ...OFF, version, trialMonths: Number.isInteger(months) && months >= 1 && months <= MAX_TRIAL_MONTHS ? months : DEFAULT_TRIAL_MONTHS };
  return { offerEnabled: true, trialMonths: months, eligibleCycle: 'yearly', version };
}

/** Validates an admin's requested change. Returns the cleaned values or an error. */
export function validateTrialPolicyUpdate(
  input: unknown
): { ok: true; value: { offerEnabled: boolean; trialMonths: number } } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Expected { offerEnabled, trialMonths }.' };
  const { offerEnabled, trialMonths } = input as any;
  if (typeof offerEnabled !== 'boolean') return { ok: false, error: 'offerEnabled must be true or false.' };
  if (!Number.isInteger(trialMonths) || trialMonths < 1 || trialMonths > MAX_TRIAL_MONTHS) {
    return { ok: false, error: `trialMonths must be a whole number from 1 to ${MAX_TRIAL_MONTHS}.` };
  }
  return { ok: true, value: { offerEnabled, trialMonths } };
}

/** Calendar months in UTC, clamped to the last day of the target month (31 Oct + 3 → 31 Jan; 30 Nov + 3 → 28/29 Feb). */
export function addMonthsUtc(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export type CheckoutTrialDecision =
  | { trial: true; trialMonths: number; trialEndsAt: Date }
  | { trial: false; reason: 'offer_off' | 'cycle_not_eligible' | 'not_eligible' };

/**
 * The trial decision for one checkout, made once at creation. `eligible` is
 * the server-side verdict (verified phone, no history, claim reserved).
 */
export function decideCheckoutTrial(input: {
  policy: TrialPolicy;
  cycle: string;
  eligible: boolean;
  now: Date;
}): CheckoutTrialDecision {
  if (!input.policy.offerEnabled) return { trial: false, reason: 'offer_off' };
  if (input.cycle !== input.policy.eligibleCycle) return { trial: false, reason: 'cycle_not_eligible' };
  if (!input.eligible) return { trial: false, reason: 'not_eligible' };
  return {
    trial: true,
    trialMonths: input.policy.trialMonths,
    trialEndsAt: addMonthsUtc(input.now, input.policy.trialMonths),
  };
}

/** Whether a checkout for this cycle should even attempt a trial (before eligibility / reservation). */
export function offerAppliesToCycle(policy: TrialPolicy, cycle: string): boolean {
  return policy.offerEnabled && cycle === policy.eligibleCycle;
}

// ── Failed-payment policy ───────────────────────────────────────────────────

/** Paid modules an admin may restrict during a payment failure. */
export const PAID_MODULE_KEYS = ['reputation_agent', 'sales_agent', 'content_studio', 'marketing_automation'] as const;
export type PaidModuleKey = (typeof PAID_MODULE_KEYS)[number];
/** Always available, never restrictable (the free audit / Google ranking module). */
export const ALWAYS_FREE_MODULE = 'google_ranking_agent';
/**
 * Always reachable during a payment failure, whatever the policy says — the
 * customer must be able to sign in, pay and get help. Not configurable: an
 * update that tries to turn any of these off is rejected.
 */
export const ALWAYS_ACCESSIBLE = ['login', 'free_report', 'billing', 'payment_recovery', 'support'] as const;
export const MAX_GRACE_DAYS = 30;

export type FailureKind = 'first_charge' | 'renewal';

export interface FailureRule {
  /** 'immediate' = restrict as soon as the failure is confirmed; 'grace' = keep paid access for graceDays first. */
  mode: 'immediate' | 'grace';
  graceDays: number;
}

export interface FailurePolicy {
  /** The first charge when a free trial ends. */
  firstCharge: FailureRule;
  /** A renewal for an established paying customer. */
  renewal: FailureRule;
  /** Paid modules locked once restriction applies. */
  restrictedModules: PaidModuleKey[];
  /** After a verified recovery payment, unlock automatically (true) or hold until a super admin releases it. */
  restoreAccessOnRecovery: boolean;
}

/** The agreed defaults: trial-end failure locks at once; a paying customer gets 3 days. */
export const DEFAULT_FAILURE_POLICY: FailurePolicy = {
  firstCharge: { mode: 'immediate', graceDays: 0 },
  renewal: { mode: 'grace', graceDays: 3 },
  restrictedModules: [...PAID_MODULE_KEYS],
  restoreAccessOnRecovery: true,
};

function parseRule(raw: any, fallback: FailureRule): FailureRule {
  if (!raw || typeof raw !== 'object') return fallback;
  if (raw.mode === 'immediate') return { mode: 'immediate', graceDays: 0 };
  if (raw.mode === 'grace' && Number.isInteger(raw.graceDays) && raw.graceDays >= 1 && raw.graceDays <= MAX_GRACE_DAYS) {
    return { mode: 'grace', graceDays: raw.graceDays };
  }
  return fallback;
}

/**
 * Stored policy → failure policy. Each part that is missing or malformed falls
 * back to its default independently. A malformed restricted-module list falls
 * back to restricting EVERY paid module — bad config can only lock more, never
 * open paid features to a customer whose payment failed.
 */
export function parseFailurePolicy(doc: unknown): FailurePolicy {
  const raw = doc && typeof doc === 'object' ? (doc as any).failure : null;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FAILURE_POLICY, restrictedModules: [...DEFAULT_FAILURE_POLICY.restrictedModules] };
  const list = raw.restrictedModules;
  const validList =
    Array.isArray(list) && list.every((m: unknown) => (PAID_MODULE_KEYS as readonly string[]).includes(m as string));
  return {
    firstCharge: parseRule(raw.firstCharge, DEFAULT_FAILURE_POLICY.firstCharge),
    renewal: parseRule(raw.renewal, DEFAULT_FAILURE_POLICY.renewal),
    restrictedModules: validList ? [...new Set(list as PaidModuleKey[])] : [...PAID_MODULE_KEYS],
    restoreAccessOnRecovery: typeof raw.restoreAccessOnRecovery === 'boolean' ? raw.restoreAccessOnRecovery : true,
  };
}

function validateRule(raw: any, label: string): { ok: true; value: FailureRule } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: `${label} must be { mode, graceDays }.` };
  if (raw.mode === 'immediate') return { ok: true, value: { mode: 'immediate', graceDays: 0 } };
  if (raw.mode !== 'grace') return { ok: false, error: `${label}.mode must be "immediate" or "grace".` };
  if (!Number.isInteger(raw.graceDays) || raw.graceDays < 1 || raw.graceDays > MAX_GRACE_DAYS) {
    return { ok: false, error: `${label}.graceDays must be a whole number from 1 to ${MAX_GRACE_DAYS}.` };
  }
  return { ok: true, value: { mode: 'grace', graceDays: raw.graceDays } };
}

/** Validates an admin's failure-policy update (all fields required). */
export function validateFailurePolicyUpdate(input: unknown): { ok: true; value: FailurePolicy } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Expected the failed-payment policy object.' };
  const raw = input as any;
  const first = validateRule(raw.firstCharge, 'firstCharge');
  if (!first.ok) return first;
  const renewal = validateRule(raw.renewal, 'renewal');
  if (!renewal.ok) return renewal;
  if (!Array.isArray(raw.restrictedModules)) return { ok: false, error: 'restrictedModules must be a list.' };
  if (raw.restrictedModules.includes(ALWAYS_FREE_MODULE)) {
    return { ok: false, error: `${ALWAYS_FREE_MODULE} is always free and can't be restricted.` };
  }
  const unknown = raw.restrictedModules.filter((m: unknown) => !(PAID_MODULE_KEYS as readonly string[]).includes(m as string));
  if (unknown.length) return { ok: false, error: `Unknown modules: ${unknown.join(', ')}.` };
  if (typeof raw.restoreAccessOnRecovery !== 'boolean') return { ok: false, error: 'restoreAccessOnRecovery must be true or false.' };
  if (raw.alwaysAccessible !== undefined) {
    const all = ALWAYS_ACCESSIBLE.every((k) => raw.alwaysAccessible?.[k] === true);
    if (!all) return { ok: false, error: `${ALWAYS_ACCESSIBLE.join(', ')} always stay accessible during a payment failure and can't be turned off.` };
  }
  return {
    ok: true,
    value: {
      firstCharge: first.value,
      renewal: renewal.value,
      restrictedModules: [...new Set(raw.restrictedModules as PaidModuleKey[])],
      restoreAccessOnRecovery: raw.restoreAccessOnRecovery,
    },
  };
}

/** What a failure episode freezes at Day 0 — later policy edits never change it. */
export interface FailureSnapshot {
  kind: FailureKind;
  failedAt: Date;
  /** = failedAt for an immediate restriction. */
  graceEndsAt: Date;
  restrictedModules: PaidModuleKey[];
  restoreAccessOnRecovery: boolean;
}

export function failureSnapshot(policy: FailurePolicy, kind: FailureKind, failedAt: Date): FailureSnapshot {
  const rule = kind === 'first_charge' ? policy.firstCharge : policy.renewal;
  const graceMs = rule.mode === 'grace' ? rule.graceDays * 24 * 60 * 60 * 1000 : 0;
  return {
    kind,
    failedAt,
    graceEndsAt: new Date(failedAt.getTime() + graceMs),
    restrictedModules: [...policy.restrictedModules],
    restoreAccessOnRecovery: policy.restoreAccessOnRecovery,
  };
}

// ── WhatsApp payment-recovery reminders ─────────────────────────────────────

export interface ReminderStepConfig {
  /** Days after the payment failure (Day 0 = the failure itself). */
  offsetDays: number;
}

export interface ReminderTemplate {
  /** Twilio Content SID of an approved UTILITY template: {{1}} first name, {{2}} business name. */
  contentSid: string;
  /** Set by a super admin once Meta has approved it — a SID alone is never trusted. */
  approved: boolean;
}

export interface ReminderPolicy {
  /** Off by default: nothing is sent until a super admin turns it on with an approved template. */
  enabled: boolean;
  steps: ReminderStepConfig[];
  maxReminders: number;
  /** Local sending window [start, end) in `timezone`, hours 0–24. */
  sendingHours: { start: number; end: number };
  timezone: string;
  /** Temporary provider errors only (rate limits); anything ambiguous is never retried. */
  retry: { maxAttempts: number; backoffMinutes: number };
  template: ReminderTemplate;
  /** Optional different approved template for the last reminder. */
  finalTemplate: ReminderTemplate | null;
}

export const MAX_REMINDER_STEPS = 10;
export const MAX_REMINDER_OFFSET_DAYS = 60;
const CONTENT_SID_RE = /^HX[0-9a-fA-F]{32}$/;

export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  enabled: false,
  steps: [{ offsetDays: 0 }, { offsetDays: 1 }, { offsetDays: 2 }, { offsetDays: 7 }],
  maxReminders: 4,
  sendingHours: { start: 9, end: 20 },
  timezone: 'Asia/Kolkata',
  retry: { maxAttempts: 3, backoffMinutes: 30 },
  template: { contentSid: '', approved: false },
  finalTemplate: null,
};

function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function cleanSteps(raw: unknown): ReminderStepConfig[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_REMINDER_STEPS) return null;
  const offsets = raw.map((s: any) => s?.offsetDays);
  if (!offsets.every((o) => Number.isInteger(o) && o >= 0 && o <= MAX_REMINDER_OFFSET_DAYS)) return null;
  if (new Set(offsets).size !== offsets.length) return null;
  return [...offsets].sort((a, b) => a - b).map((offsetDays) => ({ offsetDays }));
}

function cleanTemplate(raw: any): ReminderTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const sid = typeof raw.contentSid === 'string' ? raw.contentSid.trim() : '';
  if (sid && !CONTENT_SID_RE.test(sid)) return null;
  if (typeof raw.approved !== 'boolean') return null;
  return { contentSid: sid, approved: raw.approved && !!sid };
}

/** True when this template may be sent: a well-formed SID an admin marked approved. */
export function templateUsable(t: ReminderTemplate | null | undefined): boolean {
  return !!t && t.approved && CONTENT_SID_RE.test(t.contentSid);
}

/**
 * Stored policy → reminder policy. Malformed parts fall back to defaults;
 * `enabled` is only true when a usable template is configured — a bad or
 * missing template can never result in a send.
 */
export function parseReminderPolicy(doc: unknown): ReminderPolicy {
  const raw = doc && typeof doc === 'object' ? (doc as any).reminders : null;
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_REMINDER_POLICY);
  const steps = cleanSteps(raw.steps) ?? DEFAULT_REMINDER_POLICY.steps;
  const maxReminders =
    Number.isInteger(raw.maxReminders) && raw.maxReminders >= 1 && raw.maxReminders <= MAX_REMINDER_STEPS
      ? raw.maxReminders
      : DEFAULT_REMINDER_POLICY.maxReminders;
  const h = raw.sendingHours;
  const sendingHours =
    h && Number.isInteger(h.start) && Number.isInteger(h.end) && h.start >= 0 && h.end <= 24 && h.start < h.end
      ? { start: h.start, end: h.end }
      : { ...DEFAULT_REMINDER_POLICY.sendingHours };
  const r = raw.retry;
  const retry =
    r && Number.isInteger(r.maxAttempts) && r.maxAttempts >= 1 && r.maxAttempts <= 5 &&
    Number.isInteger(r.backoffMinutes) && r.backoffMinutes >= 5 && r.backoffMinutes <= 1440
      ? { maxAttempts: r.maxAttempts, backoffMinutes: r.backoffMinutes }
      : { ...DEFAULT_REMINDER_POLICY.retry };
  const template = cleanTemplate(raw.template) ?? { ...DEFAULT_REMINDER_POLICY.template };
  const finalTemplate = raw.finalTemplate ? cleanTemplate(raw.finalTemplate) : null;
  return {
    enabled: raw.enabled === true && templateUsable(template),
    steps,
    maxReminders,
    sendingHours,
    timezone: isValidTimezone(raw.timezone) ? raw.timezone : DEFAULT_REMINDER_POLICY.timezone,
    retry,
    template,
    finalTemplate: finalTemplate && finalTemplate.contentSid ? finalTemplate : null,
  };
}

/** Validates an admin's reminder-policy update (all fields required, strict). */
export function validateReminderPolicyUpdate(input: unknown): { ok: true; value: ReminderPolicy } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Expected the reminder policy object.' };
  const raw = input as any;
  if (typeof raw.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false.' };
  const steps = cleanSteps(raw.steps);
  if (!steps) {
    return { ok: false, error: `steps must be 1–${MAX_REMINDER_STEPS} entries of { offsetDays } with distinct whole days 0–${MAX_REMINDER_OFFSET_DAYS}.` };
  }
  if (!Number.isInteger(raw.maxReminders) || raw.maxReminders < 1 || raw.maxReminders > MAX_REMINDER_STEPS) {
    return { ok: false, error: `maxReminders must be a whole number from 1 to ${MAX_REMINDER_STEPS}.` };
  }
  const h = raw.sendingHours;
  if (!h || !Number.isInteger(h.start) || !Number.isInteger(h.end) || h.start < 0 || h.end > 24 || h.start >= h.end) {
    return { ok: false, error: 'sendingHours must be { start, end } whole hours with 0 ≤ start < end ≤ 24.' };
  }
  if (!isValidTimezone(raw.timezone)) return { ok: false, error: 'timezone must be a valid IANA timezone, e.g. Asia/Kolkata.' };
  const r = raw.retry;
  if (!r || !Number.isInteger(r.maxAttempts) || r.maxAttempts < 1 || r.maxAttempts > 5) {
    return { ok: false, error: 'retry.maxAttempts must be a whole number from 1 to 5.' };
  }
  if (!Number.isInteger(r.backoffMinutes) || r.backoffMinutes < 5 || r.backoffMinutes > 1440) {
    return { ok: false, error: 'retry.backoffMinutes must be a whole number from 5 to 1440.' };
  }
  const template = cleanTemplate(raw.template);
  if (!template) return { ok: false, error: 'template must be { contentSid: "HX…" (34 characters), approved: true|false }.' };
  let finalTemplate: ReminderTemplate | null = null;
  if (raw.finalTemplate !== undefined && raw.finalTemplate !== null) {
    finalTemplate = cleanTemplate(raw.finalTemplate);
    if (!finalTemplate) return { ok: false, error: 'finalTemplate must be { contentSid, approved } or null.' };
    if (!templateUsable(finalTemplate)) return { ok: false, error: 'finalTemplate must be an approved template SID.' };
  }
  if (raw.enabled && !templateUsable(template)) {
    return { ok: false, error: 'Reminders can only be enabled with an approved WhatsApp template (contentSid + approved: true).' };
  }
  return {
    ok: true,
    value: {
      enabled: raw.enabled,
      steps,
      maxReminders: raw.maxReminders,
      sendingHours: { start: h.start, end: h.end },
      timezone: raw.timezone,
      retry: { maxAttempts: r.maxAttempts, backoffMinutes: r.backoffMinutes },
      template,
      finalTemplate,
    },
  };
}
