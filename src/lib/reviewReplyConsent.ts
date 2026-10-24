/**
 * Review-reply mode rules — pure, no imports, so the integration tests can run
 * them under plain Node.
 *
 * Auto-reply is the DEFAULT (owner's product decision, Oct 23 2026): new
 * businesses start in 'auto', and existing ones were moved to 'auto' by
 * scripts/migrate-review-reply-auto.ts. In 'auto', fact-checked drafts are
 * posted to Google without waiting; drafts that fail the check wait for the
 * owner. The owner can switch to 'manual' (approve every reply) from Review
 * Management on the web or Review settings in the app.
 *
 * autoPublishConsentAt + autoPublishConsentBy are an audit of the owner
 * switching auto on themselves; they are not required for auto to run.
 */

export interface ReplySettingsLike {
  mode?: string;
  autoPublishConsentAt?: Date | string | null;
  autoPublishConsentBy?: string | null;
}

export function isAutoPublishActive(settings?: ReplySettingsLike | null): boolean {
  return settings?.mode === 'auto';
}

/**
 * Reply settings for a business at creation: auto-reply on (fact-checked
 * replies post automatically). Applied at each Business.create(), matching
 * the schema default.
 */
export function newBusinessReviewReplySettings() {
  return { mode: 'auto' as const, tone: 'Professional' };
}

/**
 * The Business update for the owner saving the reply mode. Turning auto on
 * records who switched it on (now + their user id) unless auto is already
 * active; turning it off clears that record. Throws without a real owner id,
 * so the record never names anyone but the owner.
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
  if (!owner || owner.startsWith('default:')) throw new Error('auto-reply opt-in needs the owner\'s user id');
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
