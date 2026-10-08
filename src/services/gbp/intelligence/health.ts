/**
 * GBP health (FR-3.4 / FR-3.5) — pure (runs under `node --test`).
 *
 * States come ONLY from Google's own signals:
 *   - OAuth refresh result (invalid_grant)            → REAUTH_REQUIRED
 *   - VoiceOfMerchantState (Verifications API)          → SUSPENDED / VERIFICATION_* / NEEDS_ATTENTION
 *   - Location.metadata (duplicateLocation, hasGoogleUpdated, hasVoiceOfMerchant) and openInfo
 *   - Places duplicate search (high-confidence only)
 *   - our own sync outcome                              → SYNC_ERROR
 * A failed request is never read as suspension or as missing verification.
 * The fix guide only describes what the OWNER does in Google — GrowwMatics
 * cannot verify, reinstate or merge a listing.
 */
import type {
  GbpDuplicates,
  GbpHealth,
  GbpLocationData,
  GbpVerificationState,
  HealthIssue,
  HealthState,
  Section,
} from './types.ts';

const GBP_HOME = 'https://business.google.com/';

/** Lower = more urgent. */
const PRIORITY: Record<HealthState, number> = {
  REAUTH_REQUIRED: 0,
  SUSPENDED: 1,
  VERIFICATION_REQUIRED: 2,
  VERIFICATION_PENDING: 3,
  NEEDS_ATTENTION: 4,
  SYNC_ERROR: 5,
  UNKNOWN: 6,
  HEALTHY: 7,
};

type IssueTemplate = Omit<HealthIssue, 'detectedAt'>;

