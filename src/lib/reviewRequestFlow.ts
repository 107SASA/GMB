import { randomBytes } from 'crypto';

/**
 * Pure review-request rules shared by the send worker, the status webhook,
 * the public redirect, and both dashboards. No database and no Twilio here.
 *
 * Two WhatsApp templates stay separate:
 *   - Legacy marketing template: {{3}} is the Google Place ID.
 *   - Utility template (TWILIO_TEMPLATE_REVIEW_REQUEST_UTILITY): {{3}} is
 *     the ReviewRequest token. It must never receive the Place ID.
 */

export const PLACE_ID_REQUIRED_MESSAGE =
  'Connect and verify your Google Business Profile before sending review requests. Without it, WhatsApp cannot deliver a review request to a customer who hasn\'t messaged you before — go to Settings → Google Business Profile to connect it.';

export const GENERIC_REVIEW_REDIRECT = 'https://google.com';

/** Not applied. Reserved so a later 24-hour rule can flip one flag. */
export const REVIEW_SEND_COOLDOWN_ENFORCED = false;

export const BUSINESS_FAILURE_LABEL = 'Unable to deliver';

export type ReviewSendSource = 'manual' | 'quick-add' | 'campaign' | 'retry';

export type ReviewTemplateKind = 'utility' | 'legacy' | 'free_text';

export type ReviewMessageStage = 'initial' | 'reminder1' | 'reminder2' | 'retry';

const TECHNICAL_KEY = /errorCode|errorMessage|failedReason|templateSid|messageSid|lastMessageSid|token|oauth|stack/i;

export function generateReviewRequestToken(): string {
  return randomBytes(18).toString('base64url');
}

export function isSafeReviewToken(token: string): boolean {
  return typeof token === 'string' && token.length > 0 && token.length <= 128 && /^[A-Za-z0-9_-]+$/.test(token);
}

/**
 * Path token for /review/{token}. A query such as ?src=wa is not part of
 * the token. The utility template body is
 * https://growwmatics.com/review/{{3}}?src=wa
 */
export function extractReviewToken(pathToken: string): string {
  if (typeof pathToken !== 'string') return '';
  let token = pathToken.trim();
  try {
    token = decodeURIComponent(token);
  } catch {
    token = pathToken.trim();
  }
  const query = token.indexOf('?');
  if (query >= 0) token = token.slice(0, query);
  const hash = token.indexOf('#');
  if (hash >= 0) token = token.slice(0, hash);
  return token;
}

/** A stored Google Place ID. Resource names, CIDs, and URLs are not place IDs. */
export function isGooglePlaceId(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?=.*[A-Za-z])[A-Za-z0-9_-]{10,200}$/.test(value.trim())
    && value.trim() === value;
}

/** Place ID already embedded in a stored Maps or write-review URL. */
function placeIdFromStoredUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    const direct = parsed.searchParams.get('placeid') || parsed.searchParams.get('place_id') || parsed.searchParams.get('query_place_id');
    if (direct && isGooglePlaceId(direct.trim())) return direct.trim();
    const q = parsed.searchParams.get('q') || '';
    const embedded = q.match(/place_id:([A-Za-z0-9_-]{10,200})/);
    if (embedded && isGooglePlaceId(embedded[1])) return embedded[1];
  } catch {
    return null;
  }
  return null;
}

/**
 * Place ID already stored for this business.
 * Verified location, then the connected listing, then the review-send field.
 * A Place ID already inside a stored Maps URL is used only when those are empty.
 */
export function canonicalReviewPlaceId(business: {
  placeId?: string | null;
  googlePlaceId?: string | null;
  verifiedLocation?: { placeId?: string | null } | null;
  googleMapsUrl?: string | null;
} | null | undefined): string | null {
  if (!business) return null;
  const candidates = [business.verifiedLocation?.placeId, business.googlePlaceId, business.placeId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && isGooglePlaceId(candidate.trim())) return candidate.trim();
  }
  return placeIdFromStoredUrl(business.googleMapsUrl);
}

/**
 * Direct Google "Write a review" URL. A missing Place ID uses the same
 * generic fallback as an unknown token. Maps and search URLs are not used.
 */
export function buildGoogleReviewUrl(
  business: {
    placeId?: string | null;
    googlePlaceId?: string | null;
    verifiedLocation?: { placeId?: string | null } | null;
    googleMapsUrl?: string | null;
    name?: string | null;
  } | null | undefined
): string {
  const placeId = canonicalReviewPlaceId(business);
  if (!placeId) return GENERIC_REVIEW_REDIRECT;
  return `https://search.google.com/local/writereview?placeid=${placeId}`;
}

