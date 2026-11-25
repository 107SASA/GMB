/**
 * Products → Google product posts. Pure rules.
 * Run: node --experimental-strip-types --test tests/integration/products.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchSchedule, cleanPostText, formatPrice, nextProductToPost, productPostText, sanitizeProductInput } from '../../src/services/products/productText.ts';

test('post text: price in the title, no links / phones / superlatives in the body', () => {
  const t = productPostText(
    { name: 'Kaju Katli (500 g)', price: 650, description: 'The best kaju katli in town! Call 98765 43210 or visit www.sweets.com', button: 'ORDER' },
    { name: 'Shree Sweets', city: 'Nashik' },
  );
  assert.equal(t.title, 'Kaju Katli (500 g) — ₹650');
  assert.doesNotMatch(t.content, /98765|www\.|best/i);
  assert.match(t.content, /Available at Shree Sweets, Nashik\./);
  assert.match(t.content, /Order online/);
  assert.equal(productPostText({ name: 'Saree', price: null }, {}).title, 'Saree');
  assert.equal(formatPrice(32999), '₹32,999');
  assert.equal(formatPrice(0), null);
  assert.equal(cleanPostText('No.1 shop, guaranteed'), 'shop,');
});

test('product input: link must be https, falls back to the website, then to a Call button', () => {
  const a = sanitizeProductInput({ name: 'AC', price: '₹32,999', button: 'SHOP' }, { website: 'https://shop.example' });
  assert.ok(a.ok && a.product.buttonUrl === 'https://shop.example' && a.product.price === 32999);
  const b = sanitizeProductInput({ name: 'AC', button: 'SHOP' }, { website: null });
  assert.ok(b.ok && b.product.button === 'CALL' && b.product.buttonUrl === null);
  assert.equal(sanitizeProductInput({ name: 'AC', button: 'ORDER', buttonUrl: 'http://x.com' }).ok, false);
  assert.equal(sanitizeProductInput({ name: 'A' }).ok, false);
  const c = sanitizeProductInput({ name: 'Mixer', imageUrl: 'data:image/png;base64,xx' });
  assert.ok(c.ok && c.product.imageUrl === null, 'Google can only fetch https photos');
});

test('batch is spaced out; weekly rotation picks the longest-unposted product and waits for a queued one', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const d = batchSchedule(3, now);
  assert.equal(d.length, 3);
  assert.equal(d[1].getTime() - d[0].getTime(), 2 * 86_400_000);
  const products = [
    { id: 'a', lastPostedAt: '2026-11-01', createdAt: '2026-10-01' },
    { id: 'b', lastPostedAt: null, createdAt: '2026-10-05' },
    { id: 'c', lastPostedAt: '2026-10-20', createdAt: '2026-10-02' },
  ];
  assert.equal(nextProductToPost(products, now)?.id, 'b', 'never posted first');
  assert.equal(nextProductToPost([...products, { id: 'd', scheduledPostAt: '2026-11-25', createdAt: '2026-10-01' }], now), null);
});
