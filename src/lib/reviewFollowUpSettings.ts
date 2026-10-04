/**
 * Global review follow-up policy.
 *
 * There is one platform policy, edited by Super Admin. Businesses do not
 * configure it and cannot override the delays.
 *
 * Future review-request runs read the persisted policy when their Inngest
 * `load-config` step executes. A run that already finished that step keeps
 * the schedule it started with. Inngest does not re-run a completed step,
 * and this module does not rewrite existing ReviewRequest documents.
 *
 * Timing uses the existing Inngest duration model (`Nd` from the previous
 * step). That is a 24-hour period, not a new timezone calendar.
 *
 * A click is not a submitted Google review. Nothing in the app writes a
 * verified review-completion signal onto ReviewRequest.reviewReceived, so
 * follow-ups do not stop because a review was "completed".
 */

import { decideReviewSendEligibility } from './reviewRequestFlow.ts';

/** Matches Campaign reminder day bounds. */
export const FOLLOW_UP_DELAY_MIN_DAYS = 1;
export const FOLLOW_UP_DELAY_MAX_DAYS = 60;
/** ReviewRequest.followUpStage only records two follow-ups after the initial send. */
export const FOLLOW_UP_MAX_COUNT = 2;

export interface GlobalReviewFollowUpSettings {
  enabled: boolean;
  /** Days after the initial request before the first follow-up. */
  initialFollowUpDelayDays: number;
  /** Days after the first follow-up before the second follow-up. */
  secondFollowUpDelayDays: number;
  maximumFollowUps: number;
  minimumIntervalDays: number;
  stopOnOptOut: boolean;
  /** Unused. A click does not stop follow-ups and is not a review. */
  stopOnClick: boolean;
  /** Unused. No verified Google review-completion signal exists. */
  stopOnReview: boolean;
}

/**
 * Seed written the first time the policy is read. This preserves the
 * historical one-off schedule until Super Admin saves a different policy.
 */
export const DEFAULT_GLOBAL_REVIEW_FOLLOW_UP: GlobalReviewFollowUpSettings = {
  enabled: true,
  initialFollowUpDelayDays: 2,
  secondFollowUpDelayDays: 5,
  maximumFollowUps: 2,
  minimumIntervalDays: 1,
  stopOnOptOut: true,
  stopOnClick: false,
  stopOnReview: false,
};

export interface ReviewFollowUpConfig {
  source: 'global' | 'campaign-defaults' | 'campaign';
  initialMessage: string;
  reminder1Enabled: boolean;
  reminder1AfterDays: number;
  reminder1Message: string;
  reminder2Enabled: boolean;
  reminder2AfterDays: number;
  reminder2Message: string;
  stopOnReview: boolean;
  sendOnlyBizHours: boolean;
  bizHoursStart: number;
  bizHoursEnd: number;
}

export const ONE_OFF_FOLLOW_UP_DEFAULTS: ReviewFollowUpConfig = {
  source: 'campaign-defaults',
  initialMessage: '',
  reminder1Enabled: true,
  reminder1AfterDays: 2,
  reminder1Message: '',
  reminder2Enabled: true,
  reminder2AfterDays: 5,
  reminder2Message: '',
  stopOnReview: false,
  sendOnlyBizHours: false,
  bizHoursStart: 9,
  bizHoursEnd: 20,
};

export interface CampaignFollowUpInput {
  initialMessage?: string | null;
  reminder1Enabled?: boolean | null;
  reminder1AfterDays?: number | null;
  reminder1Message?: string | null;
  reminder2Enabled?: boolean | null;
  reminder2AfterDays?: number | null;
  reminder2Message?: string | null;
  stopOnReview?: boolean | null;
  sendOnlyBizHours?: boolean | null;
  bizHoursStart?: number | null;
  bizHoursEnd?: number | null;
}

export function resolveReviewFollowUpSettings(
  campaign: CampaignFollowUpInput | null | undefined
): ReviewFollowUpConfig {
  if (!campaign) return { ...ONE_OFF_FOLLOW_UP_DEFAULTS };
  return {
    source: 'campaign',
    initialMessage: campaign.initialMessage || '',
    reminder1Enabled: campaign.reminder1Enabled ?? true,
    reminder1AfterDays: campaign.reminder1AfterDays ?? 2,
    reminder1Message: campaign.reminder1Message || '',
    reminder2Enabled: campaign.reminder2Enabled ?? true,
    reminder2AfterDays: campaign.reminder2AfterDays ?? 5,
    reminder2Message: campaign.reminder2Message || '',
    stopOnReview: false,
    sendOnlyBizHours: campaign.sendOnlyBizHours ?? false,
    bizHoursStart: campaign.bizHoursStart ?? 9,
    bizHoursEnd: campaign.bizHoursEnd ?? 20,
  };
}

/**
 * Delays and whether follow-ups run come only from the global policy.
 * A campaign, when one is already attached to the request, may still supply
 * message text. It cannot change the delays.
 *
 * A null policy is the historical fallback used only when the policy document
 * cannot be read. The worker passes the persisted policy.
 */
export function resolveReviewFollowUpSettingsWithGlobal(
  campaign: CampaignFollowUpInput | null | undefined,
  globalSettings: GlobalReviewFollowUpSettings | null
): ReviewFollowUpConfig {
  const base = resolveReviewFollowUpSettings(campaign);
  if (!globalSettings) return base;

  const max = globalSettings.maximumFollowUps;
  const followUpsOn = globalSettings.enabled && max > 0;
  return {
    ...base,
    source: 'global',
    reminder1Enabled: followUpsOn && max >= 1,
    reminder1AfterDays: globalSettings.initialFollowUpDelayDays,
    reminder1Message: base.reminder1Message,
    reminder2Enabled: followUpsOn && max >= 2,
    reminder2AfterDays: globalSettings.secondFollowUpDelayDays,
    reminder2Message: base.reminder2Message,
    stopOnReview: false,
  };
}

