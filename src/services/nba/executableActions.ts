import type { NBAAction } from './rules';

/**
 * Which NBA actions the executor (executeNextAction.ts) carries out
 * end-to-end today — a message send, a handoff, or an explicit no-op like
 * WAIT/STOP. Anything NOT in this set is still computed and stored by
 * decideNextAction but executed as a logged no-op (outcome 'deferred') —
 * never faked as done.
 *
 * Kept in its own dependency-free file so it can be unit-tested with
 * `node --test` (the executor itself imports the whole app and can't be
 * loaded that way).
 *
 * SCHEDULE_DEMO is listed because the executor maps it to the OFFER_DEMO
 * "confirm you want a demo" nudge — the real booking stays in the
 * deterministic BookingConversation flow, never triggered unilaterally.
 */
export const EXECUTABLE_NBA_ACTIONS: readonly NBAAction[] = [
  'ASK_QUALIFICATION',
  'EDUCATE',
  'SHARE_USE_CASE',
  'ANSWER_QUESTION',
  'HANDLE_OBJECTION',
  'SHOW_VALUE',
  'SEND_PRICING',
  'OFFER_DEMO',
  'SCHEDULE_DEMO',
  'OFFER_SUBSCRIPTION',
  'FOLLOW_UP_AFTER_DEMO',
  'REENGAGE',
  'HUMAN_HANDOFF',
  'WAIT',
  'STOP',
];

/** True if executeNextAction has a real handler for this action (not a deferred no-op). */
export function isExecutableNbaAction(action: NBAAction): boolean {
  return EXECUTABLE_NBA_ACTIONS.includes(action);
}
