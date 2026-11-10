/**
 * Google access state — pure (runs under `node --test`).
 *
 * "Connected" (Business.googleConnected) only means the owner signed in with
 * Google and picked a location. It says nothing about whether Google lets
 * GrowwMatics read and manage that profile: an account that is not an Owner /
 * Manager of the listing, or a listing that is not verified, gets 403
 * PERMISSION_DENIED on every request.
 *
 * Business.googleAccess records what Google actually allowed on the last
 * sync. Background work (first report, SEO plan, AI posts and images,
 * publishing, digests, reminders) runs only for `verified`:
 *
 *   checking — signed in, first check not finished yet
 *   verified — the location reads, it is verified and we may post / edit
 *   limited  — the location reads, but Google refuses posting / editing
 *              (not verified, verification pending, suspended, ownership conflict)
 *   blocked  — Google refuses access to the location (403 / 404 / revoked)
 *
 * Only Google's own answers move the state. A temporary failure (5xx, rate
 * limit, network, our own API configuration) is inconclusive and leaves the
 * previous state untouched, so a Google outage never blocks a working customer.
 */
import type { GbpLocationData, GbpVerificationState, Section, SectionError } from '../intelligence/types.ts';

export type GoogleAccessState = 'checking' | 'verified' | 'limited' | 'blocked';

export type GoogleAccessReason =
  | 'token_revoked'
  | 'no_permission'
  | 'location_gone'
  | 'suspended'
  | 'ownership_conflict'
  | 'verification_pending'
  | 'not_verified'
  | 'cannot_post';

export interface GoogleAccessVerdict {
  state: Exclude<GoogleAccessState, 'checking'>;
  reason: GoogleAccessReason | null;
  canRead: boolean;
  canPost: boolean;
  canEdit: boolean;
  /** Google's own error text, token-free, for support. */
  detail: string | null;
}

export interface GoogleAccessSignals {
  /** OAuth refresh returned invalid_grant (GBPToken.authStatus REVOKED). */
  authRevoked: boolean;
  /** Snapshot sections from the last sync (only for the CURRENT location). */
  location: Section<GbpLocationData> | null | undefined;
  verification: Section<GbpVerificationState> | null | undefined;
  /** Error from the Performance API metrics read this sync, if it failed. */
  metricsError?: SectionError | null;
}

const refused = (e: SectionError | null | undefined): 'no_permission' | 'location_gone' | null => {
  if (!e) return null;
  if (e.category === 'AUTHORIZATION') return 'no_permission';
  if (e.category === 'NOT_FOUND') return 'location_gone';
  return null;
};

/**
 * Google's answer → access verdict, or null when this sync proves nothing
 * (keep the previous state).
 */
export function evaluateGoogleAccess(s: GoogleAccessSignals): GoogleAccessVerdict | null {
  if (s.authRevoked) {
    return { state: 'blocked', reason: 'token_revoked', canRead: false, canPost: false, canEdit: false, detail: null };
  }

  const loc = s.location;
  if (loc?.meta.status === 'SUCCESS' && loc.data) {
    const v = s.verification?.meta.status === 'SUCCESS' ? s.verification.data : null;
    const md = loc.data.metadata;
    let reason: GoogleAccessReason | null = null;
    if (v?.complyWithGuidelines) reason = 'suspended';
    else if (v?.resolveOwnershipConflict) reason = 'ownership_conflict';
    else if (v?.verify?.hasPendingVerification || v?.waitForVoiceOfMerchant) reason = 'verification_pending';
    else if (v?.verify) reason = 'not_verified';
    else if (md.hasVoiceOfMerchant === false || v?.hasVoiceOfMerchant === false) reason = 'not_verified';
    else if (md.canOperateLocalPost === false) reason = 'cannot_post';

    if (reason) {
      return {
        state: 'limited',
        reason,
        canRead: true,
        canPost: reason === 'cannot_post' ? false : md.canOperateLocalPost === true,
        canEdit: false,
        detail: null,
      };
    }
    return {
      state: 'verified',
      reason: null,
      canRead: true,
      canPost: md.canOperateLocalPost !== false,
      canEdit: md.canModifyServiceList !== false,
      detail: null,
    };
  }

  // The location read failed, or never ran: only a refusal is conclusive.
  const blocked = (reason: 'no_permission' | 'location_gone', e: SectionError | null | undefined): GoogleAccessVerdict =>
    ({ state: 'blocked', reason, canRead: false, canPost: false, canEdit: false, detail: e?.message ?? null });
  if (loc?.meta.status === 'FAILED') {
    const byLocation = refused(loc.meta.error);
    return byLocation ? blocked(byLocation, loc.meta.error) : null; // temporary → keep the previous state
  }
  // No location result at all (the profile read never ran) — a refused metrics read is still Google saying no.
  const byMetrics = refused(s.metricsError);
  return byMetrics ? blocked(byMetrics, s.metricsError) : null;
}

