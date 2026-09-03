/**
 * Tests for the Sales Agent business-knowledge layer.
 *
 * Covers the pure/deterministic surface (no DB, no Groq):
 *   - the extended SalesKnowledge structure is backward compatible
 *   - normaliseUseCases handles both legacy string[] and structured entries
 *   - summariseKnowledge is token-bounded, only surfaces configured fields,
 *     and states the pricing-safety rule correctly (approved vs. none)
 *   - DEFAULT_SALES_KNOWLEDGE is grounded (non-empty) but NEVER ships a price
 *     or a per-objection rebuttal
 *   - the NBA rule table still routes an explicit demo request to the demo
 *     path and explicit purchase intent to the subscription/pricing path
 *     (i.e. the knowledge changes didn't regress routing)
 *   - the deterministic explicit-human-request rule is unchanged
 *
 * The behavioural items (a known FAQ gets a grounded answer, an unknown one
 * gets the safe fallback, pricing is never invented, demo request reaches the
 * Demo Agent, purchase intent converts) are additionally exercised end to end
 * by scripts/lead-engine-e2e.mjs tests A/B/C.
 *
 * Run with: node --test tests/integration/sales-knowledge.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SALES_KNOWLEDGE,
  defaultSalesAgentConfig,
  normaliseUseCases,
  summariseKnowledge,
  useCaseLine,
  type SalesKnowledge,
} from '../../src/lib/salesAgentDefaults.ts';
import {
  findMatchingRules,
  explicitHumanRequestAction,
  type NBARuleInput,
} from '../../src/services/nba/rules.ts';

// --- 1. Backward compatibility -------------------------------------------------

test('the original five knowledge fields keep their shape', () => {
  const k: SalesKnowledge = {
    pricingResponse: '₹X per month',
    objectionResponses: { PRICE: 'worth it because…' },
    useCases: ['a plain string use case'],
    faqs: [{ q: 'q', a: 'a' }],
    educationPoints: ['a point'],
  };
  // No throw, all readable as before.
  assert.equal(k.pricingResponse, '₹X per month');
  assert.equal(k.objectionResponses?.PRICE, 'worth it because…');
  assert.equal(k.faqs?.[0]?.a, 'a');
});

test('a config with an empty knowledge block still loads', () => {
  const cfg = defaultSalesAgentConfig();
  assert.ok(cfg.knowledge, 'knowledge is always an object');
  // The default is grounded, but merging an empty override must not break.
  const merged: SalesKnowledge = { ...cfg.knowledge, ...{} };
  assert.ok(typeof merged === 'object');
});

// --- 2. normaliseUseCases ----------------------------------------------------

test('normaliseUseCases: legacy strings become { solution }', () => {
  const out = normaliseUseCases(['leads go cold', '  ', 'profile invisible']);
  assert.deepEqual(out, [{ solution: 'leads go cold' }, { solution: 'profile invisible' }]);
});

test('normaliseUseCases: structured entries are trimmed and empty ones dropped', () => {
  const out = normaliseUseCases([
    { name: '  Follow-up  ', problem: 'slow replies', solution: '', benefit: '  ' },
    {},
    'legacy',
  ]);
  assert.deepEqual(out, [
    { name: 'Follow-up', problem: 'slow replies' },
    { solution: 'legacy' },
  ]);
});

test('normaliseUseCases: non-array input is safe', () => {
  assert.deepEqual(normaliseUseCases(undefined), []);
  assert.deepEqual(normaliseUseCases(null as any), []);
});

test('useCaseLine renders a compact one-liner', () => {
  const line = useCaseLine({ name: 'X', problem: 'p', solution: 's', benefit: 'b' });
  assert.match(line, /^X: problem — p solution — s benefit — b$/);
});

// --- 3. summariseKnowledge -------------------------------------------------

test('summariseKnowledge returns "" for empty / undefined knowledge', () => {
  assert.equal(summariseKnowledge(undefined), '');
  assert.equal(summariseKnowledge({}), 'Pricing: NO approved price is configured — never state a price; say you will confirm exact pricing.');
});

test('summariseKnowledge: with NO approved price, it explicitly forbids stating one', () => {
  const s = summariseKnowledge({ businessOverview: 'GrowwMatics does X.' });
  assert.match(s, /What GrowwMatics is: GrowwMatics does X\./);
  assert.match(s, /NO approved price is configured — never state a price/);
});

test('summariseKnowledge: with an approved price, it says to send it verbatim (not paraphrase)', () => {
  const s = summariseKnowledge({ pricingResponse: '₹1999 / month, all features' });
  assert.match(s, /an approved pricing statement IS configured/);
  assert.doesNotMatch(s, /1999/, 'the actual number is NOT leaked into the summary — the executor sends it verbatim');
});

test('summariseKnowledge is token-bounded: long lists are capped', () => {
  const many = Array.from({ length: 50 }, (_, i) => `problem number ${i}`);
  const s = summariseKnowledge({ customerProblems: many }, { maxItems: 4 });
  const line = s.split('\n').find((l) => l.startsWith('Problems it solves:')) || '';
  const count = line.split('|').length;
  assert.ok(count <= 4, `expected <= 4 problems, got ${count}`);
});

test('summariseKnowledge only surfaces configured fields', () => {
  const s = summariseKnowledge({ demoExplanation: 'a demo is a live walkthrough' });
  assert.match(s, /Demo: a demo is a live walkthrough/);
  assert.doesNotMatch(s, /Ideal customer:/);
  assert.doesNotMatch(s, /Serves:/);
});

test('summariseKnowledge includes FAQs only when asked', () => {
  const k: SalesKnowledge = { faqs: [{ q: 'Do you run ads?', a: 'No.' }] };
  assert.doesNotMatch(summariseKnowledge(k), /Do you run ads/);
  assert.match(summariseKnowledge(k, { includeFaqs: true }), /Do you run ads/);
});

// --- 4. DEFAULT_SALES_KNOWLEDGE is grounded but safe ------------------------

test('DEFAULT_SALES_KNOWLEDGE has real business grounding', () => {
  const k = DEFAULT_SALES_KNOWLEDGE;
  assert.ok((k.businessOverview || '').length > 80, 'has a real overview');
  assert.ok((k.idealCustomerProfile || '').length > 80, 'has a real ICP');
  assert.ok((k.customerProblems || []).length >= 5, 'lists customer problems');
  assert.ok((k.services || []).length >= 3, 'lists services');
  assert.ok(normaliseUseCases(k.useCases).length >= 3, 'has structured use cases');
  assert.ok((k.faqs || []).length >= 4, 'seeded from ALL_FAQS');
  assert.ok((k.limitations || []).length >= 3, 'states honest limitations');
});

test('DEFAULT_SALES_KNOWLEDGE ships NO price and NO objection rebuttals', () => {
  assert.equal(DEFAULT_SALES_KNOWLEDGE.pricingResponse, '', 'pricingResponse must be empty by default');
  assert.deepEqual(
    DEFAULT_SALES_KNOWLEDGE.objectionResponses,
    {},
    'objectionResponses must be empty by default — no approved scripts exist'
  );
});

test('DEFAULT_SALES_KNOWLEDGE never claims paid-ads management', () => {
  const blob = JSON.stringify(DEFAULT_SALES_KNOWLEDGE).toLowerCase();
  // It should be mentioned only as something GrowwMatics does NOT do.
  assert.match(blob, /does not run.{0,20}ads|not paid-ads|no paid-ads|does not.{0,20}paid/);
});

test('defaultSalesAgentConfig() carries the grounded knowledge', () => {
  const cfg = defaultSalesAgentConfig('https://app/billing', 'https://app/pricing');
  assert.ok((cfg.knowledge.businessOverview || '').includes('GrowwMatics'));
  assert.equal(cfg.knowledge.pricingResponse, '');
});

// --- 5. Routing is NOT regressed by the knowledge changes -----------------

const base: NBARuleInput = {
  currentStage: 'NURTURING',
  intent: 'DEMO_INTEREST',
  scoreBand: 'WARM',
  hasOpenObjection: false,
  currentAgent: 'SALES',
  nurtureStatus: 'ACTIVE',
};

test('explicit demo interest still routes to the demo path (OFFER_DEMO / SCHEDULE_DEMO)', () => {
  const rules = findMatchingRules(base);
  const legal = new Set(rules.flatMap((r) => r.legalActions));
  assert.ok(legal.has('OFFER_DEMO') || legal.has('SCHEDULE_DEMO'));
  const demoRule = rules.find((r) => r.name.includes('demo interest'));
  assert.equal(demoRule?.defaultAction, 'OFFER_DEMO');
});

test('explicit purchase intent still routes to subscription / pricing', () => {
  const rules = findMatchingRules({ ...base, intent: 'READY_TO_BUY' });
  const purchaseRule = rules.find((r) => r.name.includes('purchase intent'));
  assert.ok(purchaseRule, 'purchase-intent override row still matches');
  assert.equal(purchaseRule?.defaultAction, 'OFFER_SUBSCRIPTION');
  assert.ok(purchaseRule?.legalActions.includes('SEND_PRICING'));
});

test('the explicit-human-request hard rule is unchanged', () => {
  assert.equal(
    explicitHumanRequestAction(
      { currentAgent: 'SALES', nurtureStatus: 'ACTIVE', currentStage: 'NURTURING' },
      'can I talk to a real person please'
    ),
    'HUMAN_HANDOFF'
  );
  // A human already owns it → no re-handoff.
  assert.equal(
    explicitHumanRequestAction(
      { currentAgent: 'HUMAN', nurtureStatus: 'ACTIVE', currentStage: 'HUMAN_HANDOFF' },
      'talk to a person'
    ),
    null
  );
});
