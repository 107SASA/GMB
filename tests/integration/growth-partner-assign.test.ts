/**
 * Super admin "assign to partner" — for a lead we entered ourselves, or a
 * customer who paid from a different number, so the partner never misses
 * commission.
 * Run: node --experimental-strip-types --test tests/integration/growth-partner-assign.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isPartnerManagedLead, CREDIT_ONLY_SOURCES } from '../../src/lib/partners/referral.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('credit-only leads keep our funnel; handed-over leads are partner-managed', () => {
  assert.deepEqual([...CREDIT_ONLY_SOURCES], ['referral', 'credit']);
  assert.equal(isPartnerManagedLead({ partnerId: 'p', partnerSource: 'credit' }), false);
  assert.equal(isPartnerManagedLead({ partnerId: 'p', partnerSource: 'added' }), true);
  assert.equal(isPartnerManagedLead({ partnerId: 'p', partnerSource: null }), true, 'unknown stays AI-off');
});

test('a workspace our team linked wins over any automatic match', () => {
  const src = read('src/services/partners/partnerCommissions.ts');
  const fn = src.slice(src.indexOf('export async function resolvePartnerForBusiness'), src.indexOf('/** Creates the commission for one company invoice'));
  const admin = fn.indexOf('business.partnerId && business.partnerAssignedBy');
  const lead = fn.indexOf('if (lead?.partnerId)');
  const referral = fn.indexOf('if (business.partnerId) {');
  assert.ok(admin > 0 && lead > admin && referral > lead, 'order: team link → lead partner → referral sign-up');
});

test('lead assignment: credit vs handed over; customers only get credit', () => {
  const src = read('src/services/partners/partnerAssign.ts');
  assert.match(src, /partnerSource: mode === 'managed' \? 'added' : 'credit'/);
  assert.match(src, /mode === 'managed' && lead\.currentStage === 'CUSTOMER'\) \{\s*return fail\(400/);
  // Handing over turns the AI off the same way a partner-added lead is.
  const managed = src.slice(src.indexOf("if (mode === 'managed') {"), src.indexOf("await logLeadEvent('LEAD_UPDATED', { fields: ['partner'], by: 'team', partnerId"));
  assert.match(managed, /setLeadOwnership\(lead\._id, 'HUMAN'/);
  assert.match(managed, /nurtureStatus: 'STOPPED'/);
  assert.match(managed, /cancelScheduledActions/);
});

test('past payments: credited oldest first, never twice, never moved from another partner', () => {
  const src = read('src/services/partners/partnerAssign.ts');
  const fn = src.slice(src.indexOf('async function creditPastPayments'), src.indexOf('/** Workspaces that belong to the person on this lead'));
  assert.match(fn, /sort\(\{ paidAt: 1 \}\)/);
  assert.match(fn, /createCommissionForInvoice\(/, 'goes through the one idempotent commission path');
  assert.doesNotMatch(src, /PartnerCommission\.(updateOne|updateMany|deleteOne|deleteMany)/, 'never rewrites existing commissions');
  // The workspace link only credits payments when the admin ticks it.
  assert.match(src, /input\.creditPast === true \? await creditPastPayments\(\[businessId\]\)/);
});

test('only super admins can assign; only active partners can be chosen', () => {
  for (const f of [
    'src/app/api/admin/crm/leads/[id]/partner/route.ts',
    'src/app/api/admin/growth-partners/workspaces/route.ts',
    'src/app/api/admin/growth-partners/workspaces/[businessId]/partner/route.ts',
  ]) assert.match(read(f), /requireSuperAdmin\(\)/, f);
  assert.match(read('src/services/partners/partnerAssign.ts'), /status: \{ \$ne: 'suspended' \}/);
  assert.match(read('src/services/partners/partnerAssign.ts'), /action|logAction\(adminId, 'partner\.(lead_assign|workspace_link)'/);
});

test('partners see team-linked leads as credited but read-only', () => {
  const src = read('src/services/partners/partnerLeads.ts');
  assert.match(src, /viaReferral: \(CREDIT_ONLY_SOURCES as readonly string\[\]\)\.includes/);
  const update = src.slice(src.indexOf('export async function updatePartnerLead'), src.indexOf('export async function addPartnerNote'));
  assert.match(update, /CREDIT_ONLY_SOURCES[\s\S]{0,200}fail\(409/);
});
