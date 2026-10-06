/**
 * Review-request flow rules: tokens, template variables, delivery records,
 * redirect click counting, eligibility, and the business/admin split.
 *
 * Pure functions plus source checks. No database and no Twilio.
 *
 * Run with: node --test tests/integration/review-request-flow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Same Location construction as NextResponse.redirect: absolute URL, status 302. */
function redirectResponse(url: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: String(new URL(url)) } });
}
import {
  REVIEW_SEND_COOLDOWN_ENFORCED,
  aggregateReviewRequestMetrics,
  applyClick,
  buildGoogleReviewUrl,
  canonicalReviewPlaceId,
  buildLegacyReviewVariables,
  buildUtilityReviewVariables,
  businessStatusLabel,
  choosePrimaryReviewSend,
  chooseReviewTemplateRetry,
  decideReviewSendEligibility,
  existingCustomerSendOffer,
  generateReviewRequestToken,
  interpretTwilioStatus,
  extractReviewToken,
  isSafeReviewToken,
  readTimestamps,
  syncFailureFields,
  toAdminReviewDiagnostics,
  toBusinessReviewSummary,
} from '../../src/lib/reviewRequestFlow.ts';
import {
  decideFollowUpEligibility,
  resolveReviewFollowUpSettingsWithGlobal,
  validateGlobalReviewFollowUpSettings,
  type GlobalReviewFollowUpSettings,
} from '../../src/lib/reviewFollowUpSettings.ts';

const PLACE_ID = 'ChIJ4blskkPD3TsRUq38wbsts6U';
const TOKEN = 'AbC123XyTokenValue';

test('tokens are opaque, url-safe, and unique', () => {
  const tokens = new Set<string>();
  for (let i = 0; i < 500; i++) tokens.add(generateReviewRequestToken());
  assert.equal(tokens.size, 500);
  for (const token of tokens) {
    assert.equal(isSafeReviewToken(token), true);
    assert.equal(token.includes(PLACE_ID), false);
  }
});

test('/review/{token}?src=wa uses the path token and still redirects to Google', () => {
  const raw = 'BSzrQO?src=wa';
  const token = extractReviewToken(raw);
  assert.equal(token, 'BSzrQO');
  assert.equal(token.includes('src'), false);
  assert.equal(token.includes('?'), false);
  assert.equal(isSafeReviewToken(token), true);
  assert.equal(isSafeReviewToken(raw), false);
  assert.equal(extractReviewToken('BSzrQO'), 'BSzrQO');
  assert.equal(extractReviewToken(decodeURIComponent('BSzrQO%3Fsrc%3Dwa')), 'BSzrQO');
  assert.equal(
    buildGoogleReviewUrl({ placeId: PLACE_ID, name: 'Mulsetu' }),
    `https://search.google.com/local/writereview?placeid=${PLACE_ID}`
  );
  const route = readFileSync(new URL('../../src/app/review/[token]/route.ts', import.meta.url), 'utf8');
  const redirect = readFileSync(new URL('../../src/lib/reviewRedirect.ts', import.meta.url), 'utf8');
  assert.match(redirect, /extractReviewToken/);
  assert.match(route, /handleReviewRedirectByToken/);
  assert.match(route, /302/);
  const click = applyClick({ clicked: false, clickCount: 0 });
  assert.equal(click.setClickedAt, true);
  assert.equal(click.incrementCampaignClicked, true);
  assert.equal(click.markReviewReceived, false);
  const again = applyClick({ clicked: true, clickCount: 1 });
  assert.equal(again.setClickedAt, false);
  assert.equal(again.incrementCampaignClicked, false);
  assert.equal(again.clickCount, 2);
});

test('a malformed token is rejected before lookup', () => {
  assert.equal(isSafeReviewToken(''), false);
  assert.equal(isSafeReviewToken('../admin'), false);
  assert.equal(isSafeReviewToken('a'.repeat(200)), false);
  assert.equal(isSafeReviewToken('test123'), true);
});

