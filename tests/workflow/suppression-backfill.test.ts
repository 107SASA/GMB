/**
 * The one-off MessagingSuppression backfill (services/messaging/suppressionBackfill.ts
 * and scripts/backfill-messaging-suppression.ts), against an in-memory
 * MongoDB only: categories and evidence, dry run writes nothing, apply is
 * idempotent, customer_flag_only needs explicit selection, look-alike numbers
 * and old requests are excluded, and the script's database guard.
 *
 * Run: npx tsx --test tests/workflow/suppression-backfill.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|DO_SPACES)_?/.test(k)) delete process.env[k];
process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
let uri = '';
const DAY = 86_400_000;

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  uri = memoryServer.getUri('gm_backfill_test');
  process.env.MONGODB_URI = uri;
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Customer: (await import('../../src/models/Customer')).default,
    Conversation: (await import('../../src/models/Conversation')).default,
    Lead: (await import('../../src/models/Lead')).default,
    LeadEvent: (await import('../../src/models/LeadEvent')).default,
    ReviewRequest: (await import('../../src/models/ReviewRequest')).default,
    Suppression: (await import('../../src/models/MessagingSuppression')).default,
    backfill: await import('../../src/services/messaging/suppressionBackfill'),
  };
  await m.Suppression.init();
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const id = () => new m.mongoose.Types.ObjectId();
const NOW = Date.now();

async function seed() {
  const [A, B, C, D] = [id(), id(), id(), id()];
  // tenant_stop: inbound STOP on A's own number (lead phone E.164), customer stored as CSV digits.
  const leadA = await m.Lead.create({ tenantId: String(A), businessId: A, name: 'Asha', phone: '+919800000001' } as any);
  await m.Conversation.create({ tenantId: String(A), businessId: A, leadId: leadA._id, direction: 'inbound', messageText: ' stop ', isAI: false, messageStatus: 'received' } as any);
  await m.Customer.create({ tenantId: String(A), businessId: A, name: 'Asha', phone: '9800000001', optedOut: true } as any);
  // Not a STOP: a sentence containing the word.
  const leadA2 = await m.Lead.create({ tenantId: String(A), businessId: A, name: 'Ravi', phone: '+919800000009' } as any);
  await m.Conversation.create({ tenantId: String(A), businessId: A, leadId: leadA2._id, direction: 'inbound', messageText: 'please stop by tomorrow', isAI: false, messageStatus: 'received' } as any);
  // customer_flag_only: opted out, no STOP evidence.
  await m.Customer.create({ tenantId: String(A), businessId: A, name: 'Owner choice', phone: '098000 00002', optedOut: true } as any);
  // platform_stop: STOP on the shared line 5 days after B's request; C's request was 60 days before; D is a +1 look-alike.
  const stopAt = new Date(NOW - 10 * DAY);
  await m.LeadEvent.create({ type: 'OPT_OUT', actor: 'system', phone: '+919800000003', payload: { reason: 'inbound-stop:platform' }, createdAt: stopAt } as any);
  const cB = await m.Customer.create({ tenantId: String(B), businessId: B, name: 'Meera', phone: '98000 00003' } as any);
  await m.ReviewRequest.create({ tenantId: String(B), businessId: B, customerId: cB._id, message: 'x', status: 'Sent', sentAt: new Date(stopAt.getTime() - 5 * DAY), token: `b${NOW}` } as any);
  const cC = await m.Customer.create({ tenantId: String(C), businessId: C, name: 'Meera', phone: '+919800000003' } as any);
  await m.ReviewRequest.create({ tenantId: String(C), businessId: C, customerId: cC._id, message: 'x', status: 'Sent', sentAt: new Date(stopAt.getTime() - 60 * DAY), token: `c${NOW}` } as any);
  const cD = await m.Customer.create({ tenantId: String(D), businessId: D, name: 'Tom', phone: '+1 980 000 0003' } as any);
  await m.ReviewRequest.create({ tenantId: String(D), businessId: D, customerId: cD._id, message: 'x', status: 'Sent', sentAt: new Date(stopAt.getTime() - 2 * DAY), token: `d${NOW}` } as any);
  // Already suppressed live (after Segment 3.1) — not planned again.
  await m.Customer.create({ tenantId: String(D), businessId: D, name: 'Live', phone: '+919800000004', optedOut: true } as any);
  await m.Suppression.create({ businessId: D, phoneE164: '+919800000004', channel: 'whatsapp', source: 'tenant_number', keyword: 'STOP' } as any);
  return { A: String(A), B: String(B), C: String(C), D: String(D) };
}

test('plan: categories from stored evidence only; dry run writes nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ids = await seed();
  const plan = await m.backfill.planSuppressionBackfill();
  const has = (cat: string, b: string, p: string) => plan.rows.some((r: any) => r.category === cat && r.businessId === b && r.phoneE164 === p);
  assert.deepEqual(plan.counts, { tenant_stop: 1, platform_stop: 1, customer_flag_only: 1 });
  assert.ok(has('tenant_stop', ids.A, '+919800000001'), 'a STOP message outranks the bare flag');
  assert.ok(has('platform_stop', ids.B, '+919800000003'));
  assert.ok(has('customer_flag_only', ids.A, '+919800000002'));
  assert.ok(!plan.rows.some((r: any) => r.businessId === ids.C), 'a request 60 days before the STOP is not evidence');
  assert.ok(!plan.rows.some((r: any) => r.businessId === ids.D), '+1 look-alike and an existing row are excluded');
  assert.ok(!plan.rows.some((r: any) => r.phoneE164 === '+919800000009'), '"please stop by" is not a STOP');
  assert.equal(plan.alreadySuppressed, 1);
  assert.equal(await m.Suppression.countDocuments(), 1, 'planning wrote nothing');
});

test('apply: default categories only, labelled, idempotent; customer_flag_only only when selected', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const plan = await m.backfill.planSuppressionBackfill();
  const first = await m.backfill.applySuppressionBackfill(plan.rows, ['tenant_stop', 'platform_stop']);
  assert.deepEqual(first, { inserted: 2, considered: 2 });
  const again = await m.backfill.applySuppressionBackfill(plan.rows, ['tenant_stop', 'platform_stop']);
  assert.equal(again.inserted, 0, 're-running inserts nothing');
  const rows: any[] = await m.Suppression.find({ backfill: { $exists: true } }).lean();
  assert.deepEqual(rows.map((r) => [r.source, r.backfill.category]).sort(), [['platform_number', 'platform_stop'], ['tenant_number', 'tenant_stop']]);
  assert.equal(await m.Suppression.countDocuments({ source: 'legacy_customer_flag' }), 0);
  const flag = await m.backfill.applySuppressionBackfill(plan.rows, ['customer_flag_only']);
  assert.equal(flag.inserted, 1);
  assert.equal((await m.backfill.planSuppressionBackfill()).rows.length, 0, 'nothing left to do');
  assert.equal(await m.Customer.countDocuments({ optedOut: true }), 3, 'customers are never edited by the backfill');
});

test('script: dry run by default; --apply refuses without the matching --confirm-db', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.Suppression.deleteMany({ backfill: { $exists: true } });
  const run = (...extra: string[]) => spawnSync('npx', ['tsx', 'scripts/backfill-messaging-suppression.ts', ...extra], {
    env: { ...process.env, MONGODB_URI: uri }, encoding: 'utf8', shell: process.platform === 'win32', timeout: 180_000,
  });
  const dry = run();
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /dry run \(nothing is written\)/);
  assert.match(dry.stdout, /"tenant_stop":1,"platform_stop":1,"customer_flag_only":1/);
  assert.equal(await m.Suppression.countDocuments({ backfill: { $exists: true } }), 0);
  const refused = run('--apply', '--confirm-db=wrong');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /--confirm-db=gm_backfill_test/);
  assert.equal(await m.Suppression.countDocuments({ backfill: { $exists: true } }), 0);
  const ok = run('--apply', '--confirm-db=gm_backfill_test');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /inserted 2 of 2/);
  const noUri = spawnSync('npx', ['tsx', 'scripts/backfill-messaging-suppression.ts'], { env: { ...process.env, MONGODB_URI: '' }, encoding: 'utf8', shell: process.platform === 'win32', timeout: 180_000 });
  assert.equal(noUri.status, 2, 'no URI → refuses (no .env fallback)');
});
