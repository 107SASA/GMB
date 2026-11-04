/**
 * Every monthly-report comparison uses the same baseline as the keyword
 * rankings: last month's latest connected report — never a support re-run,
 * a same-month audit or the free report, and never an earlier report of that
 * month standing in for the latest.
 * Run: npx tsx --test tests/workflow/monthly-baseline.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// auditService loads the AI client on import; no AI call is made here.
process.env.GROQ_API_KEY ||= 'monthly-baseline-test';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
const NOW = new Date('2027-01-28T06:00:00Z');

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_monthly_baseline_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Audit: (await import('../../src/models/Audit')).default,
    svc: await import('../../src/services/audit/auditService'),
  };
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const insert = async (biz: any, id: string, createdAt: string, extra: any = {}) => {
  const _id = new m.mongoose.Types.ObjectId();
  await m.Audit.collection.insertOne({ _id, businessId: biz, status: 'COMPLETED', fastMode: false, auditKind: 'monthly', createdAt: new Date(createdAt), auditData: { facts: { version: 1 } }, tag: id, ...extra });
  return _id;
};
const pick = async (biz: any, currentId: any) =>
  (await m.svc.previousMonthlyReport({ _id: currentId, businessId: biz }, 'tag auditData.facts.version', NOW))?.tag ?? null;

test('last month\'s latest connected report — not a support re-run, a same-month audit or the free report', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const biz = new m.mongoose.Types.ObjectId();
  await insert(biz, 'nov-monthly', '2026-11-28T06:00:00Z');
  await insert(biz, 'dec-monthly-early', '2026-12-02T06:00:00Z');
  await insert(biz, 'dec-monthly', '2026-12-28T06:00:00Z');
  await insert(biz, 'dec-support-rerun', '2026-12-30T06:00:00Z', { auditKind: 'dashboard' });
  await insert(biz, 'jan-free-report', '2027-01-03T06:00:00Z', { auditKind: 'free_report', fastMode: true });
  await insert(biz, 'jan-support-rerun', '2027-01-10T06:00:00Z', { auditKind: 'dashboard' });
  const current = await insert(biz, 'jan-monthly', '2027-01-28T06:00:00Z');
  assert.equal(await pick(biz, current), 'dec-monthly');
});

test('an earlier connected report in the current month is not the baseline', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const biz = new m.mongoose.Types.ObjectId();
  await insert(biz, 'dec-monthly', '2026-12-28T06:00:00Z');
  await insert(biz, 'jan-baseline', '2027-01-01T06:00:00Z', { auditKind: 'connected_baseline' });
  const current = await insert(biz, 'jan-monthly', '2027-01-28T06:00:00Z');
  assert.equal(await pick(biz, current), 'dec-monthly');
});

test('no earlier month → no baseline (nothing is substituted)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const biz = new m.mongoose.Types.ObjectId();
  await insert(biz, 'jan-baseline', '2027-01-01T06:00:00Z', { auditKind: 'connected_baseline' });
  const current = await insert(biz, 'jan-monthly', '2027-01-28T06:00:00Z');
  assert.equal(await pick(biz, current), null);
});

test('every monthly comparison uses this baseline; the latest report of the month is never swapped for an earlier one', () => {
  const src = fs.readFileSync('src/services/audit/auditService.ts', 'utf8');
  assert.match(src, /const prevAudit: any = \(\(audit as any\)\.auditKind \|\| auditKindOf\(audit\)\) === 'monthly'\s*\? await previousMonthlyReport\(audit, '_id'\)/, 'SEO-plan outcomes');
  assert.match(src, /const prevForAI: any = await previousMonthlyReport\(audit, /, 'AI monthly context');
  assert.match(src, /if \(prevForAI && prevForAI\.auditData\?\.facts\?\.version >= 1\)/);
  assert.match(src, /const monthlyPrev: any = auditKind === 'monthly' \? await previousMonthlyReport\(audit, prevSelect\) : null;/, 'report comparison + monthly report');
  assert.match(src, /\? \(monthlyPrev\?\.auditData\?\.facts\?\.version >= 1 \? monthlyPrev : null\)/, 'no fallback when the chosen report lacks data');
  // The keyword rankings use the same month rule and kinds.
  assert.match(src, /auditKind: \{ \$in: \[\.\.\.RANK_HISTORY_KINDS\] \}/);
});