test('google review url opens Write a review for the verified place id', () => {
  const expected = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;
  assert.equal(buildGoogleReviewUrl({ placeId: PLACE_ID, name: 'Mulsetu' }), expected);
  assert.equal(buildGoogleReviewUrl({ googlePlaceId: PLACE_ID, name: 'Mulsetu' }), expected);
  assert.equal(
    buildGoogleReviewUrl({ verifiedLocation: { placeId: PLACE_ID }, googleMapsUrl: 'https://maps.example/biz', name: 'Mulsetu' }),
    expected
  );
  assert.equal(
    canonicalReviewPlaceId({ verifiedLocation: { placeId: PLACE_ID }, googlePlaceId: 'ChIJotherplace', placeId: 'ChIJthirdplace' }),
    PLACE_ID
  );
  assert.equal(buildGoogleReviewUrl({ googleMapsUrl: 'https://maps.example/biz', name: 'Mulsetu' }), 'https://google.com');
  assert.equal(buildGoogleReviewUrl({ placeId: 'locations/123', googleMapsUrl: 'https://maps.google.com/?cid=1' }), 'https://google.com');
  assert.equal(buildGoogleReviewUrl({ placeId: '123456789012345' }), 'https://google.com');
  assert.equal(buildGoogleReviewUrl(null), 'https://google.com');
  assert.equal(buildGoogleReviewUrl({ name: 'Mulsetu' }).includes('writereview'), false);
  assert.equal(
    buildGoogleReviewUrl({ googleMapsUrl: `https://www.google.com/maps/search/?api=1&query_place_id=${PLACE_ID}` }),
    expected
  );
});

test('GET /review/{validToken}?src=wa Location is the write-review URL', () => {
  const expected = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;
  const token = extractReviewToken(`${TOKEN}?src=wa`);
  assert.equal(token, TOKEN);
  assert.equal(isSafeReviewToken(token), true);
  assert.equal(extractReviewToken(''), '');
  assert.equal(isSafeReviewToken(''), false);
  assert.equal(isSafeReviewToken('not a token'), false);

  const destination = buildGoogleReviewUrl({
    verifiedLocation: { placeId: PLACE_ID },
    googlePlaceId: PLACE_ID,
    placeId: PLACE_ID,
    googleMapsUrl: 'https://maps.google.com/?cid=998877',
    name: 'Mulsetu',
  });
  const response = redirectResponse(destination, 302);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), expected);
  assert.equal(response.headers.get('location')?.includes('maps.google'), false);
  assert.equal(response.headers.get('location')?.includes('google.com/maps'), false);
  assert.equal(response.headers.get('location')?.includes('/search?'), false);

  const missingPlace = redirectResponse(buildGoogleReviewUrl({ googleMapsUrl: 'https://maps.google.com/?cid=998877' }), 302);
  assert.equal(missingPlace.headers.get('location'), 'https://google.com/');

  const first = applyClick({ clicked: false, clickCount: 0 });
  assert.equal(first.setClickedAt, true);
  assert.equal(first.clickCount, 1);
  assert.equal(first.incrementCampaignClicked, true);
  assert.equal(first.markReviewReceived, false);
  const repeat = applyClick({ clicked: true, clickCount: first.clickCount });
  assert.equal(repeat.setClickedAt, false);
  assert.equal(repeat.incrementCampaignClicked, false);
  assert.equal(repeat.clickCount, 2);
  assert.equal(repeat.markReviewReceived, false);

  const route = readFileSync(new URL('../../src/app/review/[token]/route.ts', import.meta.url), 'utf8');
  const redirect = readFileSync(new URL('../../src/lib/reviewRedirect.ts', import.meta.url), 'utf8');
  assert.match(route, /NextResponse\.redirect\(url, 302\)/);
  assert.match(redirect, /buildGoogleReviewUrl/);
  assert.equal(redirect.includes('googleMapsUrl ||'), false);
  assert.equal(route.includes('maps.google'), false);
});

test('the first click is counted once and is not a review', () => {
  const first = applyClick({ clicked: false, clickCount: 0 });
  assert.equal(first.incrementCampaignClicked, true);
  assert.equal(first.setClickedAt, true);
  assert.equal(first.markReviewReceived, false);
  const second = applyClick({ clicked: true, clickCount: first.clickCount });
  assert.equal(second.incrementCampaignClicked, false);
  assert.equal(second.setClickedAt, false);
  assert.equal(second.clickCount, 2);
  assert.equal(second.markReviewReceived, false);
});