function wholeDay(value: unknown, label: string): { ok: true; value: number } | { ok: false; error: string } {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < FOLLOW_UP_DELAY_MIN_DAYS || number > FOLLOW_UP_DELAY_MAX_DAYS) {
    return {
      ok: false,
      error: `${label} must be a whole number from ${FOLLOW_UP_DELAY_MIN_DAYS} to ${FOLLOW_UP_DELAY_MAX_DAYS} days.`,
    };
  }
  return { ok: true, value: number };
}

export function validateGlobalReviewFollowUpSettings(
  input: unknown
): { ok: true; value: GlobalReviewFollowUpSettings } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Follow-up settings are missing.' };
  }
  const body = input as Record<string, unknown>;
  if (body.stopOnClick === true) {
    return { ok: false, error: 'A click is not a submitted review and cannot stop follow-ups.' };
  }
  if (body.stopOnReview === true) {
    return {
      ok: false,
      error: 'Follow-ups cannot stop on review completion because no verified Google review signal is available.',
    };
  }
  if (body.stopOnOptOut === false) {
    return { ok: false, error: 'Follow-ups must stop when the customer opts out.' };
  }

  const first = wholeDay(body.initialFollowUpDelayDays, 'First follow-up delay');
  if (!first.ok) return first;
  const second = wholeDay(body.secondFollowUpDelayDays, 'Second follow-up delay');
  if (!second.ok) return second;
  const interval = wholeDay(body.minimumIntervalDays, 'Minimum interval');
  if (!interval.ok) return interval;

  const max = typeof body.maximumFollowUps === 'number' ? body.maximumFollowUps : Number(body.maximumFollowUps);
  if (!Number.isInteger(max) || max < 0 || max > FOLLOW_UP_MAX_COUNT) {
    return {
      ok: false,
      error: `Maximum follow-ups must be a whole number from 0 to ${FOLLOW_UP_MAX_COUNT}.`,
    };
  }
  if (max >= 2 && second.value < interval.value) {
    return {
      ok: false,
      error: 'Second follow-up delay cannot be shorter than the minimum interval.',
    };
  }

  return {
    ok: true,
    value: {
      enabled: body.enabled === true,
      initialFollowUpDelayDays: first.value,
      secondFollowUpDelayDays: second.value,
      maximumFollowUps: max,
      minimumIntervalDays: interval.value,
      stopOnOptOut: true,
      stopOnClick: false,
      stopOnReview: false,
    },
  };
}

export interface FollowUpEligibilityInput {
  stage: 1 | 2;
  policy: GlobalReviewFollowUpSettings;
  customerExists: boolean;
  hasPhone: boolean;
  optedOut: boolean;
  hasPlaceId: boolean;
  businessMatches: boolean;
  dailyLimitReached: boolean;
  dailyLimitMessage?: string;
  requestOpen: boolean;
  followUpStage: number;
  alreadySentThisStage: boolean;
  /** When set, the follow-up is too early if now is before this instant. */
  earliestSendAt?: Date | string | null;
  now?: Date | string | null;
}

/**
 * Follow-up gate. Customer, phone, Place ID, opt-out, and the daily cap go
 * through decideReviewSendEligibility. Click and reviewReceived are not inputs.
 */
export function decideFollowUpEligibility(
  input: FollowUpEligibilityInput
): { send: boolean; code: string; message: string } {
  if (!input.policy.enabled) {
    return { send: false, code: 'DISABLED', message: 'Global follow-ups are disabled.' };
  }
  if (input.stage > input.policy.maximumFollowUps) {
    return { send: false, code: 'MAX_FOLLOW_UPS', message: 'Maximum follow-ups reached.' };
  }
  if (!input.customerExists) {
    return { send: false, code: 'CUSTOMER_MISSING', message: 'Customer no longer exists.' };
  }
  if (!input.businessMatches) {
    return { send: false, code: 'BUSINESS_MISMATCH', message: 'Customer is no longer linked to this business.' };
  }
  if (!input.requestOpen) {
    return { send: false, code: 'REQUEST_CLOSED', message: 'Review request is no longer eligible.' };
  }
  if (input.followUpStage >= input.stage || input.alreadySentThisStage) {
    return { send: false, code: 'ALREADY_SENT', message: 'This follow-up was already sent.' };
  }
  if (input.earliestSendAt && input.now) {
    const earliest = new Date(input.earliestSendAt).getTime();
    const now = new Date(input.now).getTime();
    if (Number.isFinite(earliest) && Number.isFinite(now) && now < earliest) {
      return { send: false, code: 'INTERVAL', message: 'Minimum interval has not elapsed.' };
    }
  }

  const gate = decideReviewSendEligibility({
    source: 'manual',
    optedOut: input.optedOut,
    hasPhone: input.hasPhone,
    hasPlaceId: input.hasPlaceId,
    dailyLimitReached: input.dailyLimitReached,
    dailyLimitMessage: input.dailyLimitMessage,
    hasActiveCampaignRequest: false,
    cooldownActive: false,
  });
  if (!gate.allowed) return { send: false, code: gate.code, message: gate.message };
  return { send: true, code: 'OK', message: 'Eligible for follow-up.' };
}