/**
 * May background work run for this business?
 *   - gate off (GOOGLE_ACCESS_GATE_ENABLED=false) → only `googleConnected` counts (old behaviour)
 *   - no state yet → allowed: a business connected before the access check
 *     existed keeps working; its next sync records the real state
 *   - otherwise only `verified`
 */
export function googleAccessAllows(
  business: { googleConnected?: boolean | null; googleAccess?: { state?: string | null } | null } | null | undefined,
  gateEnabled = true,
): boolean {
  if (!business?.googleConnected) return false;
  if (!gateEnabled) return true;
  const state = business.googleAccess?.state;
  return !state || state === 'verified';
}

export const NOT_READY_STATES: GoogleAccessState[] = ['checking', 'limited', 'blocked'];

export interface GoogleAccessCopy {
  title: string;
  body: string;
  /** What the owner does in Google, in order. */
  steps: string[];
  /** Reconnect fixes it (as opposed to fixing something in Google first). */
  reconnect: boolean;
}

const PEOPLE_STEPS = [
  'Open business.google.com and sign in with the Google account that owns this business.',
  'Open your profile, then Menu → Business Profile settings → People and access.',
  'Make sure the Google account you connect to GrowwMatics is listed as Owner or Manager (add it if not).',
  'Come back here and press Reconnect, then choose that same Google account.',
];

/** Owner-facing wording for each state / reason (web, apps, notices). */
export function googleAccessCopy(state: GoogleAccessState | null | undefined, reason?: GoogleAccessReason | string | null): GoogleAccessCopy | null {
  if (state === 'checking') {
    return {
      title: 'Checking your Google access…',
      body: 'We are confirming that Google lets GrowwMatics manage your Business Profile. Your report, posts and reminders start as soon as this is confirmed — usually within a few minutes.',
      steps: [],
      reconnect: false,
    };
  }
  if (state !== 'limited' && state !== 'blocked') return null;
  switch (reason) {
    case 'token_revoked':
      return {
        title: 'Reconnect your Google Business Profile',
        body: 'Google no longer accepts GrowwMatics access to your Business Profile (access was removed or expired). Nothing is being posted or changed until you reconnect.',
        steps: ['Press Reconnect and sign in with the Google account that manages this business.'],
        reconnect: true,
      };
    case 'location_gone':
      return {
        title: 'Google can’t find this business profile',
        body: 'The connected Google account can no longer see this business location — it may have been removed, or moved to another account. Your report, posts and reminders are paused.',
        steps: ['Check the location still exists on business.google.com.', 'Press Reconnect and pick the right Google account and location.'],
        reconnect: true,
      };
    case 'suspended':
      return {
        title: 'Google has suspended this business profile',
        body: 'Google reports this profile must comply with its guidelines, so it can’t be managed right now. Your report, posts and reminders are paused until Google reinstates it.',
        steps: ['Open business.google.com and follow Google’s steps to request reinstatement.', 'When Google reinstates the profile, press Check again.'],
        reconnect: false,
      };
    case 'ownership_conflict':
      return {
        title: 'Someone else claims this business profile',
        body: 'Google reports an ownership conflict on this profile, so it can’t be managed until it is resolved. Your report, posts and reminders are paused.',
        steps: ['Open business.google.com and follow Google’s steps to request ownership.', 'When Google confirms you as owner, press Check again.'],
        reconnect: false,
      };
    case 'verification_pending':
      return {
        title: 'Your profile is waiting for Google verification',
        body: 'Google hasn’t finished verifying this profile, so it can’t be managed yet. Your report, posts and reminders start as soon as Google verifies it.',
        steps: ['Open business.google.com and complete any verification step Google shows (code, video, call).', 'Once verified, press Check again.'],
        reconnect: false,
      };
    case 'not_verified':
      return {
        title: 'Your Google profile isn’t verified for this account',
        body: 'Google says the connected account can’t manage this profile — it isn’t verified, or this account isn’t its Owner or Manager. Your report, posts and reminders are paused.',
        steps: ['Open business.google.com and verify the profile if Google asks you to.', ...PEOPLE_STEPS.slice(1)],
        reconnect: true,
      };
    case 'cannot_post':
      return {
        title: 'Google won’t let us post to this profile',
        body: 'Google allows reading this profile but not posting to it, so we can’t manage it fully. Your report, posts and reminders are paused.',
        steps: PEOPLE_STEPS,
        reconnect: true,
      };
    case 'no_permission':
    default:
      return {
        title: 'Google refused access to your profile',
        body: 'You signed in, but Google refused GrowwMatics access to this Business Profile. Usually the connected Google account isn’t an Owner or Manager of this profile, or the profile isn’t verified. Your report, posts and reminders are paused until this is fixed.',
        steps: PEOPLE_STEPS,
        reconnect: true,
      };
  }
}