test('the utility template receives the token and not the place id', () => {
  const vars = buildUtilityReviewVariables('Priya', 'Mulsetu', TOKEN);
  assert.equal(vars['1'], 'Priya');
  assert.equal(vars['2'], 'Mulsetu');
  assert.equal(vars['3'], TOKEN);
  assert.notEqual(vars['3'], PLACE_ID);
  assert.equal(JSON.stringify(vars).includes(PLACE_ID), false);

  const chosen = choosePrimaryReviewSend({
    utilitySid: 'HX5ac75bff43238d0c253a1dd15cca746c',
    token: TOKEN,
    customerName: 'Priya',
    businessName: 'Mulsetu',
  });
  assert.equal(chosen.mode, 'utility');
  if (chosen.mode !== 'utility') return;
  assert.equal(chosen.variables['3'], TOKEN);
  assert.equal(chosen.contentSid, 'HX5ac75bff43238d0c253a1dd15cca746c');
});

test('the legacy template still receives the place id when the utility template is unset', () => {
  const primary = choosePrimaryReviewSend({
    utilitySid: '',
    token: TOKEN,
    customerName: 'Priya',
    businessName: 'Mulsetu',
  });
  assert.equal(primary.mode, 'legacy-free-text');

  const fallback = chooseReviewTemplateRetry({
    errorCode: '63016',
    alreadyTemplate: false,
    utilitySid: '',
    legacySid: 'HXlegacy',
    token: TOKEN,
    placeId: PLACE_ID,
    customerName: 'Priya',
    businessName: 'Mulsetu',
  });
  assert.equal(fallback.mode, 'legacy');
  if (fallback.mode !== 'legacy') return;
  assert.deepEqual(fallback.variables, buildLegacyReviewVariables('Priya', 'Mulsetu', PLACE_ID));
  assert.equal(fallback.variables['3'], PLACE_ID);
});

test('63049 is stored in full and is not retried', () => {
  const now = new Date('2026-10-04T03:00:00.000Z');
  const message = 'Meta chose not to deliver this WhatsApp marketing message';
  const sync = syncFailureFields(63049, message, now);
  assert.equal(sync.errorCode, '63049');
  assert.equal(sync.errorMessage, message);
  assert.equal(sync.failedReason, message);
  assert.equal(sync.failedAt.toISOString(), now.toISOString());

  const asyncFailure = interpretTwilioStatus('failed', '63049', message);
  assert.equal(asyncFailure.kind, 'failed');
  if (asyncFailure.kind !== 'failed') return;
  assert.equal(asyncFailure.errorCode, '63049');
  assert.equal(asyncFailure.errorMessage, message);

  const retry = chooseReviewTemplateRetry({
    errorCode: '63049',
    alreadyTemplate: true,
    utilitySid: 'HX5ac75bff43238d0c253a1dd15cca746c',
    legacySid: 'HXlegacy',
    token: TOKEN,
    placeId: PLACE_ID,
    customerName: 'Priya',
    businessName: 'Mulsetu',
  });
  assert.equal(retry.mode, 'none');
});

test('a read receipt keeps deliveredAt and adds readAt', () => {
  const deliveredAt = new Date('2026-10-04T03:00:00.000Z');
  const readAt = new Date('2026-10-04T03:05:00.000Z');
  const read = readTimestamps(readAt, deliveredAt);
  assert.equal(read.status, 'Read');
  assert.equal(read.readAt, readAt);
  assert.equal(read.deliveredAt, deliveredAt);

  const readWithoutDelivery = readTimestamps(readAt, null);
  assert.equal(readWithoutDelivery.deliveredAt, readAt);
  assert.equal(interpretTwilioStatus('delivered', null, null).kind, 'delivered');
  assert.equal(interpretTwilioStatus('read', null, null).kind, 'read');
});