export function applyClick(current: { clicked?: boolean; clickCount?: number }): {
  clicked: true;
  setClickedAt: boolean;
  clickCount: number;
  incrementCampaignClicked: boolean;
  markReviewReceived: false;
} {
  const first = !current.clicked;
  return {
    clicked: true,
    setClickedAt: first,
    clickCount: (current.clickCount || 0) + 1,
    incrementCampaignClicked: first,
    markReviewReceived: false,
  };
}

export function buildUtilityReviewVariables(
  customerName: string,
  businessName: string,
  token: string
): Record<'1' | '2' | '3', string> {
  if (!token) {
    throw new Error('ReviewRequest token is required for the utility template');
  }
  return {
    '1': customerName || 'there',
    '2': businessName || 'our business',
    '3': token,
  };
}

export function buildLegacyReviewVariables(
  customerName: string,
  businessName: string,
  placeId: string
): Record<'1' | '2' | '3', string> {
  return {
    '1': customerName || 'there',
    '2': businessName || 'our business',
    '3': placeId,
  };
}

export function choosePrimaryReviewSend(input: {
  utilitySid: string;
  token: string;
  customerName: string;
  businessName: string;
}):
  | { mode: 'utility'; contentSid: string; variables: Record<'1' | '2' | '3', string> }
  | { mode: 'legacy-free-text' } {
  const utilitySid = input.utilitySid?.trim() || '';
  if (utilitySid && input.token) {
    return {
      mode: 'utility',
      contentSid: utilitySid,
      variables: buildUtilityReviewVariables(input.customerName, input.businessName, input.token),
    };
  }
  return { mode: 'legacy-free-text' };
}

/**
 * Automatic retry is only the existing 63016 free-text → template recovery.
 * 63049 (Meta refused a marketing send) is terminal for that attempt.
 * A message that was already a template is never retried, so this cannot loop.
 * When the utility template is configured it wins, and {{3}} is the token.
 * Otherwise the legacy template still receives the Place ID.
 */
export function chooseReviewTemplateRetry(input: {
  errorCode?: string;
  alreadyTemplate: boolean;
  utilitySid: string;
  legacySid: string;
  token: string;
  placeId: string;
  customerName: string;
  businessName: string;
}):
  | { mode: 'none' }
  | { mode: 'utility'; contentSid: string; variables: Record<'1' | '2' | '3', string> }
  | { mode: 'legacy'; contentSid: string; variables: Record<'1' | '2' | '3', string> } {
  if (input.alreadyTemplate) return { mode: 'none' };
  if (input.errorCode === '63049') return { mode: 'none' };
  if (input.errorCode !== '63016') return { mode: 'none' };

  const utilitySid = input.utilitySid?.trim() || '';
  if (utilitySid && input.token) {
    return {
      mode: 'utility',
      contentSid: utilitySid,
      variables: buildUtilityReviewVariables(input.customerName, input.businessName, input.token),
    };
  }
  const legacySid = input.legacySid?.trim() || '';
  if (legacySid && input.placeId) {
    return {
      mode: 'legacy',
      contentSid: legacySid,
      variables: buildLegacyReviewVariables(input.customerName, input.businessName, input.placeId),
    };
  }
  return { mode: 'none' };
}

export function decideReviewSendEligibility(input: {
  source: ReviewSendSource;
  optedOut: boolean;
  hasPhone: boolean;
  hasPlaceId: boolean;
  dailyLimitReached: boolean;
  dailyLimitMessage?: string;
  hasActiveCampaignRequest: boolean;
  /** Production passes REVIEW_SEND_COOLDOWN_ENFORCED (false). */
  cooldownActive?: boolean;
}): { allowed: boolean; code: string; message: string } {
  if (input.optedOut) {
    return { allowed: false, code: 'OPTED_OUT', message: 'This customer previously opted out of messages.' };
  }
  if (!input.hasPhone) {
    return { allowed: false, code: 'NO_PHONE', message: 'This customer has no phone number.' };
  }
  if (!input.hasPlaceId) {
    return { allowed: false, code: 'NO_PLACE_ID', message: PLACE_ID_REQUIRED_MESSAGE };
  }
  if (input.dailyLimitReached) {
    return {
      allowed: false,
      code: 'DAILY_LIMIT',
      message: input.dailyLimitMessage || 'Daily WhatsApp message limit reached.',
    };
  }
  if (input.source === 'campaign' && input.hasActiveCampaignRequest) {
    return {
      allowed: false,
      code: 'CAMPAIGN_IN_PROGRESS',
      message: 'A review request is already in progress for this customer.',
    };
  }
  if (input.cooldownActive) {
    return {
      allowed: false,
      code: 'COOLDOWN',
      message: 'A review request was sent recently. Please wait before sending another.',
    };
  }
  return { allowed: true, code: 'OK', message: 'Eligible to send a review request.' };
}

