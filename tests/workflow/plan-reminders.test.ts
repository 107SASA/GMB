/**
 * Plan-task reminders end to end: a daily run over 12 days sends in-app,
 * push and WhatsApp on schedule, each naming the top open fix with a link
 * to its screen; two runs on the same day never send twice; nothing is sent
 * once the owner's fixes are done, without plan access, or for an old report.
 * Run: npx tsx --test tests/workflow/plan-reminders.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_APP_URL = 'https://app.test';

const sent: Array<{ channel: string; businessId: string; payload: any }> = [];
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/services[\\/]ownerNotify(\.ts)?$/.test(request)) {
    return { notifyOwner: async (businessId: string, input: any) => { sent.push({ channel: 'whatsapp', businessId, payload: input }); return { status: 'sent' }; } };
  }
  if (/services[\\/]push(\.ts)?$/.test(request)) {
    return { sendPushToBusinessUsers: async (businessId: string, message: any) => { sent.push({ channel: 'push', businessId, payload: message }); } };
  }
  if (/services[\\/]notifications(\.ts)?$/.test(request)) {
    return { notifyBusinessUsers: async (businessId: string, input: any) => { sent.push({ channel: 'inapp', businessId, payload: input }); } };
  }
  return origLoad.call(this, request, ...rest);
};

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
let biz = '';
let lapsed = '';
let oldReport = '';
const reportAt = new Date('2026-11-01T06:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const day = (d: number) => new Date(reportAt.getTime() + d * DAY + 4 * 60 * 60 * 1000);

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_plan_reminders_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    OptimizationAction: (await import('../../src/models/OptimizationAction')).default,
    Audit: (await import('../../src/models/Audit')).default,
    runner: await import('../../src/services/tasks/reminderRunner'),
  };
  const oid = () => new m.mongoose.Types.ObjectId();
  const mkBiz = async (name: string, status: string) => String((await m.Business.create({ name, category: 'Software company', address: 'Ojhar', userId: oid(), organizationId: oid(), subscriptionStatus: status } as any))._id);
  const mkReport = async (businessId: string, createdAt: Date) => {
    const id = oid();
    await m.Audit.collection.insertOne({ _id: id, businessId: new m.mongoose.Types.ObjectId(businessId), status: 'COMPLETED', auditKind: 'connected_baseline', createdAt });
    return String(id);
  };
  const mkTask = (businessId: string, auditId: string, findingId: string, capability: string | null, status = 'READY') =>
    m.OptimizationAction.create({ businessId, findingId, capability, plannedInAuditId: auditId, plannedAt: reportAt, description: findingId, priority: 'medium', ownerAction: 'o', growwmaticsAction: null, requiresGbpConnection: false, status });

  biz = await mkBiz('Mulsetu', 'active');
  const a = await mkReport(biz, reportAt);
  await mkTask(biz, a, 'website.services.missing_on_gbp', 'update_services');
  await mkTask(biz, a, 'website.gbp_services_not_on_site', null, 'PLANNED');
  await mkTask(biz, a, 'gbp.posts.stale', 'google_posts');

  lapsed = await mkBiz('Lapsed Workspace', 'canceled');
  await mkTask(lapsed, await mkReport(lapsed, reportAt), 'website.services.missing_on_gbp', 'update_services');

  oldReport = await mkBiz('Old Report', 'active');
  await mkTask(oldReport, await mkReport(oldReport, new Date(reportAt.getTime() - 30 * DAY)), 'website.services.missing_on_gbp', 'update_services');
});

after(async () => {
  Module._load = origLoad;
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

test('daily runs: in-app → push → WhatsApp → push → WhatsApp, naming the top fix with its link', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const log: string[] = [];
  for (let d = 0; d <= 12; d++) {
    const before = sent.length;
    const res = await m.runner.runTaskRemindersAll(day(d));
    // Same day, second run (Inngest retry, overlap): nothing more is sent.
    await m.runner.runTaskRemindersAll(new Date(day(d).getTime() + 60_000));
    const today = sent.slice(before).filter((s) => s.businessId === biz);
    assert.ok(today.length <= 1, `day ${d}: at most one reminder (${today.length})`);
    if (today.length) log.push(`${d}:${today[0].channel}`);
    // Reports older than the reminder window are not even looked at.
    assert.equal(res.businesses >= 1, d <= 10, `day ${d}: businesses considered`);
  }
  assert.deepEqual(log, ['0:inapp', '1:push', '3:whatsapp', '5:push', '7:whatsapp']);

  const mine = sent.filter((s) => s.businessId === biz);
  const inapp = mine.find((s) => s.channel === 'inapp')!.payload;
  assert.equal(inapp.title, 'Your report found 2 things to fix', 'posts GrowwMatics runs itself are not counted');
  assert.equal(inapp.link, '/dashboard');
  const push = mine.find((s) => s.channel === 'push')!.payload;
  assert.equal(push.data.taskPath, '/profile-optimization?section=services');
  assert.match(push.body, /^Your services aren’t on your Google profile yet\./);
  const wa = mine.filter((s) => s.channel === 'whatsapp').map((s) => s.payload);
  assert.equal(wa[0].event, 'plan_task_reminder');
  assert.match(wa[0].text, /^Hi Mulsetu,/);
  assert.match(wa[0].text, /Your services aren’t on your Google profile yet\. It takes about a minute to approve\. 1 more fix is waiting too\./);
  assert.match(wa[0].text, /Fix it now: https:\/\/app\.test\/dashboard\/profile-optimization\?section=services/);
  assert.ok(!/\n\s*\n\s*\n/.test(wa[0].text), 'reads as one short paragraph');
});

test('no reminders without plan access or for a report older than the window', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(sent.filter((s) => s.businessId === lapsed).length, 0);
  assert.equal(sent.filter((s) => s.businessId === oldReport).length, 0);
  assert.deepEqual(await m.runner.runTaskReminder(lapsed, day(3)), { status: 'skipped', reason: 'no_plan_access' });
});

test('stops once the owner\'s fixes are done; a new report starts over', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const done = await m.Business.create({ name: 'Done Business', category: 'x', address: 'y', userId: new m.mongoose.Types.ObjectId(), organizationId: new m.mongoose.Types.ObjectId(), subscriptionStatus: 'active' } as any);
  const id = String(done._id);
  const report = new m.mongoose.Types.ObjectId();
  await m.Audit.collection.insertOne({ _id: report, businessId: done._id, status: 'COMPLETED', auditKind: 'monthly', createdAt: reportAt });
  const task = await m.OptimizationAction.create({ businessId: id, findingId: 'gbp.attributes.none', capability: 'update_attributes', plannedInAuditId: report, plannedAt: reportAt, description: 'Attributes', status: 'READY' });
  assert.equal((await m.runner.runTaskReminder(id, day(0))).status, 'sent');
  await m.OptimizationAction.updateOne({ _id: task._id }, { $set: { status: 'EXECUTED' } });
  assert.deepEqual(await m.runner.runTaskReminder(id, day(1)), { status: 'skipped', reason: 'all_done', step: 'push_1' });
  assert.deepEqual(await m.runner.runTaskReminder(id, day(3)), { status: 'skipped', reason: 'all_done', step: 'whatsapp_3' });

  // Next month's report finds it again: reminders start over for that report.
  const next = new m.mongoose.Types.ObjectId();
  const nextAt = new Date(reportAt.getTime() + 30 * DAY);
  await m.Audit.collection.insertOne({ _id: next, businessId: done._id, status: 'COMPLETED', auditKind: 'monthly', createdAt: nextAt });
  await m.OptimizationAction.updateOne({ _id: task._id }, { $set: { status: 'PLANNED', reopenedAt: nextAt } });
  const r = await m.runner.runTaskReminder(id, new Date(nextAt.getTime() + 60_000));
  assert.equal(r.status, 'sent');
  assert.equal(r.step, 'inapp_0');
  const b = await m.Business.findById(id).lean();
  assert.equal(b.taskReminderAuditId, String(next));
  assert.deepEqual(b.taskRemindersSent, ['inapp_0']);
});