test('business status hides provider errors and admin diagnostics keep them', () => {
  const row = {
    _id: 'req1',
    customerId: 'cust1',
    businessId: 'biz1',
    status: 'Failed',
    errorCode: '63049',
    errorMessage: 'Meta chose not to deliver this WhatsApp marketing message',
    failedReason: 'Meta chose not to deliver this WhatsApp marketing message',
    templateSid: 'HXlegacy',
    lastMessageSid: 'SM123',
    token: TOKEN,
    sentAt: '2026-10-04T03:00:00.000Z',
    failedAt: '2026-10-04T03:01:00.000Z',
  };
  const business = toBusinessReviewSummary(row);
  assert.equal(business.statusLabel, 'Unable to deliver');
  assert.equal(businessStatusLabel(row), 'Unable to deliver');
  assert.equal('errorCode' in business, false);
  assert.equal('errorMessage' in business, false);
  assert.equal('templateSid' in business, false);
  assert.equal('lastMessageSid' in business, false);
  assert.equal('token' in business, false);
  assert.equal(JSON.stringify(business).includes('63049'), false);
  assert.equal(JSON.stringify(business).includes('SM123'), false);

  const admin = toAdminReviewDiagnostics(row);
  assert.equal(admin.errorCode, '63049');
  assert.equal(admin.errorMessage, row.errorMessage);
  assert.equal(admin.lastMessageSid, 'SM123');
  assert.equal(admin.templateSid, 'HXlegacy');
  assert.equal(admin.provider, 'Twilio');
  assert.equal(admin.reviewRequestId, 'req1');
});

test('analytics count delivery states and ignore click-as-review', () => {
  const metrics = aggregateReviewRequestMetrics([
    { status: 'Sent', sentAt: '2026-10-01' },
    { status: 'Delivered', sentAt: '2026-10-01', deliveredAt: '2026-10-01' },
    { status: 'Read', sentAt: '2026-10-01', deliveredAt: '2026-10-01', readAt: '2026-10-01' },
    { status: 'Delivered', sentAt: '2026-10-01', deliveredAt: '2026-10-01', clickedAt: '2026-10-02', reviewReceived: true },
    { status: 'Failed', sentAt: '2026-10-01' },
    { status: 'Pending' },
    { status: 'Cancelled' },
  ]);
  assert.deepEqual(metrics, { reviewRequests: 5, delivered: 3, read: 1, clicked: 1, failed: 1 });
  assert.equal('reviewsReceived' in metrics, false);
});

