/**
 * Account hard-purge coverage — every collection has an explicit decision,
 * and every field the purge matches on really exists on that model.
 * Run: node --experimental-strip-types --test tests/integration/account-purge-plan.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NOT_PURGED, PURGE_TARGETS, PURGE_GRACE_DAYS, BILLING_RETENTION_YEARS } from '../../src/services/account/purgePlan.ts';

const dir = path.resolve('src/models');
const models = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'shared.ts').map((f) => f.replace(/\.ts$/, ''));
const source = (m: string) => fs.readFileSync(path.join(dir, `${m}.ts`), 'utf8');

test('every model has a purge decision (a new collection cannot slip through)', () => {
  const decided = new Set([...PURGE_TARGETS.map((t) => t.model), ...Object.keys(NOT_PURGED)]);
  const missing = models.filter((m) => !decided.has(m));
  assert.deepEqual(missing, [], `add these to PURGE_TARGETS or NOT_PURGED: ${missing.join(', ')}`);
  const stale = [...decided].filter((m) => !models.includes(m));
  assert.deepEqual(stale, [], `decisions for models that no longer exist: ${stale.join(', ')}`);
});

test('a model is either purged or kept — never both', () => {
  const both = PURGE_TARGETS.map((t) => t.model).filter((m) => m in NOT_PURGED);
  assert.deepEqual(both, []);
});

test('every match field exists on its model schema', () => {
  for (const t of PURGE_TARGETS) {
    const src = source(t.model);
    for (const field of Object.keys(t.by)) {
      assert.match(src, new RegExp(`\\b${field}\\s*:`), `${t.model}.${field} is not a schema field`);
    }
  }
});

test('models holding a business or user reference are purged unless a documented reason keeps them', () => {
  for (const m of models) {
    if (!/\b(businessId|userId|leadId)\s*:\s*\{/.test(source(m))) continue;
    const purged = PURGE_TARGETS.some((t) => t.model === m);
    assert.ok(purged || NOT_PURGED[m], `${m} references a business/user but has no decision`);
  }
});

test('the promised numbers are the ones the public page states', () => {
  const page = fs.readFileSync(path.resolve('src/app/delete-account/page.tsx'), 'utf8');
  assert.match(page, new RegExp(`const GRACE_DAYS = ${PURGE_GRACE_DAYS};`));
  assert.match(page, new RegExp(`const BILLING_YEARS = ${BILLING_RETENTION_YEARS};`));
  assert.match(page, /support|supportEmail/);
});
