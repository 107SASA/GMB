/**
 * Growth Partner CRM — stage rules, timeline privacy, and the guarantee that
 * no AI agent / drip / campaign ever messages a partner's lead.
 * Run: node --experimental-strip-types --test tests/integration/growth-partner-crm.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PARTNER_STAGES,
  partnerCanSeeEvent,
  partnerEventView,
  partnerFollowUpTenant,
  partnerStageCheck,
} from '../../src/lib/partners/partnerCrmRules.ts';
import { campaignSkipReason } from '../../src/lib/whatsappCampaign.ts';
import {
  isHumanOwned,
  isOptedOutOrDoNotContact,
  salesReplyBlockedReason,
} from '../../src/services/agentHandoff/isHumanOwned.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// What createPartnerLead / importPartnerLeads write on every partner lead.
const PARTNER_LEAD = { phone: '+919876543210', currentAgent: 'HUMAN', nurtureStatus: 'STOPPED', currentStage: 'NEW', humanHandoff: undefined } as any;

test('stages: partners can never set Payment verified / Customer / With a human', () => {
  const values = PARTNER_STAGES.map((s) => s.value);
  for (const v of ['PAYMENT_VERIFIED', 'CUSTOMER', 'HUMAN_HANDOFF']) assert.ok(!values.includes(v as any), v);
  for (const v of ['NEW', 'QUALIFYING', 'DEMO_SCHEDULED', 'CONVERSION_PENDING', 'LOST', 'DO_NOT_CONTACT']) assert.ok(values.includes(v as any), v);
  const c = partnerStageCheck('NEW', 'CUSTOMER');
  assert.ok(!c.ok && /automatically/.test(c.error));
  assert.equal(partnerStageCheck('NEW', 'PAYMENT_VERIFIED').ok, false);
  assert.equal(partnerStageCheck('NEW', 'nonsense').ok, false);
  assert.ok(partnerStageCheck('NEW', 'QUALIFYING').ok);
});

test('stages: a customer is locked for the partner', () => {
  const r = partnerStageCheck('CUSTOMER', 'LOST');
  assert.ok(!r.ok && /already a customer/.test(r.error));
});

test('timeline: milestones for everyone, notes/edits only when the partner made them', () => {
  const me = 'u1';
  assert.ok(partnerCanSeeEvent({ type: 'STAGE_CHANGED', actor: 'admin9' }, me));
  assert.ok(partnerCanSeeEvent({ type: 'PAYMENT_SUCCESS', actor: 'system' }, me));
  assert.ok(partnerCanSeeEvent({ type: 'NOTE_ADDED', actor: 'u1' }, me));
  assert.equal(partnerCanSeeEvent({ type: 'NOTE_ADDED', actor: 'admin9' }, me), false, 'our team’s notes stay private');
  assert.equal(partnerCanSeeEvent({ type: 'AGENT_HANDOFF', actor: 'system' }, me), false);
  assert.equal(partnerCanSeeEvent({ type: 'WHATSAPP_INBOUND', actor: 'system' } as any, me), false);
  const v = partnerEventView({ type: 'PAYMENT_SUCCESS', payload: { amount: 4999, paymentId: 'pay_x' }, actor: 'system' }, me);
  assert.equal(v.text, 'Payment received');
  assert.ok(!JSON.stringify(v).includes('pay_x'), 'no internal payload fields leak');
  assert.equal(partnerEventView({ type: 'STAGE_CHANGED', payload: { from: 'NEW', to: 'QUALIFYING' } }, me).text, 'Stage: New → Qualifying');
});

test('follow-ups live in their own tenant, never the team’s', () => {
  assert.equal(partnerFollowUpTenant('abc'), 'partner:abc');
  assert.notEqual(partnerFollowUpTenant('abc'), 'gmbboost-internal');
});

// ── No automated messaging, ever ─────────────────────────────────────────

test('a partner lead trips every shared AI stop check', () => {
  assert.equal(isHumanOwned(PARTNER_LEAD), true, 'live agents (sales, booking, support, report) stand down');
  assert.equal(isOptedOutOrDoNotContact(PARTNER_LEAD), true, 'drips, follow-up crons and NBA stand down');
  assert.notEqual(salesReplyBlockedReason(PARTNER_LEAD), null, 'the sales agent never replies');
  assert.equal(campaignSkipReason(PARTNER_LEAD), 'opted-out', 'bulk WhatsApp campaigns skip it');
});

test('partner leads are always created HUMAN-owned with nurture stopped', () => {
  const src = read('src/services/partners/partnerLeads.ts');
  const defaults = src.slice(src.indexOf('const PARTNER_LEAD_DEFAULTS'), src.indexOf('} as const;'));
  assert.match(defaults, /currentAgent: 'HUMAN'/);
  assert.match(defaults, /nurtureStatus: 'STOPPED'/);
  // Both creation paths spread the defaults.
  assert.equal((src.match(/\.\.\.PARTNER_LEAD_DEFAULTS/g) || []).length, 2);
});

test('setLeadOwnership never hands a partner lead to an AI agent', () => {
  const src = read('src/services/leadOwnership/setLeadOwnership.ts');
  assert.match(src, /partnerId && newAgent !== 'HUMAN' && newAgent !== 'IN_HOUSE'[\s\S]{0,80}newAgent = 'HUMAN'/);
});

test('the team can’t switch nurture back on, or return a partner lead to the AI', () => {
  assert.match(read('src/services/admin/platformCrm.ts'), /'nurtureStatus' in patch\) \{\s*if \(lead\.partnerId\) return/);
  assert.match(read('src/app/api/admin/leads/return-to-ai/route.ts'), /if \(lead\.partnerId\)[\s\S]{0,200}status: 409/);
});

test('every partner lead query is scoped to the session partner', () => {
  const src = read('src/services/partners/partnerLeads.ts');
  assert.match(src, /const scope = \(partnerId: string\) => \(\{ tenantId: PLATFORM_TENANT, partnerId:/);
  // Each partner API route resolves the partner from the session.
  for (const f of [
    'src/app/api/partner/leads/route.ts',
    'src/app/api/partner/leads/[id]/route.ts',
    'src/app/api/partner/leads/[id]/notes/route.ts',
    'src/app/api/partner/leads/[id]/follow-ups/route.ts',
    'src/app/api/partner/leads/import/route.ts',
    'src/app/api/partner/leads/export/route.ts',
    'src/app/api/partner/follow-ups/route.ts',
    'src/app/api/partner/follow-ups/[id]/route.ts',
    'src/app/api/partner/stats/route.ts',
  ]) {
    const r = read(f);
    assert.match(r, /requireGrowthPartner\(\)/, f);
    assert.match(r, /String\(auth\.partner\._id\)|auth\.partner,/, `${f} uses the session partner`);
    assert.doesNotMatch(r, /body\.partnerId|partnerId: body/, `${f} never trusts a partnerId from the request`);
  }
});

test('the partner area has no WhatsApp / messaging features', () => {
  const dirs = ['src/app/partner', 'src/components/partner', 'src/app/api/partner'];
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  };
  dirs.forEach(walk);
  for (const f of files) {
    assert.doesNotMatch(read(f), /sendOutboundMessage|sendWhatsApp|whatsapp-templates|\/api\/admin\/crm\/whatsapp/i, f);
  }
});