export function existingCustomerSendOffer(customerId: string): {
  create: false;
  code: 'CUSTOMER_EXISTS';
  message: 'Customer already exists';
  customerId: string;
} {
  return {
    create: false,
    code: 'CUSTOMER_EXISTS',
    message: 'Customer already exists',
    customerId,
  };
}

export interface TwilioFailureFields {
  status: 'Failed';
  automationStatus: 'Stopped';
  errorCode?: string;
  errorMessage: string;
  failedReason: string;
  failedAt: Date;
}

export function syncFailureFields(
  code: string | number | undefined | null,
  message: string | undefined | null,
  now: Date
): TwilioFailureFields {
  const errorCode = code != null && String(code).trim() ? String(code).trim() : undefined;
  const errorMessage = message?.trim() || (errorCode ? `Twilio error ${errorCode}` : 'Delivery failed');
  return {
    status: 'Failed',
    automationStatus: 'Stopped',
    errorCode,
    errorMessage,
    failedReason: errorMessage,
    failedAt: now,
  };
}

export function interpretTwilioStatus(
  messageStatus: string,
  errorCode: string | null,
  errorMessage: string | null
):
  | { kind: 'ignore' }
  | { kind: 'delivered' }
  | { kind: 'read' }
  | { kind: 'failed'; errorCode?: string; errorMessage: string; failedReason: string } {
  const status = (messageStatus || '').toLowerCase();
  const code = errorCode?.trim() || undefined;
  const message = errorMessage?.trim() || undefined;
  if (status === 'read') return { kind: 'read' };
  if (status === 'delivered') return { kind: 'delivered' };
  if (status === 'failed' || status === 'undelivered') {
    const errorMessageText = message || (code ? `Twilio error ${code}` : 'Delivery failed');
    return { kind: 'failed', errorCode: code, errorMessage: errorMessageText, failedReason: errorMessageText };
  }
  return { kind: 'ignore' };
}

export function readTimestamps(now: Date, existingDeliveredAt?: Date | null): {
  status: 'Read';
  readAt: Date;
  deliveredAt: Date;
} {
  return {
    status: 'Read',
    readAt: now,
    deliveredAt: existingDeliveredAt ?? now,
  };
}

export interface ReviewRequestMetricRow {
  status?: string | null;
  sentAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  readAt?: Date | string | null;
  clickedAt?: Date | string | null;
  reviewReceived?: boolean;
}

export function aggregateReviewRequestMetrics(rows: ReviewRequestMetricRow[]): {
  reviewRequests: number;
  delivered: number;
  read: number;
  clicked: number;
  failed: number;
} {
  const metrics = { reviewRequests: 0, delivered: 0, read: 0, clicked: 0, failed: 0 };
  for (const row of rows) {
    if (!row || row.status === 'Pending' || row.status === 'Cancelled') continue;
    metrics.reviewRequests += 1;
    const wasRead = row.status === 'Read' || !!row.readAt;
    const wasDelivered = wasRead || row.status === 'Delivered' || !!row.deliveredAt;
    if (wasDelivered) metrics.delivered += 1;
    if (wasRead) metrics.read += 1;
    if (row.clickedAt) metrics.clicked += 1;
    if (row.status === 'Failed') metrics.failed += 1;
  }
  return metrics;
}

export function followUpLabel(stage?: number | null, automationStatus?: string | null): string {
  if (automationStatus === 'Stopped') return 'Stopped';
  if ((stage ?? 0) >= 2 || automationStatus === 'Completed') return 'Follow-ups finished';
  if (stage === 1) return 'Reminder 1 sent';
  if ((stage ?? 0) === 0 && automationStatus === 'Active') return 'Follow-up scheduled';
  return 'Not started';
}

