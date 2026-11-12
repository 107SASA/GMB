/**
 * Visiting-card scan — pure rules (AI output sanitizing, fallback decision,
 * image-key ownership, new lead source).
 * Run: node --experimental-strip-types --test tests/integration/business-card-scan.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLAN_DEFAULTS } from '../../src/lib/planDefaults.ts';
import {
  isEmptyExtraction,
  isOwnCardImageKey,
  isValidClientScanId,
  leadFromCard,
  needsFallback,
  pickCardModels,
  sanitizeCardExtraction,
  tiledSharpness,
} from '../../src/services/crm/businessCardParse.ts';
import { canonicalSource, ORGANIC_SOURCES } from '../../src/services/crm/sources.ts';

// Minimal stand-in for lib/phone.ts normalizePhoneE164 (India default).
const norm = (s: string) => {
  const d = s.replace(/\D/g, '').replace(/^0+/, '');
  if (s.trim().startsWith('+')) return d.length >= 8 ? `+${d}` : null;
  return d.length === 10 ? `+91${d}` : null;
};

test('sanitize: typical Indian card — mobile first, deduped, emails lowercased, website cleaned', () => {
  const f = sanitizeCardExtraction(
    {
      isBusinessCard: true,
      name: '  Rajesh   Kumar ',
      designation: 'Sales Head',
      company: 'ABC Pvt Ltd',
      phones: [
        { number: '011-2345 6789', label: 'office' },
        { number: '+91 98765 43210', label: 'mobile' },
        { number: '98765-43210', label: 'whatsapp' }, // same number as the mobile
      ],
      emails: ['Rajesh@ABC.in', 'not-an-email'],
      website: 'https://www.ABC.in/',
      address: 'Plot 5, Sector 18, Noida',
      city: 'Noida',
      uncertain: ['website', 'bogus'],
    },
    norm,
  );
  assert.equal(f.name, 'Rajesh Kumar');
  assert.equal(f.phones[0].number, '+919876543210');
  assert.equal(f.phones[0].label, 'mobile');
  assert.equal(f.phones.length, 2);
  assert.equal(f.phones[1].label, 'office');
  assert.deepEqual(f.emails, ['rajesh@abc.in']);
  assert.equal(f.website, 'www.abc.in');
  assert.deepEqual(f.uncertain, ['website']);
  assert.equal(needsFallback(f), false);
});

test('sanitize: garbage input never throws and yields an empty, fallback-worthy result', () => {
  for (const raw of [null, 'x', 42, { phones: 'nope', emails: {} }]) {
    const f = sanitizeCardExtraction(raw, norm);
    assert.equal(isEmptyExtraction(f), true);
    assert.equal(needsFallback(f), true);
  }
});

test('sanitize: unparseable phone kept as printed so the owner can fix it; too-short digits dropped', () => {
  const f = sanitizeCardExtraction({ name: 'A', phones: [{ number: '2345678', label: 'office' }, { number: '123', label: 'mobile' }] }, norm);
  assert.deepEqual(f.phones, [{ number: '2345678', label: 'office' }]);
});

test('fallback: "not a business card" is a real answer — no retry', () => {
  const f = sanitizeCardExtraction({ isBusinessCard: false }, norm);
  assert.equal(needsFallback(f), false);
});

test('fallback: model unsure about the phone → retry on the stronger model', () => {
  const f = sanitizeCardExtraction({ name: 'A', phones: [{ number: '9876543210', label: 'mobile' }], uncertain: ['phones'] }, norm);
  assert.equal(needsFallback(f), true);
});

test('image keys: only this business\'s card prefix is accepted', () => {
  const b = '64b000000000000000000001';
  assert.equal(isOwnCardImageKey(`business-cards/${b}/1-a.jpg`, b), true);
  assert.equal(isOwnCardImageKey(`business-cards/64b000000000000000000002/1-a.jpg`, b), false);
  assert.equal(isOwnCardImageKey(`business-cards/${b}/../x.jpg`, b), false);
  assert.equal(isOwnCardImageKey(`gbp-media/${b}/1.jpg`, b), false);
  assert.equal(isOwnCardImageKey(42, b), false);
});

test('source: "Business Card" is canonical and does not alert the owner (they scanned it themselves)', () => {
  assert.equal(canonicalSource('Business Card'), 'Business Card');
  assert.equal(canonicalSource('visiting card'), 'Business Card');
  assert.equal(ORGANIC_SOURCES.has('Business Card'), false);
});

// ── Quota ────────────────────────────────────────────────────────────────

const read = (p: string) => fs.readFileSync(path.resolve(import.meta.dirname, '../..', p), 'utf8');

test('quota: card scans have their own monthly cap on every plan', () => {
  for (const plan of Object.keys(PLAN_DEFAULTS)) {
    assert.ok(PLAN_DEFAULTS[plan].maxCardScansPerMonth > 0, plan);
  }
});

test('quota: card scans never count against the AI-generations quota (enforced + displayed)', () => {
  for (const file of ['src/lib/featureGating.ts', 'src/app/api/user/usage/route.ts']) {
    assert.match(read(file), /\$nin: \['business_card_scan', 'business_card_scan_retry'\]/, file);
  }
});

test('quota: the stronger-model retry is logged separately, so it is not billed to the customer', () => {
  const scan = read('src/services/crm/businessCardScan.ts');
  assert.match(scan, /'business_card_scan_retry'/);
  assert.match(read('src/lib/featureGating.ts'), /promptType: 'business_card_scan',/);
});

// ── Model choice (Google retires models for new keys) ────────────────────

const gen = (name: string, methods = ['generateContent']) => ({ name: `models/${name}`, supportedGenerationMethods: methods });

test('models: newest stable Flash-Lite reads, newest stable Flash retries; image/tts/embedding variants ignored', () => {
  const picked = pickCardModels([
    gen('gemini-2.5-flash'),
    gen('gemini-2.5-flash-lite'),
    gen('gemini-2.5-flash-image'),
    gen('gemini-3.1-flash-lite'),
    gen('gemini-3.8-flash'),
    gen('gemini-3.8-flash-preview-tts'),
    gen('gemini-4.0-flash-preview-11-2026'), // newer, but preview while a stable exists
    gen('text-embedding-005', ['embedContent']),
  ]);
  assert.deepEqual(picked, { primary: 'gemini-3.1-flash-lite', fallback: 'gemini-3.8-flash' });
});

test('models: preview used only when no stable exists; Flash alone reads with no retry', () => {
  assert.deepEqual(pickCardModels([gen('gemini-3.9-flash-lite-preview-10-2026'), gen('gemini-3.8-flash')]), {
    primary: 'gemini-3.9-flash-lite-preview-10-2026',
    fallback: 'gemini-3.8-flash',
  });
  assert.deepEqual(pickCardModels([gen('gemini-3.8-flash')]), { primary: 'gemini-3.8-flash', fallback: null });
  assert.deepEqual(pickCardModels([]), { primary: null, fallback: null });
});

// ── Auto-save (no confirmation) ──────────────────────────────────────────

test('auto-save: mobile number becomes the lead phone, landline kept as another number', () => {
  const f = sanitizeCardExtraction(
    { name: 'Rajesh Kumar', company: 'ABC', phones: [{ number: '011-23456789', label: 'office' }, { number: '9876543210', label: 'mobile' }], emails: ['r@abc.in'] },
    norm,
  );
  const l = leadFromCard(f);
  assert.equal(l.name, 'Rajesh Kumar');
  assert.equal(l.phone, '+919876543210');
  assert.equal(l.email, 'r@abc.in');
  assert.deepEqual(l.otherPhones, ['+911123456789']); // Delhi landline, normalized
  assert.equal(l.needsReview, false);
});

test('auto-save: a number that cannot be normalized is kept as printed and flagged', () => {
  const l = leadFromCard(sanitizeCardExtraction({ name: 'A B', phones: [{ number: '9876543210', label: 'mobile' }, { number: '2345678', label: 'office' }] }, norm));
  assert.deepEqual(l.otherPhones, ['2345678']);
  assert.equal(l.needsReview, true);
});

test('auto-save: fully clear card is not flagged', () => {
  const l = leadFromCard(sanitizeCardExtraction({ name: 'A B', phones: [{ number: '+91 98765 43210', label: 'mobile' }] }, norm));
  assert.equal(l.needsReview, false);
});

test('auto-save: unsure name/phone, or no name, is flagged "Check details"; name falls back to company', () => {
  assert.equal(leadFromCard(sanitizeCardExtraction({ name: 'A', phones: [{ number: '9876543210', label: 'mobile' }], uncertain: ['phones'] }, norm)).needsReview, true);
  const noName = leadFromCard(sanitizeCardExtraction({ company: 'Mulsetu Pvt Ltd', emails: ['x@y.in'] }, norm));
  assert.equal(noName.name, 'Mulsetu Pvt Ltd');
  assert.equal(noName.needsReview, true);
});

test('auto-save: client card ids are validated (idempotent retries)', () => {
  assert.equal(isValidClientScanId('lx3k2-ab12cd34'), true);
  assert.equal(isValidClientScanId('../x'), false);
  assert.equal(isValidClientScanId(''), false);
  assert.equal(isValidClientScanId(42), false);
});

// ── Blur ─────────────────────────────────────────────────────────────────

test('blur: server sharpness matches the app measure (same thresholds) — sharp vs blurred stripes', () => {
  const W = 640, H = 360;
  const img = new Uint8Array(W * H).fill(235);
  for (let y = 90; y < 270; y += 18) for (let x = 120; x < 520; x++) if ((x >> 3) % 3 !== 0) for (let t = 0; t < 4; t++) img[(y + t) * W + x] = 30;
  const blurred = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < H && xx >= 0 && xx < W) { s += img[yy * W + xx]; n++; }
    }
    blurred[y * W + x] = s / n;
  }
  assert.ok(tiledSharpness(img, W, H) > 1000);
  assert.ok(tiledSharpness(blurred, W, H) < 250);
});

test('blur: the app and server use the same sharpness code', () => {
  const body = (src: string) => src.slice(src.indexOf('export function tiledSharpness'), src.indexOf("scores.sort"));
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/constcw=Math\.floor\(w\*centre\);constch=Math\.floor\(h\*centre\);/, '');
  const app = norm(body(read('mobile/src/lib/sharpness.ts'))).replace(/Math\.floor\(cw\/cols\)/, 'Math.floor(Math.floor(w*centre)/cols)').replace(/Math\.floor\(ch\/rows\)/, 'Math.floor(Math.floor(h*centre)/rows)');
  const server = norm(body(read('src/services/crm/businessCardParse.ts')));
  assert.equal(app, server);
});
