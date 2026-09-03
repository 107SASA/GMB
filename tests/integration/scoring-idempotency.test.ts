/**
 * Regression tests for behavioral-signature scoring idempotency
 * (src/services/leadIntelligence/scoringIdempotency.ts).
 *
 * Context — the bug these lock down:
 *   A LEAD_ENGINE_V2 trace showed the SAME lead receiving signal
 *   DEMO_REQUESTED repeatedly, with leadScore climbing 35 -> 55 -> 75 -> 95
 *   (+20 each). applyExtraction() applied the ScoringRuleConfig delta every
 *   time it ran for a message, with no memory of "already scored this
 *   signal for this message" — so an Inngest retry of the reply step, a
 *   scheduler re-tick, or a scripted re-send each re-awarded the points.
 *   Only REPLIED had a guard (once/day).
 *
 * These test the pure primitives applyExtraction now uses. The full
 * applyExtraction path needs a DB + Groq and is covered by the manual
 * WhatsApp test flow; the invariant that matters is proved here.
 *
 * Pure functions, no DB, no `@/` aliases.
 * Run with: node --test tests/integration/scoring-idempotency.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alreadyScored,
  behavioralSignature,
  normalizeMessageForSignature,
  withScoredSignature,
  SCORED_SIGNAL_KEYS_CAP,
} from '../../src/services/leadIntelligence/scoringIdempotency.ts';
import Lead from '../../src/models/Lead.ts';

test('Lead schema has the scoredSignalKeys array applyExtraction writes', () => {
  const path = Lead.schema.path('scoredSignalKeys') as any;
  assert.ok(path, 'Lead.scoredSignalKeys must exist');
  assert.equal(path.instance, 'Array');
});

/**
 * Faithful re-implementation of the score-apply decision in applyExtraction
 * (extract.ts) — enough to prove the idempotency behaviour without a DB.
 * Returns the new score and the new scoredSignalKeys.
 */
function applyScore(
  lead: { leadScore: number; scoredSignalKeys: string[] },
  signal: string,
  messageText: string,
  delta: number,
): { leadScore: number; scoredSignalKeys: string[]; awarded: boolean } {
  const signature = behavioralSignature(signal, messageText);
  if (!signature || alreadyScored(lead.scoredSignalKeys, signature)) {
    return { ...lead, awarded: false };
  }
  const next = Math.min(100, Math.max(0, lead.leadScore + delta));
  return {
    leadScore: next,
    scoredSignalKeys: withScoredSignature(lead.scoredSignalKeys, signature),
    awarded: next !== lead.leadScore,
  };
}

// --- C. same signal + same message processed N times -> scored ONCE -------
test('C: the same DEMO_REQUESTED signal for the same message scores only once', () => {
  let lead = { leadScore: 35, scoredSignalKeys: [] as string[] };
  const msg = 'yes I would love a demo, can we set one up?';

  for (let i = 0; i < 5; i++) {
    lead = applyScore(lead, 'DEMO_REQUESTED', msg, 20);
  }

  assert.equal(lead.leadScore, 55, 'score moved 35 -> 55 exactly once, not 35 -> 135/clamped-100');
  assert.equal(lead.scoredSignalKeys.length, 1);
});

// --- D. scheduler re-runs / proactive re-ticks over unchanged state ------
test('D: re-processing an unchanged lead+message never re-awards points', () => {
  let lead = { leadScore: 0, scoredSignalKeys: [] as string[] };
  lead = applyScore(lead, 'PRICING_QUESTION', 'how much per month?', 15);
  assert.equal(lead.leadScore, 15);

  // Simulate 20 proactive ticks / retries that re-evaluate the same state.
  for (let i = 0; i < 20; i++) {
    lead = applyScore(lead, 'PRICING_QUESTION', 'how much per month?', 15);
  }
  assert.equal(lead.leadScore, 15, 'still 15 — unchanged state cannot inflate the score');
});

// --- E. a genuinely NEW qualifying signal still increases the score ------
test('E: a new message / new signal still scores normally', () => {
  let lead = { leadScore: 15, scoredSignalKeys: [] as string[] };

  // Same signal, DIFFERENT message -> different signature -> scores.
  lead = applyScore(lead, 'PRICING_QUESTION', 'and what about the annual plan price?', 15);
  assert.equal(lead.leadScore, 30);

  // DIFFERENT signal on a new message -> scores.
  lead = applyScore(lead, 'DEMO_REQUESTED', 'ok let us do a demo', 20);
  assert.equal(lead.leadScore, 50);

  // A real conversion signal -> scores.
  lead = applyScore(lead, 'PURCHASE_INTENT', 'how do I sign up and pay', 25);
  assert.equal(lead.leadScore, 75);

  // ...but repeating that exact purchase-intent message does not.
  lead = applyScore(lead, 'PURCHASE_INTENT', 'how do I sign up and pay', 25);
  assert.equal(lead.leadScore, 75);
});

// --- bounds + normalization ---------------------------------------------
test('leadScore stays clamped 0-100 across many distinct signals', () => {
  let lead = { leadScore: 0, scoredSignalKeys: [] as string[] };
  for (let i = 0; i < 30; i++) {
    lead = applyScore(lead, 'DEMO_REQUESTED', `distinct demo ask number ${i}`, 20);
  }
  assert.equal(lead.leadScore, 100);
});

test('a negative signal (EXPLICIT_REJECTION) is also deduped and cannot re-subtract', () => {
  let lead = { leadScore: 60, scoredSignalKeys: [] as string[] };
  lead = applyScore(lead, 'EXPLICIT_REJECTION', 'not interested, remove me', -30);
  assert.equal(lead.leadScore, 30);
  lead = applyScore(lead, 'EXPLICIT_REJECTION', 'not interested, remove me', -30);
  assert.equal(lead.leadScore, 30, 'the same rejection message cannot drive the score down twice');
});

test('normalizeMessageForSignature ignores whitespace / case / punctuation but not content', () => {
  assert.equal(
    normalizeMessageForSignature('  Talk to a PERSON!! '),
    normalizeMessageForSignature('talk to a person'),
  );
  assert.notEqual(
    normalizeMessageForSignature('talk to a person'),
    normalizeMessageForSignature('talk to a manager'),
  );
});

test('behavioralSignature is null for NONE / empty signal (nothing to score)', () => {
  assert.equal(behavioralSignature('NONE', 'anything'), null);
  assert.equal(behavioralSignature(undefined, 'anything'), null);
  assert.equal(behavioralSignature('', 'anything'), null);
});

test('withScoredSignature caps the list to the most recent entries', () => {
  let keys: string[] = [];
  for (let i = 0; i < SCORED_SIGNAL_KEYS_CAP + 25; i++) {
    keys = withScoredSignature(keys, `SIG:${i}`);
  }
  assert.equal(keys.length, SCORED_SIGNAL_KEYS_CAP);
  assert.equal(keys[keys.length - 1], `SIG:${SCORED_SIGNAL_KEYS_CAP + 24}`);
  assert.ok(!keys.includes('SIG:0'), 'oldest entries are evicted');
});
