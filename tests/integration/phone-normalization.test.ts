/**
 * Unit test for phone normalization (src/lib/phone.ts).
 *
 * Pure-function test — no DB, no server, no `@/` path aliases — so it runs
 * under `node --test` directly (see admin-invite-accept.test.ts's header for
 * why the alias-heavy route code can't be imported the same way).
 *
 * Why this matters beyond lib coverage: the LEAD_ENGINE_V2 cohort lookup in
 * runSalesFollowUpDrip and the shadow-ownership observer both resolve a Lead
 * by `normalizePhoneE164(x)`. If two spellings of the same real number
 * normalize differently, an allowlisted lead silently falls back to the
 * legacy path (or a stored Lead is never found). These cases lock in that
 * every accepted spelling of one Indian number collapses to one E.164 string.
 *
 * Run with: node --test tests/integration/phone-normalization.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Explicit `.ts` extension: Node's ESM loader (v24, type-stripping) needs a
// real on-disk path, and tsc accepts this because tsconfig sets
// `allowImportingTsExtensions` (safe here — the project is noEmit).
import { normalizePhoneE164, phoneDedupeKey } from '../../src/lib/phone.ts';

test('all accepted spellings of one Indian mobile normalize to the same E.164', () => {
  const canonical = '+919876543210';
  const spellings = [
    '+919876543210',
    '919876543210',
    '9876543210',
    '09876543210',
    '+91 98765 43210',
    '+91-98765-43210',
    ' +91 (98765) 43210 ',
    '0091 9876543210',
  ];
  for (const s of spellings) {
    assert.equal(normalizePhoneE164(s), canonical, `"${s}" should normalize to ${canonical}`);
  }
});

test('non-India country codes are trusted as given', () => {
  assert.equal(normalizePhoneE164('+14155552671'), '+14155552671');
  assert.equal(normalizePhoneE164('+442071838750'), '+442071838750');
  assert.equal(normalizePhoneE164('0044 20 7183 8750'), '+442071838750');
});

test('ambiguous / invalid inputs return null (never a guessed number)', () => {
  for (const bad of ['', '   ', 'not-a-phone', '12345', '98765', '+12', '98765432101234567890']) {
    assert.equal(normalizePhoneE164(bad), null, `"${bad}" should be rejected`);
  }
});

test('a bare 11-digit national string without + is ambiguous and rejected', () => {
  // "98765432100" is 11 digits, no +, doesn't start with 91 as a country
  // code prefix on a 10-digit body — the helper refuses to guess.
  assert.equal(normalizePhoneE164('98765432100'), null);
});

test('phoneDedupeKey collapses the same number across spellings', () => {
  const key = phoneDedupeKey('+91 98765 43210');
  assert.equal(key, '9876543210');
  assert.equal(phoneDedupeKey('09876543210'), key);
  assert.equal(phoneDedupeKey('919876543210'), key);
  assert.equal(phoneDedupeKey('whatsapp:+919876543210'.replace(/\D/g, '')), key);
});

test('phoneDedupeKey rejects too-short input', () => {
  assert.equal(phoneDedupeKey('12345'), null);
  assert.equal(phoneDedupeKey(''), null);
  assert.equal(phoneDedupeKey(null), null);
  assert.equal(phoneDedupeKey(undefined), null);
});
