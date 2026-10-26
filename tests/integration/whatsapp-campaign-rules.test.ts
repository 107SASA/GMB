/**
 * Send WhatsApp to leads — the pure rules. No database, no sending.
 * Run: node --experimental-strip-types --test tests/integration/whatsapp-campaign-rules.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  campaignMessageLine,
  campaignSkipReason,
  campaignVariables,
  firstNameFor,
  renderTemplate,
  templatePlaceholders,
  templateShapeError,
} from '../../src/lib/whatsappCampaign.ts';

test('who is left out', () => {
  const now = new Date('2026-10-26T10:00:00Z');
  assert.equal(campaignSkipReason({ phone: '' }), 'no-phone');
  assert.equal(campaignSkipReason({ phone: '123' }), 'no-phone');
  assert.equal(campaignSkipReason({ phone: '+919876543210', nurtureStatus: 'OPTED_OUT' }), 'opted-out');
  assert.equal(campaignSkipReason({ phone: '+919876543210', currentStage: 'DO_NOT_CONTACT' }), 'do-not-contact');
  assert.equal(campaignSkipReason({ phone: '+919876543210', currentAgent: 'IN_HOUSE' }), 'customer');
  assert.equal(campaignSkipReason({ phone: '9876543210' }), null, 'a bare Indian number is fine');
  const recent = { lastCampaignAt: new Date('2026-10-22T10:00:00Z'), now };
  assert.equal(campaignSkipReason({ phone: '+919876543210' }, recent), 'recently-messaged');
  assert.equal(campaignSkipReason({ phone: '+919876543210' }, { ...recent, skipRecent: false }), null);
  assert.equal(campaignSkipReason({ phone: '+919876543210' }, { lastCampaignAt: new Date('2026-10-10T10:00:00Z'), now }), null, 'more than 7 days ago');
});

test('template shapes and filled-in text', () => {
  assert.deepEqual(templatePlaceholders('Hi {{1}}, {{ 2 }} and {{1}}'), [1, 2]);
  assert.equal(templateShapeError([1, 2]), null);
  assert.equal(templateShapeError([1]), null);
  assert.equal(templateShapeError([]), null);
  assert.match(String(templateShapeError([1, 2, 3])), /\{\{3\}\}/);
  assert.equal(firstNameFor('Rahul Patil'), 'Rahul');
  assert.equal(firstNameFor('+919876543210'), 'there');
  assert.equal(firstNameFor('New User'), 'there');
  const line = campaignMessageLine('Great meeting you.\n\nWant a free report?');
  assert.deepEqual(line, { ok: true, line: 'Great meeting you. Want a free report?' });
  assert.equal(campaignMessageLine('   ').ok, false);
  assert.equal(campaignMessageLine('x'.repeat(901)).ok, false);
  const vars = campaignVariables([1, 2], 'Asha', 'Hello');
  assert.deepEqual(vars, { '1': 'Asha', '2': 'Hello' });
  assert.equal(renderTemplate('Hi {{1}}, {{2}}', vars), 'Hi Asha, Hello');
  assert.deepEqual(campaignVariables([1], 'Asha', 'ignored'), { '1': 'Asha' });
});

