/**
 * Campaign-level review follow-up settings.
 *
 * Timing is unchanged: one-off sends use the historical defaults (reminder
 * after 2 days, final reminder 5 days after that). A campaign uses its own
 * stored values.
 *
 * GlobalReviewFollowUpSettings is the shape a later Super Admin screen can
 * persist. resolveReviewFollowUpSettingsWithGlobal accepts that object and
 * currently ignores it, so turning the screen on later does not require a
 * new call site inside the Inngest worker.
 */

export interface GlobalReviewFollowUpSettings {
  enabled: boolean;
  initialFollowUpDelayDays: number;
  maximumFollowUps: number;
  minimumIntervalDays: number;
  stopOnOptOut: boolean;
  stopOnClick: boolean;
  stopOnReview: boolean;
}

export interface ReviewFollowUpConfig {
  source: 'campaign-defaults' | 'campaign';
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
  stopOnReview: true,
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
    stopOnReview: campaign.stopOnReview ?? true,
    sendOnlyBizHours: campaign.sendOnlyBizHours ?? false,
    bizHoursStart: campaign.bizHoursStart ?? 9,
    bizHoursEnd: campaign.bizHoursEnd ?? 20,
  };
}

export function resolveReviewFollowUpSettingsWithGlobal(
  campaign: CampaignFollowUpInput | null | undefined,
  _globalSettings: GlobalReviewFollowUpSettings | null
): ReviewFollowUpConfig {
  return resolveReviewFollowUpSettings(campaign);
}
