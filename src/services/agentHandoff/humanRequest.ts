/**
 * Deterministic "the user is explicitly asking for a human" detector.
 *
 * Kept in its own dependency-free module (no mongoose, no models, no `@/`
 * runtime imports) so BOTH:
 *   - services/agentHandoff/checkHandoffTriggers.ts (the primary handoff
 *     path, runs before any LLM work), and
 *   - services/nba/rules.ts / decideNextAction.ts (the NBA hard rule that
 *     stops an explicit human ask from being overridden to a sales action)
 * can share exactly one definition, and so it can be unit-tested under
 * `node --test` without loading the app.
 *
 * The business requirement: an explicit ask for a human — "talk to a
 * person", "human", "representative", "agent", "someone from your team",
 * "connect me with support", "stop the bot", etc — must ALWAYS route to a
 * human and take precedence over any normal sales action. This is
 * intentionally broad on the phrasings it accepts while still guarding
 * against the common false-positive collocations ("insurance agent", "your
 * AI agent is great", "real estate agent").
 */

const PERSON_NOUN =
  '(?:human|person|representative|rep|agent|advisor|consultant|operator|someone|somebody|a real (?:human|person)|real (?:human|person))';
const REACH_VERB =
  '(?:talk|speak|chat|connect|transfer|escalate|hand(?:ed)? ?off|route|put me through|get|reach|want|need|would like|wanna)';
const TEAM_NOUN =
  '(?:your |the |a )?(?:team|staff|support team|sales team|support|customer (?:service|support)|help ?desk)';

// "can I talk to a person", "speak with someone", "connect me to a representative",
// "transfer me to an agent", "get me a human", "I want to chat with your team",
// "I want a human", "I need to speak to someone"
const HUMAN_CONTACT_VERB_RE = new RegExp(
  `\\b${REACH_VERB}\\b(?:\\s+(?:to|with|me|a|an|the|your|some|speak|talk|chat)\\b){0,5}?\\s+(?:a |an |the |your |some )?(?:${PERSON_NOUN}|${TEAM_NOUN})\\b`,
  'i',
);

// "someone from your team", "a person from support", "somebody on the sales team"
const PERSON_FROM_TEAM_RE = new RegExp(
  `\\b(?:${PERSON_NOUN})\\s+(?:from|on|in|at)\\s+(?:${TEAM_NOUN})\\b`,
  'i',
);

// The whole (short) message is basically just the noun: "human", "a human please",
// "real person!!", "representative?", "agent pls"
const BARE_HUMAN_NOUN_RE = new RegExp(
  `^\\s*(?:a |an |the )?(?:${PERSON_NOUN})(?:\\s*(?:please|pls|plz|now|asap|thanks|thx))?\\s*[.!?]*\\s*$`,
  'i',
);

// "I don't want a bot", "stop the bot", "no bot", "not a bot"
const NO_BOT_RE =
  /\b(?:no|not|stop|don'?t want|hate)\s+(?:the\s+|a\s+|this\s+)?(?:bot|robot|chatbot)\b/i;

// Collocations where the person-noun is clearly NOT a request for OUR human.
const FALSE_POSITIVE_RE =
  /\b(?:insurance|real ?estate|realtor|travel|booking|estate|ai|a\.i\.|virtual|literary|talent|free|secret|double)\s+agent\b|\bagent\s+(?:smith|orange|provocateur)\b/i;

export function isExplicitHumanRequest(text: string | null | undefined): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  if (FALSE_POSITIVE_RE.test(trimmed) && !BARE_HUMAN_NOUN_RE.test(trimmed)) {
    // A false-positive collocation is present AND the message isn't itself a
    // bare "human"/"agent" ask — treat it as not a handoff request.
    return false;
  }
  return (
    HUMAN_CONTACT_VERB_RE.test(trimmed) ||
    PERSON_FROM_TEAM_RE.test(trimmed) ||
    BARE_HUMAN_NOUN_RE.test(trimmed) ||
    NO_BOT_RE.test(trimmed)
  );
}