const REASON_SHORT: Record<GoogleAccessReason, string> = {
  token_revoked: 'Reconnect needed — access removed or expired',
  no_permission: 'Google refused — account not Owner/Manager, or profile not verified',
  location_gone: 'Location removed or not visible to this account',
  suspended: 'Suspended by Google',
  ownership_conflict: 'Ownership conflict on Google',
  verification_pending: 'Waiting for Google verification',
  not_verified: 'Profile not verified for this account',
  cannot_post: 'Google does not allow posting',
};

export type GoogleAccessTone = 'ok' | 'checking' | 'problem' | 'none';

/**
 * One line for the super admin (businesses list, inbox customer panel) so the
 * sales / support team sees the same status the customer sees.
 * `lastSyncAt` covers workspaces connected before the access check existed.
 */
export function googleAccessAdminStatus(input: {
  googleConnected?: boolean | null;
  googleAccess?: { state?: string | null; reason?: string | null } | null;
  lastSyncAt?: Date | string | null;
}): { tone: GoogleAccessTone; label: string; reason: string | null } {
  if (!input.googleConnected) return { tone: 'none', label: 'Google not connected', reason: null };
  const state = input.googleAccess?.state;
  if (state === 'verified') return { tone: 'ok', label: 'Google verified', reason: null };
  if (state === 'limited' || state === 'blocked') {
    const reason = input.googleAccess?.reason as GoogleAccessReason | null | undefined;
    return { tone: 'problem', label: state === 'blocked' ? 'Google refused access' : 'Google access limited', reason: (reason && REASON_SHORT[reason]) || 'Google refused access' };
  }
  if (state === 'checking') return { tone: 'checking', label: 'Checking Google access', reason: 'Signed in — waiting for the first sync to confirm access' };
  return input.lastSyncAt
    ? { tone: 'ok', label: 'Google connected', reason: 'Not re-checked since the access check shipped — next sync confirms it' }
    : { tone: 'checking', label: 'Google not confirmed', reason: 'Signed in, but no Google sync has ever succeeded' };
}

/** Text the team can send the customer: what is wrong and how to fix it. */
export function googleAccessCustomerMessage(state: GoogleAccessState | null | undefined, reason?: string | null): string | null {
  const copy = googleAccessCopy(state, reason);
  if (!copy || state === 'checking') return null;
  return [copy.title + '.', copy.body, ...copy.steps.map((s, i) => `${i + 1}. ${s}`)].join('\n');
}