export const FIX_GUIDE: Record<string, IssueTemplate> = {
  AUTH_REVOKED: {
    code: 'AUTH_REVOKED',
    state: 'REAUTH_REQUIRED',
    source: 'oauth',
    reason: 'Google rejected the saved authorization (invalid_grant).',
    explanation: 'GrowwMatics can no longer read your Google Business Profile — access was removed or expired on Google\'s side.',
    recommendedAction: 'Open Google Business Profile in GrowwMatics and click "Connect Google Account" to sign in again.',
    ownerActionRequired: true,
    helpUrl: null,
  },
  SUSPENDED: {
    code: 'SUSPENDED',
    state: 'SUSPENDED',
    source: 'gbp_verifications_api',
    reason: 'Google reports the location must comply with its guidelines (BUSINESS_LOCATION_SUSPENDED).',
    explanation: 'Google has suspended this listing. It may be hidden from Search and Maps until Google reinstates it.',
    recommendedAction: 'Sign in to Google Business Profile, review the suspension notice and submit Google\'s reinstatement request. Only the owner can do this.',
    ownerActionRequired: true,
    helpUrl: GBP_HOME,
  },
  DISABLED: {
    code: 'DISABLED',
    state: 'NEEDS_ATTENTION',
    source: 'gbp_verifications_api',
    reason: 'Google reports the location must comply with its guidelines (BUSINESS_LOCATION_DISABLED).',
    explanation: 'Google has disabled this listing.',
    recommendedAction: 'Sign in to Google Business Profile and follow the steps Google shows for the disabled listing.',
    ownerActionRequired: true,
    helpUrl: GBP_HOME,
  },
  GUIDELINES: {
    code: 'GUIDELINES',
    state: 'NEEDS_ATTENTION',
    source: 'gbp_verifications_api',
    reason: 'Google reports the location must comply with its guidelines.',
    explanation: 'Google says this listing needs changes before it fully complies with its guidelines.',
    recommendedAction: 'Sign in to Google Business Profile and review the guideline notice Google shows.',
    ownerActionRequired: true,
    helpUrl: GBP_HOME,
  },
  VERIFICATION_REQUIRED: {
    code: 'VERIFICATION_REQUIRED',
    state: 'VERIFICATION_REQUIRED',
    source: 'gbp_verifications_api',
    reason: 'Google reports the next step for this location is verification.',
    explanation: 'Google requires verification before this profile can be fully managed and shown.',
    recommendedAction: 'Open Google Business Profile and complete the verification step Google offers (for example a code by phone, email or video).',
    ownerActionRequired: true,
    helpUrl: GBP_HOME,
  },
  VERIFICATION_PENDING: {
    code: 'VERIFICATION_PENDING',
    state: 'VERIFICATION_PENDING',
    source: 'gbp_verifications_api',
    reason: 'Google reports a verification is pending or is waiting to grant ownership.',
    explanation: 'Verification has been started and Google is still processing it.',
    recommendedAction: 'No action needed unless Google asks for more information — check Google Business Profile for messages.',
    ownerActionRequired: false,
    helpUrl: GBP_HOME,
  },
  OWNERSHIP_CONFLICT: {
    code: 'OWNERSHIP_CONFLICT',
    state: 'NEEDS_ATTENTION',
    source: 'gbp_verifications_api',
    reason: 'Google reports an ownership conflict for this location.',
    explanation: 'Someone else may also claim this listing on Google.',
    recommendedAction: 'Open Google Business Profile and follow Google\'s ownership request steps for this listing.',
    ownerActionRequired: true,
    helpUrl: GBP_HOME,
  },
  NO_VOICE_OF_MERCHANT: {
    code: 'NO_VOICE_OF_MERCHANT',
    state: 'NEEDS_ATTENTION',
    source: 'gbp_api',
    reason: 'Location metadata reports hasVoiceOfMerchant = false.',
    explanation: 'Google reports this account cannot currently control what the listing shows (it may be unverified or restricted). We could not read the detailed verification state.',
    recommendedAction: 'Open Google Business Profile and check for a verification or account notice.',
    ownerActionRequired: true,
    helpUrl: GBP_HOME,
  },
  GOOGLE_UPDATES: {
    code: 'GOOGLE_UPDATES',
    state: 'NEEDS_ATTENTION',
    source: 'gbp_api',
    reason: 'Location metadata reports hasGoogleUpdated = true.',
    explanation: 'Google has updated or suggested updates to some listing details.',
    recommendedAction: 'Review the changed fields below and, in Google Business Profile, accept or correct Google\'s updates.',
    ownerActionRequired: true,
    helpUrl: GBP_HOME,
  },
  GOOGLE_FLAGGED_DUPLICATE: {
    code: 'GOOGLE_FLAGGED_DUPLICATE',
    state: 'NEEDS_ATTENTION',
    source: 'gbp_api',
    reason: 'Location metadata reports this location duplicates another location.',
    explanation: 'Google marks this listing as a duplicate of another listing.',
    recommendedAction: 'In Google Business Profile, confirm which listing is the real one and follow Google\'s steps for the duplicate. GrowwMatics never merges or removes listings.',
    ownerActionRequired: true,
    helpUrl: GBP_HOME,
  },
  POSSIBLE_DUPLICATE: {
    code: 'POSSIBLE_DUPLICATE',
    state: 'NEEDS_ATTENTION',
    source: 'google_places',
    reason: 'A nearby Google Maps listing has a matching phone number and/or very similar name and address.',
    explanation: 'Potential duplicate listing detected.',
    recommendedAction: 'Verify whether this Google listing represents the same business before taking action. If it does, ask Google to remove or merge it from Google Maps ("Suggest an edit" → closed or duplicate).',
    ownerActionRequired: true,
    helpUrl: null,
  },
  CLOSED_PERMANENTLY: {
    code: 'CLOSED_PERMANENTLY',
    state: 'NEEDS_ATTENTION',
    source: 'gbp_api',
    reason: 'openInfo.status = CLOSED_PERMANENTLY.',
    explanation: 'Google shows this business as permanently closed.',
    recommendedAction: 'If the business is open, change the status in Google Business Profile.',
    ownerActionRequired: true,
    helpUrl: GBP_HOME,
  },
  CLOSED_TEMPORARILY: {
    code: 'CLOSED_TEMPORARILY',
    state: 'NEEDS_ATTENTION',
    source: 'gbp_api',
    reason: 'openInfo.status = CLOSED_TEMPORARILY.',
    explanation: 'Google shows this business as temporarily closed.',
    recommendedAction: 'If the business has reopened, mark it open in Google Business Profile.',
    ownerActionRequired: true,
    helpUrl: GBP_HOME,
  },
  SYNC_FAILED: {
    code: 'SYNC_FAILED',
    state: 'SYNC_ERROR',
    source: 'sync',
    reason: 'The latest read of the Google listing failed.',
    explanation: 'GrowwMatics could not refresh your Google listing; the details shown are from the last successful sync.',
    recommendedAction: 'No action needed — GrowwMatics retries automatically. Use "Sync now" later if this persists.',
    ownerActionRequired: false,
    helpUrl: null,
  },
};

