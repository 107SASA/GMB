import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerUpdateVariables, unsafeTemplateVariableReason } from '../../src/lib/whatsappOutbound.ts';
import { buildPerformanceDigest, performanceUpdateVariables } from '../../src/services/lifecycle/performanceDigest.ts';
import { buildUtilityReviewVariables, greetingName } from '../../src/lib/reviewRequestFlow.ts';

test('owner update: link line becomes {{3}}, greeting and sign-off are dropped', () => {
  const body = [
    'Hi Mulsetu,',
    '',
    '*📊 Your monthly Google report is ready*',
    '',
    'It covers your Google reviews and next steps.',
    '',
    'View your full report: https://growwmatics.com/dashboard/audit/abc',
    '',
    '— Team Growwmatics AI',
  ].join('\n');
  const built = ownerUpdateVariables('Mulsetu', body, 'https://growwmatics.com/dashboard');
  assert.ok(built.ok);
  if (!built.ok) return;
  assert.deepEqual(built.variables, {
    '1': 'Mulsetu',
    '2': '*📊 Your monthly Google report is ready* — It covers your Google reviews and next steps.',
    '3': 'https://growwmatics.com/dashboard/audit/abc',
  });
  assert.equal(unsafeTemplateVariableReason(built.variables), null);
});

test('owner update: no link line uses the fallback; no fallback refuses', () => {
  const ok = ownerUpdateVariables('Shop', 'Hi Shop,\n\nYour trial is active.', 'https://growwmatics.com/dashboard');
  assert.ok(ok.ok && ok.variables['3'] === 'https://growwmatics.com/dashboard');
  assert.equal(ownerUpdateVariables('Lead', 'Thanks for your interest.', null).ok, false);
});

test('performance update: one value per metric, % only when the previous period was measured', () => {
  const now = new Date('2026-11-12T00:00:00Z');
  const rows = [];
  for (let i = 1; i <= 33; i++) {
    const date = new Date(now.getTime() - i * 86_400_000);
    const recent = i <= 18;
    rows.push({ date, views: recent ? 4 : 2, viewsSearch: 2, viewsMaps: recent ? 2 : 0, callClicks: 0, websiteClicks: 0, directionRequests: 1 });
  }
  const vars = performanceUpdateVariables(buildPerformanceDigest(rows, now), 'Mulsetu');
  assert.ok(vars);
  assert.equal(vars!['1'], 'Mulsetu');
  assert.match(vars!['2'], /^\d+ \w{3} – \d+ \w{3}$/);
  assert.equal(vars!['3'], '60 (+100%)');
  assert.equal(vars!['5'], '30 (up from 0)');
  assert.equal(vars!['6'], '0');
  assert.equal(Object.keys(vars!).length, 8);
  assert.equal(unsafeTemplateVariableReason(vars!), null);
});

test('review request never greets a phone number', () => {
  assert.equal(greetingName('+918485860323'), 'there');
  assert.equal(greetingName('98485 86032'), 'there');
  assert.equal(greetingName(''), 'there');
  assert.equal(greetingName('Savesh'), 'Savesh');
  assert.equal(buildUtilityReviewVariables('+918485860323', 'Mulsetu', 'tok')['1'], 'there');
});

test('owner update: the main action link wins over the app-store lines after it', async () => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://growwmatics.com';
  const { trialExpiredText } = await import('../../src/services/billing/billingWhatsApp.ts').catch(() => ({ trialExpiredText: null as any }));
  const body = trialExpiredText
    ? trialExpiredText({ businessName: 'Mulsetu', trialEndsAt: new Date('2026-11-10T00:00:00Z') })
    : 'Hi Mulsetu,\n\nYour trial ended.\n\nSubscribe: https://growwmatics.com/dashboard/billing\n\n📱 Android app: https://play.google.com/store/apps/details?id=com.growwmatics.app\n\n— Team Growwmatics AI';
  const built = ownerUpdateVariables('Mulsetu', body, 'https://growwmatics.com/dashboard');
  assert.ok(built.ok);
  if (!built.ok) return;
  assert.equal(built.variables['3'], 'https://growwmatics.com/dashboard/billing');
  assert.match(built.variables['2'], /Android app: https:\/\/play\.google\.com/);
});