export function businessStatusLabel(row: {
  status?: string | null;
  clickedAt?: Date | string | null;
  readAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  sentAt?: Date | string | null;
}): string {
  if (row.status === 'Failed') return BUSINESS_FAILURE_LABEL;
  if (row.status === 'Cancelled') return 'Cancelled';
  if (row.clickedAt) return 'Clicked';
  if (row.status === 'Read') return 'Read';
  if (row.status === 'Delivered') return 'Delivered';
  if (row.status === 'Sent') return 'Sent';
  if (row.readAt) return 'Read';
  if (row.deliveredAt) return 'Delivered';
  if (row.sentAt) return 'Sent';
  return 'Pending';
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface BusinessReviewSummary {
  statusLabel: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  clickedAt: string | null;
  lastRequestAt: string | null;
  followUpLabel: string;
}

/** Fields a business dashboard or the mobile app is allowed to render. */
export function toBusinessReviewSummary(row: {
  status?: string | null;
  sentAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  readAt?: Date | string | null;
  clickedAt?: Date | string | null;
  createdAt?: Date | string | null;
  followUpStage?: number | null;
  automationStatus?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  failedReason?: string | null;
  templateSid?: string | null;
  lastMessageSid?: string | null;
  token?: string | null;
}): BusinessReviewSummary {
  const summary: BusinessReviewSummary = {
    statusLabel: businessStatusLabel(row),
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    readAt: iso(row.readAt),
    clickedAt: iso(row.clickedAt),
    lastRequestAt: iso(row.sentAt) || iso(row.createdAt),
    followUpLabel: followUpLabel(row.followUpStage, row.automationStatus),
  };
  for (const key of Object.keys(summary)) {
    if (TECHNICAL_KEY.test(key)) {
      throw new Error(`Business review summary leaked ${key}`);
    }
  }
  return summary;
}

export interface AdminReviewDiagnostics {
  reviewRequestId: string;
  customerId: string;
  businessId: string;
  provider: 'Twilio';
  status: string;
  statusLabel: string;
  templateSid: string | null;
  templateKind: string | null;
  lastMessageSid: string | null;
  messageSids: string[];
  errorCode: string | null;
  errorMessage: string | null;
  failedReason: string | null;
  failedAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  clickedAt: string | null;
  clickCount: number;
  followUpStage: number;
  followUpLabel: string;
  automationStatus: string | null;
  messageHistory: Array<{
    sid: string | null;
    templateSid: string | null;
    templateKind: string | null;
    stage: string | null;
    status: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    sentAt: string | null;
    failedAt: string | null;
  }>;
}

export function toAdminReviewDiagnostics(row: {
  _id?: { toString(): string } | string;
  customerId?: { toString(): string } | string;
  businessId?: { toString(): string } | string;
  status?: string | null;
  templateSid?: string | null;
  lastMessageSid?: string | null;
  messageSids?: string[] | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  failedReason?: string | null;
  failedAt?: Date | string | null;
  sentAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  readAt?: Date | string | null;
  clickedAt?: Date | string | null;
  clickCount?: number | null;
  followUpStage?: number | null;
  automationStatus?: string | null;
  createdAt?: Date | string | null;
  messageHistory?: Array<{
    sid?: string | null;
    templateSid?: string | null;
    templateKind?: string | null;
    stage?: string | null;
    status?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    sentAt?: Date | string | null;
    failedAt?: Date | string | null;
  }> | null;
}): AdminReviewDiagnostics {
  const id = (value: { toString(): string } | string | undefined) =>
    value == null ? '' : typeof value === 'string' ? value : value.toString();
  const history = Array.isArray(row.messageHistory) ? row.messageHistory : [];
  const latestKind = [...history].reverse().find((entry) => entry?.templateKind)?.templateKind ?? null;
  return {
    reviewRequestId: id(row._id),
    customerId: id(row.customerId),
    businessId: id(row.businessId),
    provider: 'Twilio',
    status: row.status || 'Pending',
    statusLabel: businessStatusLabel(row),
    templateSid: row.templateSid || null,
    templateKind: latestKind,
    lastMessageSid: row.lastMessageSid || null,
    messageSids: Array.isArray(row.messageSids) ? row.messageSids.filter(Boolean) : [],
    errorCode: row.errorCode || null,
    errorMessage: row.errorMessage || row.failedReason || null,
    failedReason: row.failedReason || null,
    failedAt: iso(row.failedAt),
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    readAt: iso(row.readAt),
    clickedAt: iso(row.clickedAt),
    clickCount: row.clickCount || 0,
    followUpStage: row.followUpStage || 0,
    followUpLabel: followUpLabel(row.followUpStage, row.automationStatus),
    automationStatus: row.automationStatus || null,
    messageHistory: history.map((entry) => ({
      sid: entry?.sid || null,
      templateSid: entry?.templateSid || null,
      templateKind: entry?.templateKind || null,
      stage: entry?.stage || null,
      status: entry?.status || null,
      errorCode: entry?.errorCode || null,
      errorMessage: entry?.errorMessage || null,
      sentAt: iso(entry?.sentAt),
      failedAt: iso(entry?.failedAt),
    })),
  };
}
