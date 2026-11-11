/**
 * Growth Partner KYC — pure rules + file encryption.
 * Run: node --experimental-strip-types --test tests/integration/growth-partner-kyc.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  isValidAadhaar,
  maskLast4,
  missingDocs,
  normalizeGstin,
  normalizeIfsc,
  normalizePan,
  requiredDocKinds,
  sniffKycFileType,
  validateKycSubmission,
} from '../../src/lib/partners/kycRules.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// A Verhoeff-valid test number (not a real person's): computed below.
function withVerhoeff(base11: string): string {
  for (let d = 0; d <= 9; d++) if (isValidAadhaar(base11 + d)) return base11 + d;
  throw new Error('no check digit');
}
const AADHAAR = withVerhoeff('23456789012');

const BANK = { accountHolderName: 'Asha Verma', accountNumber: '123456789012', confirmAccountNumber: '123456789012', ifsc: 'hdfc0001234', bankName: 'HDFC Bank', accountType: 'savings' };

const INDIVIDUAL = {
  entityType: 'individual',
  legalName: 'Asha Verma',
  address: '12 MG Road, Kothrud, Pune',
  pincode: '411038',
  pan: 'abcpv1234k',
  aadhaar: AADHAAR.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3'),
  bank: BANK,
};

const COMPANY = {
  entityType: 'company',
  legalName: 'Bright Local Media Pvt Ltd',
  companyType: 'private_limited',
  gstin: '27AABCB1234C1Z5',
  address: 'Office 4, Baner Road, Pune',
  pincode: '411045',
  pan: 'AABCB1234C',
  bank: { ...BANK, accountType: 'current', accountHolderName: 'Bright Local Media Pvt Ltd' },
};

test('identifiers: PAN, GSTIN, IFSC normalise and validate', () => {
  assert.equal(normalizePan(' abcde 1234f '), 'ABCDE1234F');
  assert.equal(normalizePan('ABCD1234F'), null);
  assert.equal(normalizeGstin('27aabcb1234c1z5'), '27AABCB1234C1Z5');
  assert.equal(normalizeGstin('27AABCB1234C1X5'), null);
  assert.equal(normalizeIfsc('hdfc0001234'), 'HDFC0001234');
  assert.equal(normalizeIfsc('HDFC1001234'), null); // 5th char must be 0
});

test('aadhaar: Verhoeff checksum, 12 digits, cannot start with 0/1', () => {
  assert.ok(isValidAadhaar(AADHAAR));
  const wrong = AADHAAR.slice(0, 11) + String((Number(AADHAAR[11]) + 1) % 10);
  assert.equal(isValidAadhaar(wrong), false);
  assert.equal(isValidAadhaar('123456789012'.replace(/^./, '1')), false);
  assert.equal(isValidAadhaar('2345678901'), false);
  assert.equal(isValidAadhaar({ $gt: '' } as any), false);
});

test('individual: valid, keeps only Aadhaar last 4, normalises PAN/IFSC', () => {
  const r = validateKycSubmission(INDIVIDUAL);
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (!r.ok) return;
  assert.equal(r.value.pan, 'ABCPV1234K');
  assert.equal(r.value.aadhaarLast4, AADHAAR.slice(-4));
  assert.ok(!JSON.stringify(r.value).includes(AADHAAR), 'full Aadhaar never leaves the validator');
  assert.equal(r.value.bank.ifsc, 'HDFC0001234');
  assert.equal(r.value.companyType, null);
  assert.equal(r.value.gstin, null);
});

test('individual: needs a personal PAN and a valid Aadhaar', () => {
  assert.equal(validateKycSubmission({ ...INDIVIDUAL, pan: 'AABCB1234C' }).ok, false);
  assert.equal(validateKycSubmission({ ...INDIVIDUAL, aadhaar: '' }).ok, false);
});

test('company: valid; GSTIN must contain the PAN; no personal PAN unless proprietorship', () => {
  assert.ok(validateKycSubmission(COMPANY).ok);
  const mismatch = validateKycSubmission({ ...COMPANY, gstin: '27AABCX1234C1Z5' });
  assert.ok(!mismatch.ok && /does not match/.test(mismatch.error));
  assert.equal(validateKycSubmission({ ...COMPANY, gstin: '', pan: 'ABCPV1234K' }).ok, false);
  assert.ok(validateKycSubmission({ ...COMPANY, gstin: '', pan: 'ABCPV1234K', companyType: 'proprietorship' }).ok);
  assert.ok(validateKycSubmission({ ...COMPANY, gstin: '' }).ok, 'GSTIN is optional');
});

test('bank: account numbers must match and be 9–18 digits', () => {
  assert.equal(validateKycSubmission({ ...INDIVIDUAL, bank: { ...BANK, confirmAccountNumber: '123456789013' } }).ok, false);
  assert.equal(validateKycSubmission({ ...INDIVIDUAL, bank: { ...BANK, accountNumber: '1234', confirmAccountNumber: '1234' } }).ok, false);
  assert.equal(validateKycSubmission({ ...INDIVIDUAL, bank: { ...BANK, accountType: 'nre' } }).ok, false);
});

test('documents: required set depends on entity type and GSTIN', () => {
  assert.deepEqual(requiredDocKinds('individual', false), ['pan_card', 'aadhaar_front', 'aadhaar_back', 'cancelled_cheque']);
  assert.deepEqual(requiredDocKinds('company', false), ['pan_card', 'registration_certificate', 'cancelled_cheque']);
  assert.ok(requiredDocKinds('company', true).includes('gst_certificate'));
  assert.deepEqual(missingDocs('company', true, ['pan_card', 'cancelled_cheque']), ['registration_certificate', 'gst_certificate']);
});

test('file sniffing: real type from bytes, not the browser label', () => {
  assert.equal(sniffKycFileType(Buffer.from('%PDF-1.7')), 'application/pdf');
  assert.equal(sniffKycFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffKycFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffKycFileType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffKycFileType(Buffer.from('<svg onload=alert(1)>')), null);
  assert.equal(sniffKycFileType(Buffer.from('<html>')), null);
});

test('masking shows only the last 4', () => {
  assert.equal(maskLast4('1234', 10), 'XXXXXX1234');
  assert.equal(maskLast4(null), '');
});

test('file encryption round-trips and is not plaintext', async () => {
  process.env.GOOGLE_TOKEN_SECRET = crypto.randomBytes(32).toString('hex');
  const { encryptBuffer, decryptBuffer } = await import('../../src/lib/crypto.ts');
  const plain = Buffer.from('%PDF-1.7 Aadhaar card scan');
  const enc = encryptBuffer(plain);
  assert.ok(!enc.includes(Buffer.from('Aadhaar')));
  assert.deepEqual(decryptBuffer(enc), plain);
  const tampered = Buffer.from(enc);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptBuffer(tampered));
});

test('storage: PAN and account number are stored encrypted; partner view never decrypts', () => {
  const src = read('src/services/partners/partnerKyc.ts');
  assert.match(src, /'kyc\.panEncrypted': encrypt\(v\.pan\)/);
  assert.match(src, /accountNumberEncrypted: encrypt\(v\.bank\.accountNumber\)/);
  assert.match(src, /uploadPrivateObject\(encryptBuffer\(bytes\)/);
  const partnerView = src.slice(src.indexOf('export function partnerKycView'), src.indexOf('async function logAction'));
  assert.doesNotMatch(partnerView, /decrypt/);
  // The admin partners list never ships KYC fields.
  assert.match(read('src/app/api/admin/growth-partners/route.ts'), /select\('-termsHistory -kyc'\)/);
});
