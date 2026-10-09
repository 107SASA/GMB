/**
 * WhatsApp 24-hour routing and demo confirmation rules. No Twilio and no database.
 * Run with: node --experimental-strip-types --test tests/integration/whatsapp-outbound-window.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  bookingAfterWhatsAppResult,
  buildNotificationVariables,
  demoConfirmationText,
  outboundChannel,
  realInboundAtFromMessages,
  sanitizeWhatsAppTemplateVariable,
  shouldDispatchConfirmation,
  shouldRetryFreeformAsTemplate,
  unsafeTemplateVariableReason,
} from '../../src/lib/whatsappOutbound.ts';

const NOW = new Date('2026-10-08T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const MEET = 'https://meet.google.com/abc-defg-hij';
const WHEN = '10 Oct 2026 at 3:00 PM';

test('A inside 24 hours chooses free-form and does not build a content SID', () => {
  const last = new Date(NOW.getTime() - 2 * HOUR);
  assert.equal(outboundChannel(last, NOW), 'free-form');
  const source = fs.readFileSync(new URL('../../src/services/whatsapp/send.ts', import.meta.url), 'utf8');
  const send = source.slice(source.indexOf('export async function sendOutboundMessage'), source.indexOf('export async function sendOtpMessage'));
  const route = send.indexOf("outboundChannel(window.lastInboundAt)");
  const freeForm = send.indexOf('sendViaTwilio');
  const templateFirst = send.indexOf("if (channel === 'template')");
  assert.ok(route > 0 && templateFirst > route && templateFirst < freeForm);
  assert.equal(send.includes('contentSid'), false);
});

test('B outside 24 hours chooses the notification template and does not call free-form first', () => {
  assert.equal(outboundChannel(new Date(NOW.getTime() - 25 * HOUR), NOW), 'template');
  assert.equal(outboundChannel(null, NOW), 'template');
  const source = fs.readFileSync(new URL('../../src/services/whatsapp/send.ts', import.meta.url), 'utf8');
  const send = source.slice(source.indexOf("if (provider === 'twilio')"), source.indexOf('const msgLog = await MessageQueue.create'));
  assert.ok(send.indexOf("channel === 'template'") < send.indexOf('sendViaTwilio'));
  assert.ok(send.includes('sendNotificationTemplate'));
});

test('C outside-window variables are exactly {{1}} and a single-line {{2}}', () => {
  const built = buildNotificationVariables(
    'Sarvesh Kumar',
    `Your demo is confirmed for ${WHEN} IST. Join here: ${MEET}`
  );
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(Object.keys(built.variables), ['1', '2']);
  assert.equal(built.variables['1'], 'Sarvesh');
  assert.equal(built.variables['2'].includes('\n'), false);
  assert.equal(built.variables['2'].includes('\t'), false);
  assert.match(built.variables['2'], /10 Oct 2026/);
  assert.match(built.variables['2'], /3:00 PM/);
  assert.match(built.variables['2'], /IST/);
  assert.ok(built.variables['2'].includes(MEET));
});

test('D missing name, missing message, or a leftover newline does not allow a Twilio send', () => {
  assert.equal(buildNotificationVariables('', 'Hello').ok, false);
  assert.equal(buildNotificationVariables('Sarvesh', '   ').ok, false);
  const raw = unsafeTemplateVariableReason({ '1': 'Sarvesh', '2': 'Line one\nLine two' });
  assert.match(raw || '', /single line/);
  const tab = unsafeTemplateVariableReason({ '1': 'Sarvesh', '2': 'has\ta tab' });
  assert.match(tab || '', /single line/);
  const client = fs.readFileSync(new URL('../../src/services/twilio/client.ts', import.meta.url), 'utf8');
  const templateSend = client.slice(client.indexOf('export async function sendTemplateMessage'));
  assert.ok(templateSend.indexOf('unsafeTemplateVariableReason') < templateSend.indexOf('messages.create'));
});

test('E demo confirmation inside the window is free-form and contains the booking facts', () => {
  const text = demoConfirmationText({ whenLabel: WHEN, meetingLink: MEET, timezone: 'Asia/Kolkata' });
  assert.equal(outboundChannel(new Date(NOW.getTime() - HOUR), NOW), 'free-form');
  assert.match(text, /10 Oct 2026/);
  assert.match(text, /3:00 PM/);
  assert.match(text, /IST/);
  assert.ok(text.includes(MEET));
});

test('F demo confirmation outside the window puts the same facts on one {{2}} line', () => {
  assert.equal(outboundChannel(null, NOW), 'template');
  const text = demoConfirmationText({ whenLabel: WHEN, meetingLink: MEET, timezone: 'Asia/Kolkata' });
  const built = buildNotificationVariables('Sarvesh', text);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const line = built.variables['2'];
  assert.equal(line.includes('\n'), false);
  assert.equal(line.includes('\r'), false);
  assert.equal(line.includes('\t'), false);
  assert.match(line, /10 Oct 2026/);
  assert.match(line, /3:00 PM/);
  assert.match(line, /IST/);
  assert.ok(line.includes(MEET));
});

test('G a WhatsApp failure does not roll back a confirmed Calendar booking', () => {
  const kept = bookingAfterWhatsAppResult(
    { status: 'Confirmed', calendarEventId: 'evt-1' },
    { success: false }
  );
  assert.equal(kept.status, 'Confirmed');
  assert.equal(kept.calendarEventId, 'evt-1');
  assert.equal(kept.rollback, false);
  assert.equal(kept.whatsappDelivered, false);
  const route = fs.readFileSync(new URL('../../src/app/api/leads/book-demo/route.ts', import.meta.url), 'utf8');
  const finish = route.slice(route.indexOf('async function finishConfirmedBooking'), route.length);
  assert.equal(finish.includes('deleteCalendarEvent'), false);
  assert.ok(finish.includes('releaseDemoConfirmationSend'));
  assert.match(finish, /booking is still confirmed/);
});

test('H a second identical booking does not send another confirmation', () => {
  assert.equal(shouldDispatchConfirmation({
    calendarConfirmed: true,
    meetingLink: MEET,
    alreadySentAt: null,
  }), true);
  assert.equal(shouldDispatchConfirmation({
    calendarConfirmed: true,
    meetingLink: MEET,
    alreadySentAt: NOW,
  }), false);
  assert.equal(shouldDispatchConfirmation({
    calendarConfirmed: false,
    meetingLink: '',
    alreadySentAt: null,
  }), false);
  const claim = fs.readFileSync(new URL('../../src/services/demo/confirmationClaim.ts', import.meta.url), 'utf8');
  assert.ok(claim.includes('shouldDispatchConfirmation'));
  assert.ok(claim.includes('whatsappConfirmationSentAt: { $exists: false }'));
});

test('I a website form lead line does not open the WhatsApp window', () => {
  const stamped = realInboundAtFromMessages(
    [{ role: 'lead', via: 'form', at: new Date(NOW.getTime() - 5 * 60 * 1000), text: 'Hi' } as { role: string; via: string; at: Date }],
    null
  );
  assert.equal(stamped, null);
  assert.equal(outboundChannel(stamped, NOW), 'template');
  const real = realInboundAtFromMessages(
    [{ role: 'lead', via: 'whatsapp', at: new Date(NOW.getTime() - 30 * 60 * 1000) }],
    null
  );
  assert.equal(outboundChannel(real, NOW), 'free-form');
});

test('J a 63016 callback retry sanitizes variables and does not send a second copy', () => {
  const raw = `Your GrowwMatics demo is confirmed for ${WHEN} (IST).\n\nJoin here: ${MEET}`;
  const built = buildNotificationVariables('Sarvesh', raw);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.variables['2'].includes('\n'), false);
  assert.ok(built.variables['2'].includes(MEET));
  assert.equal(sanitizeWhatsAppTemplateVariable(raw).includes('\n'), false);
  assert.equal(shouldRetryFreeformAsTemplate({ errorCode: '63016', alreadyTemplate: false, alreadyRetried: false }), true);
  assert.equal(shouldRetryFreeformAsTemplate({ errorCode: '63016', alreadyTemplate: false, alreadyRetried: true }), false);
  assert.equal(shouldRetryFreeformAsTemplate({ errorCode: '63016', alreadyTemplate: true, alreadyRetried: false }), false);
  const status = fs.readFileSync(new URL('../../src/app/api/webhook/twilio/status/route.ts', import.meta.url), 'utf8');
  const retry = status.slice(status.indexOf('async function retryGenericAsNotificationTemplate'), status.indexOf('export async function POST'));
  assert.ok(retry.includes('shouldRetryFreeformAsTemplate'));
  assert.ok(retry.includes('templateRetried'));
  assert.ok(retry.includes('retryFreeformAsNotification'));
  assert.equal(retry.includes("{'1': 'there'"), false);
});
