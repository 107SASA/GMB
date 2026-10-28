/**
 * The mobile app's "workspace isn't active" WhatsApp button: the prefilled
 * text is recognised and answered with the fixed payment reply.
 *
 * Run: npx tsx --test tests/workflow/app-access-help.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_ACCESS_MESSAGE } from '../../src/lib/whatsappCta.ts';
import { appAccessReplyText, isAppAccessMessage } from '../../src/services/whatsapp/appAccessHelp.ts';

test('the app button text matches the webhook trigger exactly', () => {
  const mobile = readFileSync(new URL('../../mobile/src/components/workspace-inactive.tsx', import.meta.url), 'utf8');
  const m = mobile.match(/export const ACTIVATE_MESSAGE = "([^"]+)"/);
  assert.equal(m?.[1], APP_ACCESS_MESSAGE);
});

test('recognises the prefilled message, tolerating case, spacing and curly apostrophes', () => {
  assert.ok(isAppAccessMessage(APP_ACCESS_MESSAGE));
  assert.ok(isAppAccessMessage(`  ${APP_ACCESS_MESSAGE.toUpperCase().replace("'", '’')}  `));
  assert.ok(!isAppAccessMessage('Hi, I need help with my GrowwMatics account'));
  assert.ok(!isAppAccessMessage(''));
  assert.ok(!isAppAccessMessage(null));
});

test('fixed reply asks to complete payment and includes the subscribe link when set', () => {
  const withLink = appAccessReplyText('https://growwmatics.com/dashboard/billing');
  assert.match(withLink, /complete your payment/);
  assert.match(withLink, /dashboard unlocks automatically/);
  assert.match(withLink, /https:\/\/growwmatics\.com\/dashboard\/billing/);
  const noLink = appAccessReplyText('');
  assert.doesNotMatch(noLink, /complete it here/);
  assert.match(noLink, /Already paid\?/);
});
