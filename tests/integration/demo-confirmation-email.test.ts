/**
 * Demo confirmation email includes Meet link only when present.
 * Run with: node --experimental-strip-types --test tests/integration/demo-confirmation-email.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoConfirmationEmailHtml } from '../../src/services/demo/demoConfirmationEmail.ts';

test('includes meeting link when non-empty', () => {
  const html = buildDemoConfirmationEmailHtml({
    name: 'Ada',
    date: '2026-10-10',
    timeSlot: '10:00',
    meetingLink: 'https://meet.google.com/abc-defg-hij',
  });
  assert.match(html, /meet\.google\.com\/abc-defg-hij/);
  assert.doesNotMatch(html, /contact you shortly to confirm the meeting link/);
});

test('omits invented link when meetingLink empty', () => {
  const html = buildDemoConfirmationEmailHtml({
    name: 'Ada',
    date: '2026-10-10',
    timeSlot: '10:00',
    meetingLink: null,
  });
  assert.doesNotMatch(html, /Meeting link:/);
  assert.match(html, /confirm the meeting link/);
});