export interface HealthInput {
  authRevoked: boolean;
  location: Section<GbpLocationData> | null | undefined;
  verification: Section<GbpVerificationState> | null | undefined;
  duplicates: Section<GbpDuplicates> | null | undefined;
  previous?: GbpHealth | null;
  now: Date;
}

export function computeHealth(input: HealthInput): GbpHealth {
  const nowIso = input.now.toISOString();
  const codes: Array<{ code: string; reason?: string }> = [];

  if (input.authRevoked) codes.push({ code: 'AUTH_REVOKED' });

  const v = input.verification?.meta.status === 'SUCCESS' ? input.verification.data : null;
  if (v) {
    if (v.complyWithGuidelines) {
      const r = v.complyWithGuidelines.recommendationReason;
      codes.push({ code: r === 'BUSINESS_LOCATION_SUSPENDED' ? 'SUSPENDED' : r === 'BUSINESS_LOCATION_DISABLED' ? 'DISABLED' : 'GUIDELINES' });
    } else if (v.resolveOwnershipConflict) {
      codes.push({ code: 'OWNERSHIP_CONFLICT' });
    } else if (v.verify) {
      codes.push({ code: v.verify.hasPendingVerification ? 'VERIFICATION_PENDING' : 'VERIFICATION_REQUIRED' });
    } else if (v.waitForVoiceOfMerchant) {
      codes.push({ code: 'VERIFICATION_PENDING' });
    }
  }

  // Location data: the last SUCCESSFUL read (still valid evidence if this sync failed).
  const loc = input.location?.data || null;
  if (loc) {
    if (!v && loc.metadata.hasVoiceOfMerchant === false) codes.push({ code: 'NO_VOICE_OF_MERCHANT' });
    if (loc.metadata.hasGoogleUpdated) codes.push({ code: 'GOOGLE_UPDATES' });
    if (loc.metadata.duplicateLocation) codes.push({ code: 'GOOGLE_FLAGGED_DUPLICATE' });
    if (loc.openInfo?.status === 'CLOSED_PERMANENTLY') codes.push({ code: 'CLOSED_PERMANENTLY' });
    if (loc.openInfo?.status === 'CLOSED_TEMPORARILY') codes.push({ code: 'CLOSED_TEMPORARILY' });
  }

  const dup = input.duplicates?.data;
  if (dup && !dup.googleFlaggedDuplicateOf && dup.candidates.some((c) => c.confidence === 'high')) {
    codes.push({ code: 'POSSIBLE_DUPLICATE' });
  }

  const locStatus = input.location?.meta.status;
  if (!input.authRevoked && locStatus === 'FAILED') {
    const err = input.location?.meta.error;
    codes.push({
      code: 'SYNC_FAILED',
      reason: err ? `The latest read of the Google listing failed (${err.category}${err.httpStatus ? ` ${err.httpStatus}` : ''}).` : undefined,
    });
  }

  const prevDetected = new Map((input.previous?.issues || []).map((i) => [i.code, i.detectedAt]));
  const issues: HealthIssue[] = codes.map(({ code, reason }) => ({
    ...FIX_GUIDE[code],
    ...(reason ? { reason } : {}),
    detectedAt: prevDetected.get(code) || nowIso,
  }));
  issues.sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state]);

  let state: HealthState;
  if (issues.length) state = issues[0].state;
  else if (loc) state = 'HEALTHY';
  else state = 'UNKNOWN';
  return { state, issues, lastCheckedAt: nowIso };
}

/** Issue codes present now but not before — what deserves a new alert. */
export function newIssueCodes(prev: GbpHealth | null | undefined, next: GbpHealth): string[] {
  const before = new Set((prev?.issues || []).map((i) => i.code));
  return next.issues.map((i) => i.code).filter((c) => !before.has(c));
}
