/**
 * FR-5 change rules. Pure. No Google calls.
 * Run: node --experimental-strip-types --test tests/integration/fr5-changes.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fr5GuardedPatch, fr5ProfileMutationAllowed } from '../../src/lib/gbpSafety.ts';
import {
  PRODUCTS_SUPPORT,
  buildAttributeWrite,
  planAttributeBatch,
  buildServiceWrite,
  canonicalFingerprint,
  classifyReadBack,
  canRollbackAttribute,
  idempotencyResult,
  comparePin,
  draftDescription,
  fingerprint,
  locationGuard,
  rollbackRecheck,
  staleFieldDecision,
  haversineMeters,
  holidayReminders,
  toGoogleHours,
  validateBusinessName,
  validateDescription,
  validateRegularHours,
  validateServiceArea,
  validateSpecialHours,
  withGbpUtm,
} from '../../src/services/gbp/changes/policy.ts';
import { applyAndVerify, approve, executionClaim, failClosed, markReverted, rollbackDecision, type ChangeRecord } from '../../src/services/gbp/changes/machine.ts';
import { proposeServices, recommendCategories, suggestUnsetAttributes } from '../../src/services/gbp/changes/recommend.ts';
import { calendarDate, holidayCalendarFor } from '../../src/services/gbp/changes/holidayCalendar.ts';

const base = (): ChangeRecord => ({
  id: '1', businessId: 'biz', organizationId: null, locationId: 'locations/1',
  kind: 'description', fields: ['description'], sensitive: false, source: 'owner',
  before: 'old', proposed: 'new', after: null, beforeFingerprint: 'a', afterFingerprint: null,
  status: 'PROPOSED', validation: { valid: true, violations: [] },
  requestedBy: 'user', approvedBy: null, approvedAt: null, executedAt: null, verifiedAt: null,
  googleResult: null, error: null, rollbackStatus: null, rolledBackBy: null, rolledBackAt: null,
  recommendationRef: null,
});

test('approval is workspace-bound and sensitive fields need a separate confirm', () => {
  const other = approve(base(), { userId: 'u', businessId: 'other' }, { now: '2026-10-08T00:00:00.000Z' });
  assert.equal(other.ok, false);
  const sensitive = { ...base(), kind: 'title', sensitive: true };
  const missing = approve(sensitive, { userId: 'u', businessId: 'biz' }, { now: '2026-10-08T00:00:00.000Z' });
  assert.equal(missing.ok, false);
  const ok = approve(sensitive, { userId: 'u', businessId: 'biz' }, { confirmSensitive: true, now: '2026-10-08T00:00:00.000Z' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.change.status, 'APPROVED');
  const invalid = approve({ ...base(), validation: { valid: false, violations: [{ code: 'url', message: 'x' }] } }, { userId: 'u', businessId: 'biz' }, { now: '2026-10-08T00:00:00.000Z' });
  assert.equal(invalid.ok, false);
});

test('execution and rollback refuse duplicates and stale Google state', () => {
  assert.equal(executionClaim('APPROVED'), 'ok');
  assert.equal(executionClaim('EXECUTING'), 'duplicate');
  assert.equal(executionClaim('PROPOSED'), 'not_approved');
  const verified = { ...base(), status: 'VERIFIED' as const, afterFingerprint: fingerprint('after'), after: 'after' };
  assert.equal(rollbackDecision(verified, fingerprint('after')), 'ok');
  assert.equal(rollbackDecision(verified, fingerprint('someone else')), 'conflict');
  assert.equal(rollbackDecision({ ...verified, status: 'REVERTED' }, fingerprint('after')), 'duplicate');
});

test('description policy', () => {
  const tokens = ['plumber', 'nashik'];
  const good = draftDescription({ name: 'Mulsetu', category: 'Plumber', city: 'Nashik', services: ['Blocked drain repair'] });
  const valid = validateDescription(good, { tokens });
  assert.equal(valid.valid, true);
  assert.equal(valid.first250Quality, true);
  assert.ok(good.length <= 750);
  assert.equal(validateDescription(`${'a'.repeat(751)} plumber nashik`, { tokens }).valid, false);
  assert.equal(validateDescription('Mulsetu is a plumber in Nashik. Visit https://example.com', { tokens }).containsUrl, true);
  assert.equal(validateDescription('The best plumber in Nashik', { tokens }).promotionalLanguage, true);
  assert.equal(validateDescription('plumber plumber plumber plumber in Nashik', { tokens }).keywordStuffing, true);
  assert.equal(validateDescription('Mulsetu is a plumber in Nashik with 500 reviews', { tokens, allowedNumbers: [] }).unsupportedClaims, true);
});

test('name guard blocks stuffing and always requires explicit approval', () => {
  const clean = validateBusinessName('Mulsetu', 'Mulsetu Plumbing', { city: 'Nashik', category: 'Plumber', services: ['drain'] });
  assert.equal(clean.requiresExplicitApproval, true);
  assert.equal(clean.valid, true);
  const stuffed = validateBusinessName('Mulsetu', 'Best Plumber Nashik Nashik', { city: 'Nashik', category: 'Plumber' });
  assert.equal(stuffed.valid, false);
  assert.ok(stuffed.violations.some((v) => v.code === 'promo' || v.code === 'city' || v.code === 'category'));
});

test('hours, links, service area, and pin', () => {
  assert.equal(validateRegularHours([{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: '09:00', closeTime: '17:00' }]).valid, true);
  assert.equal(validateRegularHours([{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: '17:00', closeTime: '09:00' }]).valid, false);
  assert.equal(validateRegularHours([
    { openDay: 'MONDAY', closeDay: 'MONDAY', openTime: '09:00', closeTime: '12:00' },
    { openDay: 'MONDAY', closeDay: 'MONDAY', openTime: '11:00', closeTime: '15:00' },
  ]).valid, false);
  assert.equal(validateSpecialHours([{ startDate: '2026-10-20', closed: true }]).valid, true);
  assert.equal(validateSpecialHours([{ startDate: '20-10-2026', closed: true }]).valid, false);
  const utm = withGbpUtm('https://example.com/service?ref=1&utm_source=newsletter');
  assert.equal(utm.ok, true);
  assert.match(utm.url || '', /utm_source=newsletter/);
  assert.match(utm.url || '', /utm_medium=organic/);
  assert.equal((utm.url || '').split('utm_source=').length, 2);
  const area = validateServiceArea({
    businessType: 'CUSTOMER_LOCATION_ONLY',
    places: [{ placeId: 'ChIJexample1', placeName: 'Nashik' }, { placeId: 'ChIJexample1', placeName: 'Nashik' }],
  });
  assert.equal(area.valid, false);
  assert.equal(validateServiceArea({ businessType: 'STOREFRONT', places: [{ placeId: 'ChIJexample1', placeName: 'Nashik' }] }).valid, false);
  assert.equal(validateServiceArea({
    businessType: 'CUSTOMER_LOCATION_ONLY',
    places: Array.from({ length: 21 }, (_, i) => ({ placeId: `ChIJexample${i}xxxx`, placeName: `Area ${i}` })),
  }).valid, false);
  const here = { lat: 19.99, lng: 73.78 };
  assert.equal(comparePin(here, here, 0).status, 'MATCH');
  const far = haversineMeters(here, { lat: 20.02, lng: 73.78 });
  assert.ok(far > 250);
  assert.equal(comparePin(here, { lat: 20.02, lng: 73.78 }, far).status, 'MISMATCH');
  assert.equal(comparePin(null, null, null).status, 'UNKNOWN');
  assert.equal(holidayReminders([], null, '2026-10-08T00:00:00.000Z').status, 'NOT_CONFIGURED');
});

test('categories, services, attributes, and products do not invent unsupported data', () => {
  const rec = recommendCategories({
    businessName: 'Mulsetu',
    currentPrimary: { name: 'categories/gcid:local_business', displayName: 'Local business' },
    currentAdditional: [],
    competitors: [
      { name: 'Mulsetu', primaryCategory: 'Ignore me', additionalCategories: [] },
      { name: 'A', primaryCategory: 'Plumber', additionalCategories: ['Drain'] },
      { name: 'B', primaryCategory: 'Plumber', additionalCategories: ['Drain'] },
      { name: 'C', primaryCategory: 'Electrician', additionalCategories: ['Drain'] },
    ],
    services: ['Emergency plumber'],
    catalog: [{ name: 'categories/gcid:plumber', displayName: 'Plumber' }],
  });
  assert.equal(rec.primary?.categoryName, 'categories/gcid:plumber');
  assert.equal(rec.primary?.autoApply, false);
  assert.equal(rec.additional.some((c) => c.displayName === 'Drain' && c.executable === false), true);
  assert.equal(proposeServices({ existing: [], verified: ['Drain'], category: 'Plumber', city: 'Nashik', canModify: false }).blocked, true);
  assert.equal(suggestUnsetAttributes(null, []).available, false);
  assert.equal(suggestUnsetAttributes([{ name: 'attributes/has_wifi', displayName: 'Wi-Fi', valueType: 'BOOL' }], []).suggestions[0].executable, false);
  assert.equal(PRODUCTS_SUPPORT.supported, false);
});

test('read-back is verified only when the canonical value matches the proposal', () => {
  const before = 'Old description';
  const proposed = 'Mulsetu is a plumber in Nashik.';
  assert.equal(classifyReadBack('description', before, proposed, 'A different sentence from Google.'), 'CONFLICT');
  assert.equal(classifyReadBack('description', before, proposed, before), 'FAILED');
  assert.equal(classifyReadBack('description', before, proposed, proposed), 'VERIFIED');
  assert.equal(canonicalFingerprint('description', ''), canonicalFingerprint('description', null));
  assert.equal(canonicalFingerprint('description', '  '), canonicalFingerprint('description', undefined));
  assert.notEqual(canonicalFingerprint('description', ''), canonicalFingerprint('description', proposed));

  const wifi = { name: 'attributes/has_wifi', attribute: { name: 'attributes/has_wifi', valueType: 'BOOL', values: [true] } };
  assert.equal(classifyReadBack('attribute', null, wifi, { name: 'attributes/has_wifi', values: [false], displayName: 'Wi-Fi' }), 'CONFLICT');
  assert.equal(classifyReadBack('attribute', null, wifi, { name: 'attributes/has_wifi', values: [true], displayName: 'Wi-Fi' }), 'VERIFIED');

  const category = { primaryCategory: { name: 'categories/gcid:plumber' }, additionalCategories: [] };
  const withLabel = { primaryCategory: { name: 'categories/gcid:plumber', displayName: 'Plumber' }, additionalCategories: [] };
  const other = { primaryCategory: { name: 'categories/gcid:electrician', displayName: 'Plumber' }, additionalCategories: [] };
  assert.equal(classifyReadBack('primary_category', { primaryCategory: { name: 'categories/gcid:local_business', displayName: 'Local business' }, additionalCategories: [] }, category, withLabel), 'VERIFIED');
  assert.equal(classifyReadBack('primary_category', category, category, other), 'CONFLICT');

  const hours = {
    regularHours: { periods: [{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: { hours: 9, minutes: 0 }, closeTime: { hours: 17, minutes: 0 } }] },
    specialHours: { specialHourPeriods: [] },
  };
  const omittedZero = {
    regularHours: { periods: [{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: { hours: 9 }, closeTime: { hours: 17 } }] },
    specialHours: null,
  };
  const laterClose = {
    regularHours: { periods: [{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: { hours: 9 }, closeTime: { hours: 18 } }] },
    specialHours: null,
  };
  assert.equal(classifyReadBack('hours', { regularHours: null, specialHours: null }, hours, omittedZero), 'VERIFIED');
  assert.equal(classifyReadBack('hours', hours, hours, laterClose), 'CONFLICT');
});

test('a failed read-back does not patch twice, and a location change refuses the write', async () => {
  let patches = 0;
  const missed = await applyAndVerify({
    kind: 'description',
    before: '',
    proposed: 'Mulsetu is a plumber in Nashik.',
    patch: async () => { patches += 1; return { ok: true }; },
    read: async () => { throw new Error('read failed'); },
  });
  assert.equal(patches, 1);
  assert.equal(missed.status, 'UNRESOLVED');

  const stored = 'accounts/1/locations/111';
  const other = 'accounts/1/locations/222';
  assert.equal(locationGuard(stored, other).ok, false);
  assert.equal(locationGuard(stored, 'locations/111').ok, true);
  let rollbackPatches = 0;
  const guard = locationGuard(stored, other);
  if (guard.ok) rollbackPatches += 1;
  assert.equal(rollbackPatches, 0);
  assert.equal(rollbackRecheck('verified-fp', 'someone-else'), 'conflict');
  assert.equal(rollbackRecheck('verified-fp', 'verified-fp'), 'patch');
  assert.equal(canRollbackAttribute(null), false);
  assert.equal(canRollbackAttribute({ name: 'attributes/has_wifi', values: [true] }), true);
  assert.equal(idempotencyResult({ kind: 'description', proposed: 'Same text' }, { kind: 'description', proposed: 'Same text' }), 'reuse');
  assert.equal(idempotencyResult({ kind: 'description', proposed: 'Same text' }, { kind: 'description', proposed: 'Different text' }), 'conflict');
});

test('short links are rejected and numbers stay strict', () => {
  const tokens = ['spa', 'goa'];
  assert.equal(validateDescription('Mulsetu is a spa in Goa. Book at bit.ly/drain', { tokens }).containsUrl, true);
  assert.equal(validateDescription('Mulsetu is a spa in Goa. Message wa.me/9198', { tokens }).containsUrl, true);
  assert.equal(validateDescription('Mulsetu is a spa in Goa and has served homes since 2015.', { tokens }).unsupportedClaims, true);
  assert.equal(validateDescription('Mulsetu is a spa in Goa and has served homes since 2015.', { tokens, allowedNumbers: ['2015'] }).valid, true);
  assert.equal(validateDescription('The number one spa in Goa.', { tokens }).promotionalLanguage, true);
});

test('service and hours payloads stay in Google\'s shape', () => {
  const hours = toGoogleHours({
    regular: [{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: '09:00', closeTime: '17:00' }],
    special: [{ startDate: '2026-10-20', closed: true }],
  });
  assert.deepEqual(hours.regularHours.periods[0].openTime, { hours: 9, minutes: 0 });
  assert.deepEqual(hours.specialHours.specialHourPeriods[0].startDate, { year: 2026, month: 10, day: 20 });
  const services = buildServiceWrite({
    existing: [],
    additions: [{ name: 'Drain cleaning', description: 'Clears a blocked drain.' }],
    categoryName: 'categories/gcid:plumber',
  });
  assert.equal(services.valid, true);
  assert.equal((services.items[0] as any).freeFormServiceItem.category, 'categories/gcid:plumber');
  assert.equal(buildServiceWrite({ existing: [], additions: [{ name: 'Drain' }], categoryName: null }).valid, false);
  const wifi = buildAttributeWrite({ name: 'attributes/has_wifi', valueType: 'BOOL' }, true);
  assert.equal(wifi.valid, true);
  assert.deepEqual((wifi.attribute as { values?: boolean[] } | null)?.values, [true]);
  assert.equal(buildAttributeWrite({ name: 'attributes/has_wifi', valueType: 'BOOL' }, 'yes').valid, false);
  const menu = buildAttributeWrite({ name: 'attributes/url_menu', valueType: 'URL' }, 'https://example.com/menu?ref=1');
  const menuUri = (menu.attribute as { uriValues?: Array<{ uri: string }> } | null)?.uriValues?.[0]?.uri || '';
  assert.match(menuUri, /utm_campaign=gbp/);
});

test('FR-5 execution and rollback patch only when both live-write flags are exactly true', async () => {
  const blocked: Array<Record<string, string | undefined>> = [
    { GBP_LIVE_WRITES_ENABLED: 'true' },
    { GBP_LIVE_WRITES_ENABLED: 'true', GBP_FR5_LIVE_WRITES_ENABLED: 'false' },
    { GBP_LIVE_WRITES_ENABLED: 'true', GBP_FR5_LIVE_WRITES_ENABLED: 'TRUE' },
    { GBP_LIVE_WRITES_ENABLED: 'false', GBP_FR5_LIVE_WRITES_ENABLED: 'true' },
    { GBP_LIVE_WRITES_ENABLED: 'true', GBP_FR5_LIVE_WRITES_ENABLED: ' true' },
  ];
  for (const env of blocked) {
    let patches = 0;
    const result = await fr5GuardedPatch(env, async () => { patches += 1; return 'sent'; });
    assert.equal(patches, 0);
    assert.equal(result.applied, false);
    assert.equal(fr5ProfileMutationAllowed(env), false);
  }

  assert.equal(executionClaim('PROPOSED'), 'not_approved');
  assert.equal(locationGuard('locations/111', 'locations/222').ok, false);
  const sensitive = approve({ ...base(), kind: 'title', sensitive: true }, { userId: 'u', businessId: 'biz' }, { now: '2026-10-09T00:00:00.000Z' });
  assert.equal(sensitive.ok, false);

  let patches = 0;
  const allowed = await fr5GuardedPatch(
    { GBP_LIVE_WRITES_ENABLED: 'true', GBP_FR5_LIVE_WRITES_ENABLED: 'true' },
    async () => { patches += 1; return 'sent'; },
  );
  assert.equal(patches, 1);
  assert.equal(allowed.applied, true);
});

test('an unresolved recovery reads Google and does not patch when the FR-5 flag is off', async () => {
  let patches = 0;
  let reads = 0;
  const env = { GBP_LIVE_WRITES_ENABLED: 'true', GBP_FR5_LIVE_WRITES_ENABLED: 'false' };
  assert.equal(fr5ProfileMutationAllowed(env), false);
  const readBack = await (async () => { reads += 1; return 'Mulsetu is a plumber in Nashik.'; })();
  const gated = await fr5GuardedPatch(env, async () => { patches += 1; return 'sent'; });
  assert.equal(gated.applied, false);
  assert.equal(classifyReadBack('description', 'Old description', readBack, readBack), 'VERIFIED');
  assert.equal(reads, 1);
  assert.equal(patches, 0);

  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const store = readFileSync(join(root, 'src/services/gbp/changes/store.ts'), 'utf8');
  const executeAt = store.indexOf('export async function executeChange');
  const unresolvedAt = store.indexOf("pending.status === 'UNRESOLVED'", executeAt);
  const gateAt = store.indexOf('fr5ProfileMutationAllowed()', executeAt);
  assert.ok(unresolvedAt > executeAt && gateAt > unresolvedAt);
  const recovery = store.slice(store.indexOf('async function recoverUnresolved'), executeAt);
  assert.equal(recovery.includes('fr5ProfileMutationAllowed'), false);
  assert.equal(recovery.includes('patchLocation'), false);
  assert.equal(recovery.includes('updateLocationProfile'), false);
  assert.equal(store.includes("if (!fr5ProfileMutationAllowed()) throw new WriteNotAccepted"), true);
});

test('apply with live writes off is refused before the claim and leaves the approval in place', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const store = readFileSync(join(root, 'src/services/gbp/changes/store.ts'), 'utf8');
  const executeAt = store.indexOf('export async function executeChange');
  const execute = store.slice(executeAt, store.indexOf('async function restorePrevious', executeAt));
  const gateAt = execute.indexOf("pending.status === 'APPROVED' && !fr5ProfileMutationAllowed()");
  const claimAt = execute.indexOf("$set: { status: 'EXECUTING'");
  assert.ok(gateAt > 0 && claimAt > gateAt, 'the writes-off check runs before the EXECUTING claim');
  assert.match(execute.slice(gateAt, claimAt), /return \{ ok: false as const, error: LIVE_WRITES_DISABLED, change: pending \}/);
  // Writes switched off mid-request: the claim is released back to APPROVED, never BLOCKED.
  assert.equal(/failClosed\([^)]*'BLOCKED', 'Live Google writes are disabled\.'/.test(store), false);
  assert.match(execute, /claimed\.status = 'APPROVED';\s*claimed\.executedAt = pending\.executedAt \?\? null;/);
  // Rollback with writes off still refuses without touching the record.
  const rollback = store.slice(store.indexOf('export async function rollbackChange'));
  assert.ok(rollback.indexOf('if (!fr5ProfileMutationAllowed()) return { ok: false as const, error: LIVE_WRITES_DISABLED }') < rollback.indexOf("$set: { status: 'EXECUTING' }"));
});

test('a changed Google description conflicts before any patch', async () => {
  const before = 'Mulsetu is a software company in Ojhar.';
  const proposed = 'Mulsetu is a software company in Ojhar';
  const beforeFingerprint = canonicalFingerprint('description', before);
  const changedOnGoogle = `${before} Edited elsewhere.`;
  let patches = 0;

  assert.equal(staleFieldDecision(beforeFingerprint, canonicalFingerprint('description', changedOnGoogle)), 'conflict');
  const closed = failClosed(
    { ...base(), before, proposed, beforeFingerprint, status: 'EXECUTING' },
    'CONFLICT',
    'Google changed this field after the proposal was created.',
    '2026-10-09T00:00:00.000Z',
  );
  assert.equal(closed.status, 'CONFLICT');
  assert.equal(closed.after, null);
  assert.equal(patches, 0);

  assert.equal(staleFieldDecision(beforeFingerprint, canonicalFingerprint('description', before)), 'ok');
  const written = await applyAndVerify({
    kind: 'description',
    before,
    proposed,
    patch: async () => { patches += 1; return { ok: true }; },
    read: async () => proposed,
  });
  assert.equal(written.status, 'VERIFIED');
  assert.equal(patches, 1);

  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const store = readFileSync(join(root, 'src/services/gbp/changes/store.ts'), 'utf8');
  const executeAt = store.indexOf('export async function executeChange');
  const rollbackAt = store.indexOf('export async function rollbackChange');
  const executeBody = store.slice(executeAt, rollbackAt);
  const staleAt = executeBody.indexOf('staleFieldDecision(');
  const applyAt = executeBody.indexOf('applyAndVerify(');
  assert.ok(staleAt > 0 && applyAt > staleAt);
  assert.equal(executeBody.slice(0, applyAt).includes('writeKind('), false);
  assert.equal(executeBody.slice(0, applyAt).includes('patchLocation'), false);
  assert.equal(executeBody.slice(0, applyAt).includes('updateLocationProfile'), false);
});

test('rollback patches the recorded before-value only while the verified value is still live', async () => {
  const before = 'Original description.';
  const after = 'Original description';
  const afterFingerprint = canonicalFingerprint('description', after);
  const record = {
    ...base(),
    status: 'VERIFIED' as const,
    before,
    proposed: after,
    after,
    beforeFingerprint: canonicalFingerprint('description', before),
    afterFingerprint,
  };
  let patches = 0;
  let patched: unknown = null;

  const changed = rollbackRecheck(afterFingerprint, canonicalFingerprint('description', 'A different Google description.'));
  patches += changed === 'patch' ? 1 : 0;
  assert.equal(changed, 'conflict');
  assert.equal(rollbackDecision(record, canonicalFingerprint('description', 'A different Google description.')), 'conflict');
  assert.equal(patches, 0);

  const stillVerified = rollbackRecheck(afterFingerprint, canonicalFingerprint('description', after));
  assert.equal(stillVerified, 'patch');
  const restored = await applyAndVerify({
    kind: 'description',
    before: after,
    proposed: before,
    patch: async () => { patches += 1; patched = before; return { ok: true }; },
    read: async () => before,
  });
  assert.equal(patched, before);
  assert.equal(restored.status, 'VERIFIED');
  assert.equal(canonicalFingerprint('description', restored.after), record.beforeFingerprint);
  const reverted = markReverted(record, 'user', restored.googleBody, '2026-10-09T00:00:00.000Z');
  assert.equal(reverted.status, 'REVERTED');
  assert.equal(reverted.after, before);
  assert.equal(reverted.rollbackStatus, 'REVERTED');

  const ambiguous = await applyAndVerify({
    kind: 'description',
    before: after,
    proposed: before,
    patch: async () => { patches += 1; return { ok: true }; },
    read: async () => 'neither the verified text nor the original',
  });
  assert.equal(ambiguous.status, 'CONFLICT');
  assert.notEqual(ambiguous.status, 'VERIFIED');

  const unread = await applyAndVerify({
    kind: 'description',
    before: after,
    proposed: before,
    patch: async () => { patches += 1; return { ok: true }; },
    read: async () => { throw new Error('read failed'); },
  });
  assert.equal(unread.status, 'UNRESOLVED');
  assert.match(unread.error || '', /not retried/);

  const unchanged = await applyAndVerify({
    kind: 'description',
    before: after,
    proposed: before,
    patch: async () => { patches += 1; return { ok: true }; },
    read: async () => after,
  });
  assert.equal(unchanged.status, 'FAILED');
  assert.equal(patches, 4);
  for (const outcome of [ambiguous, unread, unchanged]) {
    assert.notEqual(outcome.status, 'VERIFIED');
  }

  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const store = readFileSync(join(root, 'src/services/gbp/changes/store.ts'), 'utf8');
  const restoreAt = store.indexOf('async function restorePrevious');
  const rollbackAt = store.indexOf('export async function rollbackChange');
  const restoreBody = store.slice(restoreAt, rollbackAt);
  const verifiedAt = restoreBody.indexOf("outcome.status === 'VERIFIED'");
  const revertedAt = restoreBody.indexOf('markReverted(');
  assert.ok(verifiedAt > 0 && revertedAt > verifiedAt);
  assert.equal(restoreBody.includes('writeKind(actor.businessId, claimed.kind, claimed.before)'), true);
  const rollbackBody = store.slice(rollbackAt);
  const recheckAt = rollbackBody.indexOf('rollbackRecheck(');
  const restoreCallAt = rollbackBody.indexOf('return restorePrevious(');
  assert.ok(recheckAt > 0 && restoreCallAt > recheckAt);
});

test('attribute batches validate each row and do not treat a partial failure as success', () => {
  const catalog = [
    { name: 'attributes/has_wifi', valueType: 'BOOL' },
    { name: 'attributes/pay_credit_card_types_accepted', valueType: 'ENUM', allowedValues: ['visa', 'mastercard'] },
    { name: 'attributes/url_menu', valueType: 'URL' },
  ];
  const batch = planAttributeBatch(catalog, [
    { name: 'attributes/has_wifi', value: true },
    { name: 'attributes/pay_credit_card_types_accepted', value: 'bitcoin' },
    { name: 'attributes/url_menu', value: 'https://example.com/menu?utm_medium=email' },
    { name: 'attributes/url_menu', value: 'https://example.com/other' },
    { name: 'attributes/not_listed', value: true },
  ]);
  assert.equal(batch.results[0].valid, true);
  assert.equal(batch.results[1].valid, false);
  assert.match(batch.results[1].violations[0].message, /not one of the values/);
  assert.equal(batch.results[2].valid, true);
  assert.match(JSON.stringify(batch.results[2].attribute), /utm_medium=email/);
  assert.match(JSON.stringify(batch.results[2].attribute), /utm_source=google/);
  assert.equal((JSON.stringify(batch.results[2].attribute).match(/utm_medium=/g) || []).length, 1);
  assert.equal(batch.results[3].valid, false);
  assert.equal(batch.results[3].violations[0].code, 'duplicate');
  assert.equal(batch.results[4].valid, false);
  assert.equal(batch.results.every((row) => row.valid), false);
  assert.equal(planAttributeBatch(null, [{ name: 'attributes/has_wifi', value: true }]).results[0].violations[0].code, 'catalog');
  assert.equal(buildAttributeWrite({ name: 'attributes/pay_credit_card_types_accepted', valueType: 'ENUM', allowedValues: ['visa'] }, 'visa').valid, true);
});

test('holiday reminders use the configured calendar and do not invent dates', () => {
  assert.equal(holidayCalendarFor('US'), null);
  assert.equal(holidayCalendarFor(null), null);
  const india = holidayCalendarFor('IN');
  assert.ok(india?.some((holiday) => holiday.date === '2026-01-26' && holiday.name === 'Republic Day'));
  assert.equal(india?.some((holiday) => /tentative/i.test(holiday.name)), false);
  assert.equal(holidayReminders([], null, '2026-10-10T12:00:00.000Z').status, 'NOT_CONFIGURED');
  const reminders = holidayReminders([{ startDate: '2026-10-20' }], india, '2026-10-10T12:00:00.000Z');
  assert.equal(reminders.status, 'READY');
  assert.equal(reminders.reminders.some((row) => row.date === '2026-10-20' && row.covered), true);
  assert.equal(reminders.reminders.some((row) => row.date === '2026-01-26'), false);
  assert.equal(reminders.reminders.some((row) => row.date === '2026-11-08'), true);
  assert.equal(reminders.reminders.some((row) => row.date === '2026-12-25'), false);
  assert.equal(calendarDate('Asia/Kolkata', new Date('2026-10-09T20:00:00.000Z')), '2026-10-10');
  assert.equal(calendarDate('Asia/Kolkata', new Date('2026-10-09T18:00:00.000Z')), '2026-10-09');
  assert.equal(calendarDate('Not/A/Zone', new Date('2026-10-10T00:00:00.000Z')), null);
  assert.equal(calendarDate('', new Date('2026-10-10T00:00:00.000Z')), null);
});

test('a service can recommend a resolved category without becoming an automatic primary change', () => {
  const rec = recommendCategories({
    businessName: 'Mulsetu',
    currentPrimary: { name: 'categories/gcid:software_company', displayName: 'Software company' },
    currentAdditional: [],
    competitors: [],
    services: ['Website designer'],
    catalog: [{ name: 'categories/gcid:software_company', displayName: 'Software company' }, { name: 'categories/gcid:website_designer', displayName: 'Website designer' }],
  });
  assert.equal(rec.primary, null);
  const extra = rec.additional.find((row) => row.displayName === 'Website designer');
  assert.equal(extra?.executable, true);
  assert.equal(extra?.autoApply, false);
  assert.equal(extra?.categoryName, 'categories/gcid:website_designer');
});

test('bulk attribute storage and product publishing stay outside the Google write path', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const route = readFileSync(join(root, 'src/app/api/gbp/changes/attributes/route.ts'), 'utf8');
  assert.equal(route.includes('proposeAttributeBatch('), true);
  const storeSource = readFileSync(join(root, 'src/services/gbp/changes/store.ts'), 'utf8');
  const batch = storeSource.slice(storeSource.indexOf('export async function proposeAttributeBatch'), storeSource.indexOf('export async function approveChange'));
  assert.equal(batch.includes('createProposal('), true);
  for (const write of ['patchLocation', 'updateLocationProfile', 'executeChange', 'approveChange(']) assert.equal(batch.includes(write), false, write);
  assert.equal(route.includes('patchLocation'), false);
  assert.equal(route.includes('updateLocationProfile'), false);
  assert.equal(route.includes('executeChange'), false);
  assert.equal(route.includes('liveWriteApplied: false'), true);
  const client = readFileSync(join(root, 'src/lib/gbpClient.ts'), 'utf8');
  assert.equal(client.includes('/products'), false);
  assert.equal(PRODUCTS_SUPPORT.supported, false);
});

test('posts, review replies, and photos stay on the global write gate', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const files = [
    'src/services/reviews/postReply.ts',
    'src/services/content/publishPost.ts',
    'src/lib/gbpMediaService.ts',
    'src/lib/gbpClient.ts',
  ];
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    assert.equal(source.includes('GBP_FR5_LIVE_WRITES_ENABLED'), false, file);
    assert.equal(source.includes('fr5ProfileMutationAllowed'), false, file);
    assert.equal(source.includes('gbpWritesEnabled'), true, file);
  }
});