test('an opted-out customer cannot be sent a review request', () => {
  const decision = decideReviewSendEligibility({
    source: 'manual',
    optedOut: true,
    hasPhone: true,
    hasPlaceId: true,
    dailyLimitReached: false,
    hasActiveCampaignRequest: false,
    cooldownActive: REVIEW_SEND_COOLDOWN_ENFORCED,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'OPTED_OUT');
});

test('an existing customer can be selected for another request, without a new cooldown', () => {
  assert.equal(REVIEW_SEND_COOLDOWN_ENFORCED, false);
  const offer = existingCustomerSendOffer('cust1');
  assert.equal(offer.create, false);
  assert.equal(offer.message, 'Customer already exists');
  assert.equal(offer.message.toLowerCase().includes('already registered'), false);
  const decision = decideReviewSendEligibility({
    source: 'manual',
    optedOut: false,
    hasPhone: true,
    hasPlaceId: true,
    dailyLimitReached: false,
    hasActiveCampaignRequest: true,
    cooldownActive: REVIEW_SEND_COOLDOWN_ENFORCED,
  });
  assert.equal(decision.allowed, true);
});

const GLOBAL_ON: GlobalReviewFollowUpSettings = {
  enabled: true,
  initialFollowUpDelayDays: 7,
  secondFollowUpDelayDays: 14,
  maximumFollowUps: 2,
  minimumIntervalDays: 7,
  stopOnOptOut: true,
  stopOnClick: false,
  stopOnReview: false,
};

function eligibleFollowUp(overrides: Partial<Parameters<typeof decideFollowUpEligibility>[0]> = {}) {
  return decideFollowUpEligibility({
    stage: 1,
    policy: GLOBAL_ON,
    customerExists: true,
    hasPhone: true,
    optedOut: false,
    hasPlaceId: true,
    businessMatches: true,
    dailyLimitReached: false,
    requestOpen: true,
    followUpStage: 0,
    alreadySentThisStage: false,
    ...overrides,
  });
}

test('global follow-ups disabled schedules no follow-up', () => {
  const resolved = resolveReviewFollowUpSettingsWithGlobal(null, { ...GLOBAL_ON, enabled: false });
  assert.equal(resolved.reminder1Enabled, false);
  assert.equal(resolved.reminder2Enabled, false);
  assert.equal(resolved.source, 'global');
  assert.equal(eligibleFollowUp({ policy: { ...GLOBAL_ON, enabled: false } }).send, false);
});

test('global follow-ups enabled schedules the configured first follow-up', () => {
  const resolved = resolveReviewFollowUpSettingsWithGlobal(null, GLOBAL_ON);
  assert.equal(resolved.reminder1Enabled, true);
  assert.equal(resolved.reminder1AfterDays, 7);
  assert.equal(resolved.source, 'global');
  assert.equal(eligibleFollowUp().code, 'OK');
});

test('second follow-up uses the configured delay and not a campaign delay', () => {
  const resolved = resolveReviewFollowUpSettingsWithGlobal(
    { reminder1AfterDays: 2, reminder2AfterDays: 5 },
    GLOBAL_ON
  );
  assert.equal(resolved.reminder2Enabled, true);
  assert.equal(resolved.reminder2AfterDays, 14);
  assert.equal(resolved.reminder1AfterDays, 7);
  const second = eligibleFollowUp({ stage: 2, followUpStage: 1 });
  assert.equal(second.send, true);
});

test('maximum follow-ups stops another send, including a repeated stage', () => {
  assert.equal(eligibleFollowUp({ stage: 2, policy: { ...GLOBAL_ON, maximumFollowUps: 1 }, followUpStage: 1 }).code, 'MAX_FOLLOW_UPS');
  assert.equal(eligibleFollowUp({ stage: 2, followUpStage: 2 }).code, 'ALREADY_SENT');
  assert.equal(eligibleFollowUp({ stage: 1, alreadySentThisStage: true }).code, 'ALREADY_SENT');
  const capped = resolveReviewFollowUpSettingsWithGlobal(null, { ...GLOBAL_ON, maximumFollowUps: 2 });
  assert.equal(capped.reminder2Enabled, true);
  const one = resolveReviewFollowUpSettingsWithGlobal(null, { ...GLOBAL_ON, maximumFollowUps: 1 });
  assert.equal(one.reminder2Enabled, false);
});

test('an opted-out customer is not followed up', () => {
  assert.equal(eligibleFollowUp({ optedOut: true }).code, 'OPTED_OUT');
});

test('an ineligible customer is not followed up', () => {
  assert.equal(eligibleFollowUp({ hasPhone: false }).code, 'NO_PHONE');
  assert.equal(eligibleFollowUp({ customerExists: false }).code, 'CUSTOMER_MISSING');
  assert.equal(eligibleFollowUp({ businessMatches: false }).code, 'BUSINESS_MISMATCH');
  assert.equal(eligibleFollowUp({ hasPlaceId: false }).code, 'NO_PLACE_ID');
  assert.equal(eligibleFollowUp({ requestOpen: false }).code, 'REQUEST_CLOSED');
});

test('a later global policy does not rewrite a schedule that already started', () => {
  const started = resolveReviewFollowUpSettingsWithGlobal(null, GLOBAL_ON);
  const updated = resolveReviewFollowUpSettingsWithGlobal(null, {
    ...GLOBAL_ON,
    initialFollowUpDelayDays: 5,
    secondFollowUpDelayDays: 9,
  });
  assert.equal(started.reminder1AfterDays, 7);
  assert.equal(started.reminder2AfterDays, 14);
  assert.equal(updated.reminder1AfterDays, 5);
  const tooSoon = eligibleFollowUp({
    stage: 2,
    followUpStage: 1,
    earliestSendAt: '2026-10-10T00:00:00.000Z',
    now: '2026-10-09T00:00:00.000Z',
  });
  assert.equal(tooSoon.code, 'INTERVAL');
});

test('invalid follow-up settings are rejected', () => {
  assert.equal(validateGlobalReviewFollowUpSettings({ ...GLOBAL_ON, initialFollowUpDelayDays: -1 }).ok, false);
  assert.equal(validateGlobalReviewFollowUpSettings({ ...GLOBAL_ON, maximumFollowUps: 3 }).ok, false);
  assert.equal(validateGlobalReviewFollowUpSettings({ ...GLOBAL_ON, secondFollowUpDelayDays: 3, minimumIntervalDays: 7 }).ok, false);
  assert.equal(validateGlobalReviewFollowUpSettings({ ...GLOBAL_ON, stopOnClick: true }).ok, false);
  assert.equal(validateGlobalReviewFollowUpSettings({ ...GLOBAL_ON, stopOnReview: true }).ok, false);
  const saved = validateGlobalReviewFollowUpSettings(GLOBAL_ON);
  assert.equal(saved.ok, true);
});

test('the review worker reads the persisted global policy and does not stop on a click', () => {
  const worker = readFileSync(new URL('../../src/services/inngest/functions.ts', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../../src/app/api/admin/review-follow-up/route.ts', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../../src/components/reviews/CampaignsDashboard.tsx', import.meta.url), 'utf8');
  assert.match(worker, /loadReviewFollowUpPolicy/);
  assert.match(worker, /resolveReviewFollowUpSettingsWithGlobal/);
  assert.match(worker, /followUpClaim/);
  assert.match(worker, /decideFollowUpEligibility/);
  assert.doesNotMatch(worker, /req\.clicked/);
  assert.match(admin, /requireSuperAdmin/);
  assert.match(admin, /available: false/);
  assert.doesNotMatch(dashboard, /Create Campaign/);
  assert.doesNotMatch(dashboard, /No campaigns yet/);
});

test('old redirect routes stay, and the new route is token based', () => {
  const go = readFileSync(new URL('../../src/app/go/[id]/route.ts', import.meta.url), 'utf8');
  const track = readFileSync(new URL('../../src/app/api/campaigns/track/[requestId]/route.ts', import.meta.url), 'utf8');
  const review = readFileSync(new URL('../../src/app/review/[token]/route.ts', import.meta.url), 'utf8');
  assert.match(go, /handleReviewRedirect\(/);
  assert.doesNotMatch(go, /handleReviewRedirectByToken/);
  assert.match(track, /handleReviewRedirect\(/);
  assert.match(review, /handleReviewRedirectByToken/);
  assert.match(review, /302/);
});

test('web and mobile read the same review-request endpoint', () => {
  const web = readFileSync(new URL('../../src/components/reviews/CampaignsDashboard.tsx', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('../../mobile/src/api/endpoints/review-requests.ts', import.meta.url), 'utf8');
  assert.match(web, /\/api\/review-requests/);
  assert.match(mobile, /\/api\/review-requests/);
  assert.doesNotMatch(web, /No campaigns yet/);
  assert.doesNotMatch(web, /Create Campaign/);
  assert.doesNotMatch(web, /Campaign Name/);
});

test('business route does not select provider errors, and admin can filter them', () => {
  const business = readFileSync(new URL('../../src/app/api/review-requests/route.ts', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../../src/app/api/admin/review-requests/route.ts', import.meta.url), 'utf8');
  const customers = readFileSync(new URL('../../src/app/api/customers/route.ts', import.meta.url), 'utf8');
  assert.match(business, /toBusinessReviewSummary/);
  assert.doesNotMatch(business, /errorCode/);
  assert.match(admin, /requireSuperAdmin/);
  assert.match(admin, /errorCode/);
  assert.match(customers, /Customer already exists/);
  assert.doesNotMatch(customers, /already registered/i);
});

test('click autopoll no longer marks a request as a received review', () => {
  const worker = readFileSync(new URL('../../src/services/inngest/functions.ts', import.meta.url), 'utf8');
  assert.match(worker, /clicks are not reviews/);
  assert.doesNotMatch(worker, /reviewReceived = true/);
});
