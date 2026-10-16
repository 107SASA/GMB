/**
 * Review-reply auto-publish consent — pure rules, no imports, so the
 * integration tests can run them under plain Node.
 *
 * Automatic publishing to Google needs the OWNER's explicit opt-in, recorded
 * by the reply-settings route as autoPublishConsentAt + autoPublishConsentBy
 * (the owner's user id). New businesses start in manual mode with no consent.
 */

/**
 * autoPublishConsentBy written by the Oct 2026 new-business default (auto-reply
 * on at creation). That was never the owner's consent: settings carrying it
 * stay drafts-only until the owner switches auto-reply on themselves. Kept so
 * those documents can still be recognised — never write it.
 */
export const DEFAULT_AUTO_REPLY_CONSENT_BY = 'default:new-business';

export interface ReplySettingsLike {
  mode?: string;
  autoPublishConsentAt?: Date | string | null;
  autoPublishConsentBy?: string | null;
}

export function isAutoPublishActive(settings?: ReplySettingsLike | null): boolean {
  return (
    settings?.mode === 'auto' &&
    !!settings?.autoPublishConsentAt &&
    settings?.autoPublishConsentBy !== DEFAULT_AUTO_REPLY_CONSENT_BY
  );
}

/**
 * Reply settings for a business at creation: manual (the owner approves every
 * reply), no consent recorded. Applied at each Business.create(), matching the
 * schema default.
 */
export function newBusinessReviewReplySettings() {
  return { mode: 'manual' as const, tone: 'Professional' };
}

/**
 * The Business update for the owner saving the reply mode. Turning auto on
 * records the owner's own consent (now + their user id) unless their consent
 * is already active; turning it off clears consent. Throws without a real
 * owner id, so consent can never be recorded on someone's behalf.
 */
export function replyModeUpdate(input: { mode: 'manual' | 'auto'; tone?: string; wasAuto: boolean; ownerUserId: string; now?: Date }) {
  const tone = input.tone ? { 'reviewReplySettings.tone': input.tone } : {};
  if (input.mode !== 'auto') {
    return {
      $set: { 'reviewReplySettings.mode': 'manual', ...tone },
      $unset: { 'reviewReplySettings.autoPublishConsentAt': 1, 'reviewReplySettings.autoPublishConsentBy': 1 },
    };
  }
  const owner = String(input.ownerUserId ?? '').trim();
  if (!owner || owner.startsWith('default:')) throw new Error('auto-publish consent needs the owner\'s user id');
  return {
    $set: {
      'reviewReplySettings.mode': 'auto',
      ...(input.wasAuto
        ? {}
        : { 'reviewReplySettings.autoPublishConsentAt': input.now ?? new Date(), 'reviewReplySettings.autoPublishConsentBy': owner }),
      ...tone,
    },
  };
}
