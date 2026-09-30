/**
 * ACCOUNT HARD-PURGE CHECK — production-shaped data on a throwaway in-memory
 * MongoDB. Nothing here touches production.
 *
 *   npx tsx scripts/account-purge-check.ts
 *
 * Accounts seeded:
 *   A  deleted 40 days ago — owns businesses A1 (+ legacy A2 without userId);
 *      data in every purge collection, a Razorpay subscription, stored files
 *   B  active customer — owns B1 (and workspace X, which is ALSO listed on A)
 *   C  deleted 10 days ago — inside the 30-day grace period
 *   S  SUPER_ADMIN, isDeleted 60 days ago — must never be touched
 *   D  deleted 40 days ago — one collection fails mid-purge (isolation/retry)
 *   E  deleted 3 days ago with a still-active subscription (billing retry)
 * Storage and Google revoke are SIMULATED (recorded, never real).
 */
import fs from 'fs';
import path from 'path';

for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];

type Result = { n: string; test: string; pass: boolean; detail: string };
const results: Result[] = [];
const check = (n: string, test: string, pass: boolean, detail: string) => {
  results.push({ n, test, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${n}] ${test} — ${detail}`);
};

async function main() {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = mem.getUri('growwmatics_purge_check');
  try { await run(); } finally { await mem.stop({ doCleanup: true, force: true }).catch(() => {}); }
}

async function run() {
  const mongoose = (await import('mongoose')).default;
  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();
  const { PURGE_TARGETS } = await import('../src/services/account/purgePlan');
  // Register every model.
  for (const f of fs.readdirSync(path.resolve('src/models'))) if (f.endsWith('.ts') && f !== 'shared.ts') await import(`../src/models/${f.replace(/\.ts$/, '')}`);
  const M = (n: string) => mongoose.models[n];
  // Seed rows only carry the purge-relevant fields, so unrelated unique indexes
  // (e.g. ScheduledAction.idempotencyKey) are dropped — except User/Business,
  // whose unique email/phone indexes the tombstone must satisfy.
  for (const n of Object.keys(mongoose.models)) {
    await M(n).init().catch(() => {});
    if (n !== 'User' && n !== 'Business') await M(n).collection.dropIndexes().catch(() => {});
  }
  const { findUsersDueForPurge, purgeAccount, expireBillingRecords } = await import('../src/services/account/hardPurge');
  const { retryBillingCancelForDeletedAccounts } = await import('../src/lib/billing/deletionCancel');

  const oid = () => new mongoose.Types.ObjectId();
  const DAY = 86_400_000;
  const now = new Date();
  const ago = (d: number) => new Date(now.getTime() - d * DAY);
  const ins = (n: string, doc: any) => M(n).collection.insertOne({ createdAt: now, updatedAt: now, ...doc });

  // ── Seed ──
  const PII = { name: 'Asha Kulkarni', email: 'asha.k@example.invalid', phone: '+919812345678', leadPhone: '+919900011122', leadName: 'Ravi Lead', review: 'Asha fixed our kitchen tiles' };
  const orgA = oid(), orgB = oid();
  const A = oid(), B = oid(), C = oid(), S = oid(), D = oid(), E = oid();
  const A1 = oid(), A2 = oid(), B1 = oid(), X = oid(), C1 = oid(), D1 = oid();
  await ins('Organization', { _id: orgA, name: 'Asha Tiles Org', ownerId: A, status: 'Active' });
  await ins('Organization', { _id: orgB, name: 'B Org', ownerId: B, status: 'Active' });
  await ins('User', { _id: A, fullName: PII.name, email: `deleted_1_${PII.email}`, phone: `deleted_1_${PII.phone}`, role: 'CLIENT', organizationId: orgA, businessIds: [A1, A2, X], isDeleted: true, deletedAt: ago(40), passwordHash: 'hash', pushTokens: ['tok'], companyName: 'Asha Tiles' });
  await ins('User', { _id: B, fullName: 'Bharat Active', email: 'b@example.invalid', phone: '+911111111111', role: 'CLIENT', organizationId: orgB, isDeleted: false });
  await ins('User', { _id: C, fullName: 'Chitra Recent', email: 'deleted_2_c@example.invalid', phone: 'deleted_2_+912222222222', role: 'CLIENT', isDeleted: true, deletedAt: ago(10) });
  await ins('User', { _id: S, fullName: 'Super Admin', email: 'deleted_3_s@example.invalid', phone: 'deleted_3_+913333333333', role: 'SUPER_ADMIN', isDeleted: true, deletedAt: ago(60) });
  await ins('User', { _id: D, fullName: 'Dev Failing', email: 'deleted_4_d@example.invalid', phone: 'deleted_4_+914444444444', role: 'CLIENT', isDeleted: true, deletedAt: ago(40) });
  await ins('User', { _id: E, fullName: 'Esha Billing', email: 'deleted_5_e@example.invalid', phone: 'deleted_5_+915555555555', role: 'CLIENT', isDeleted: true, deletedAt: ago(3) });
  await ins('Business', { _id: A1, name: 'Asha Tiles', userId: A, organizationId: orgA, phone: PII.phone, address: '12 MG Road', isDeleted: true, deletedAt: ago(40), razorpaySubscriptionId: 'sub_A', subscriptionStatus: 'cancelled' });
  await ins('Business', { _id: A2, name: 'Asha Legacy', organizationId: orgA, isDeleted: true });
  await ins('Business', { _id: B1, name: 'B Business', userId: B, organizationId: orgB, isDeleted: false });
  await ins('Business', { _id: X, name: 'B Second (A was a member)', userId: B, organizationId: orgB, isDeleted: true, deletedAt: ago(40) });
  await ins('Business', { _id: C1, name: 'C Business', userId: C, isDeleted: true, deletedAt: ago(10) });
  await ins('Business', { _id: D1, name: 'D Business', userId: D, isDeleted: true, deletedAt: ago(40) });

  // One document for every purge target, for A1 and for B1 (B must survive) and D1.
  const leadA = oid(), leadB = oid(), leadD = oid(), auditA = oid(), auditB = oid();
  const docFor = (t: any, biz: any, user: any, lead: any, audit: any) => {
    const d: any = { _id: oid() };
    for (const [field, key] of Object.entries(t.by)) {
      d[field] = key === 'businessId' ? biz : key === 'userId' ? user : key === 'leadId' ? lead : audit;
    }
    return d;
  };
  for (const t of PURGE_TARGETS) {
    if (t.model === 'Lead' || t.model === 'Audit') continue;
    await ins(t.model, { ...docFor(t, A1, A, leadA, auditA), note: `${PII.leadName} ${PII.leadPhone} ${PII.review}` });
    await ins(t.model, docFor(t, B1, B, leadB, auditB));
    await ins(t.model, docFor(t, D1, D, leadD, oid()));
  }
  // Production-style string refs (e.g. AutomationLog.businessId = business._id.toString()).
  await ins('AutomationLog', { _id: oid(), businessId: String(A1), tenantId: String(orgA), message: `${PII.leadName} ${PII.leadPhone}` });
  await ins('Notification', { _id: oid(), userId: String(A), title: PII.review });
  await ins('Lead', { _id: leadA, businessId: A1, name: PII.leadName, phone: PII.leadPhone });
  await ins('Lead', { _id: leadB, businessId: B1, name: 'B lead', phone: '+916666666666' });
  await ins('Lead', { _id: leadD, businessId: D1, name: 'D lead', phone: '+917777777777' });
  await ins('Audit', { _id: auditA, businessId: A1, userId: A, phone: PII.phone, status: 'COMPLETED' });
  await ins('Audit', { _id: auditB, businessId: B1, userId: B, status: 'COMPLETED' });
  await ins('Lead', { _id: oid(), businessId: X, name: 'X lead (B owns X)', phone: '+918888888888' });
  await ins('Subscription', { _id: oid(), userId: A, businessId: A1, planType: 'Pro', billingStatus: 'Canceled', razorpaySubscriptionId: 'sub_A', startDate: ago(400) });
  await ins('Subscription', { _id: oid(), userId: E, planType: 'Pro', billingStatus: 'Active', razorpaySubscriptionId: 'sub_E' });
  await ins('Subscription', { _id: oid(), userId: B, planType: 'Pro', billingStatus: 'Active', razorpaySubscriptionId: 'sub_B' });
  // Stored files: record URLs point into the simulated bucket.
  const BASE = 'https://bucket.example.invalid/';
  await M('Post').collection.updateOne({ businessId: A1 }, { $set: { imageUrl: `${BASE}post-thumbnails/${A1}/p1.jpg` } });
  await M('GbpMediaAsset').collection.updateOne({ businessId: A1 }, { $set: { url: `${BASE}gbp-media/${A1}/photo.jpg` } });
  await M('GbpMediaAsset').collection.updateOne({ businessId: B1 }, { $set: { url: `${BASE}gbp-media/${B1}/photo.jpg` } });
  await M('GBPToken').collection.updateOne({ businessId: A1 }, { $set: { refreshToken: 'enc-refresh-A' } });
  const bucket = new Set([`post-thumbnails/${A1}/p1.jpg`, `gbp-media/${A1}/photo.jpg`, `report-cards/${A1}/card.pdf`, `gbp-media/${B1}/photo.jpg`]);
  let deleteCalls = 0;
  const revoked: string[] = [];
  const storage = {
    configured: true,
    keyFromPublicUrl: (u: string | null | undefined) => (u && u.startsWith(BASE) ? u.slice(BASE.length) : null),
    listKeysUnderPrefix: async (p: string) => [...bucket].filter((k) => k.startsWith(p)),
    deleteKeys: async (keys: string[]) => { deleteCalls++; for (const k of keys) bucket.delete(k); return keys.length; },
  };
  const deps = { storage, revokeGoogleToken: async (t: string) => { revoked.push(t); } };

  const snapshot = async () => {
    const out: Record<string, number> = {};
    for (const n of Object.keys(mongoose.models)) out[n] = await M(n).collection.countDocuments({});
    return JSON.stringify(out);
  };

  // ── 1. Eligibility ──
  const due = (await findUsersDueForPurge(now)).sort();
  check('P1', 'only accounts deleted > 30 days ago are due; SUPER_ADMIN, recent and active excluded', due.join() === [String(A), String(D)].sort().join(), `due: ${due.length} (A, D)`);

  // ── 2. Dry run writes nothing ──
  const before = await snapshot();
  const dry = await purgeAccount(String(A), { mode: 'dry_run', now, deps });
  const after = await snapshot();
  check('P2', 'dry run: counts what would be purged, writes nothing, no storage/Google calls', before === after && dry.complete && deleteCalls === 0 && revoked.length === 0 && (dry.counts.Lead ?? 0) === 1 && dry.storageObjects === 3,
    `would delete ${Object.values(dry.counts).reduce((a, n) => a + n, 0)} docs + ${dry.storageObjects} files; DB unchanged ${before === after}`);
  fs.writeFileSync(path.resolve(process.env.TEMP || '.', 'account-purge-dry-run.json'), JSON.stringify(dry, null, 2));

  // ── 3. Rails ──
  const s = await purgeAccount(String(S), { mode: 'live', now, deps });
  const c = await purgeAccount(String(C), { mode: 'live', now, deps });
  const b = await purgeAccount(String(B), { mode: 'live', now, deps });
  const sDoc: any = await M('User').collection.findOne({ _id: S });
  check('P3', 'SUPER_ADMIN refused by construction (even called directly, even deleted 60 days ago)', /SUPER_ADMIN/.test(s.refused || '') && sDoc.fullName === 'Super Admin' && !sDoc.purgedAt, s.refused || '');
  check('P4', 'inside the grace period → refused; active account → refused', /grace/.test(c.refused || '') && /not deleted/.test(b.refused || ''), `${c.refused} / ${b.refused}`);

  // ── 4. Live purge of A ──
  const live = await purgeAccount(String(A), { mode: 'live', now, deps });
  let leftA = 0;
  const leftDetail: string[] = [];
  for (const t of PURGE_TARGETS) {
    const or = Object.entries(t.by).map(([f, key]) => ({ [f]: key === 'businessId' ? { $in: [A1, A2] } : key === 'userId' ? A : key === 'leadId' ? leadA : auditA }));
    const n = await M(t.model).collection.countDocuments({ $or: or });
    if (n) { leftA += n; leftDetail.push(`${t.model}:${n}`); }
  }
  check('P5', 'live purge: every category-(a)/(c) record of A is gone', live.complete && leftA === 0, leftDetail.join(', ') || `${Object.values(live.counts).reduce((a, n) => a + n, 0)} docs deleted`);
  let leftB = 0;
  for (const t of PURGE_TARGETS) leftB += await M(t.model).collection.countDocuments({ $or: Object.entries(t.by).map(([f, key]) => ({ [f]: key === 'businessId' ? B1 : key === 'userId' ? B : key === 'leadId' ? leadB : auditB })) });
  const xBiz: any = await M('Business').collection.findOne({ _id: X });
  const xLead = await M('Lead').collection.countDocuments({ businessId: X });
  check('P6', 'active customer B untouched; workspace X (owned by B, listed on A) untouched', leftB >= PURGE_TARGETS.length - 1 && xBiz.name === 'B Second (A was a member)' && !xBiz.purgedAt && xLead === 1, `B docs remaining ${leftB}, X intact`);
  check('P7', 'files: A\'s stored objects deleted (URLs + per-business prefixes), B\'s kept; Google token revoked', !bucket.has(`post-thumbnails/${A1}/p1.jpg`) && !bucket.has(`report-cards/${A1}/card.pdf`) && bucket.has(`gbp-media/${B1}/photo.jpg`) && revoked.join() === 'enc-refresh-A', `bucket now: ${[...bucket].join(', ')}`);

  const uA: any = await M('User').collection.findOne({ _id: A });
  const bA: any = await M('Business').collection.findOne({ _id: A1 });
  const org: any = await M('Organization').collection.findOne({ _id: orgA });
  const subA: any = await M('Subscription').collection.findOne({ userId: A });
  check('P8', 'user tombstone: only id/role/flags/dates + unique placeholders remain', !!uA.purgedAt && uA.fullName === 'Deleted user' && uA.email === `purged_${A}@deleted.invalid` && !uA.passwordHash && !uA.pushTokens && !uA.companyName && !uA.businessIds,
    `fields: ${Object.keys(uA).join(', ')}`);
  check('P9', 'business tombstone keeps billing ids only; org tombstoned; subscription kept (category b, no PII)', bA.name === 'Deleted business' && !bA.phone && !bA.address && bA.razorpaySubscriptionId === 'sub_A' && org.name === 'Deleted organization' && !!subA && subA.razorpaySubscriptionId === 'sub_A',
    `business fields: ${Object.keys(bA).join(', ')}`);

  // Whole-database scan for A's personal data.
  const hits: string[] = [];
  for (const n of Object.keys(mongoose.models)) {
    for (const doc of await M(n).collection.find({}).toArray()) {
      const txt = JSON.stringify(doc);
      for (const v of [PII.name, PII.email, PII.phone, PII.leadPhone, PII.leadName, PII.review, 'Asha Tiles']) if (txt.includes(v)) hits.push(`${n}:${v}`);
    }
  }
  check('P10', 'no trace of A\'s name, email, phone, leads or review text anywhere in the database', hits.length === 0, hits.slice(0, 5).join(', ') || 'clean');
  const log: any = await M('AccountPurgeLog').collection.findOne({ userId: A });
  check('P11', 'audit trail written: ids + counts only, no personal data', !!log && log.complete === true && !Object.values([PII.name, PII.email, PII.phone]).some((v) => JSON.stringify(log).includes(v)) && log.counts.Lead === 1, `log counts: ${Object.keys(log?.counts || {}).length} collections`);
  const again = await purgeAccount(String(A), { mode: 'live', now, deps });
  check('P12', 're-run is a no-op (already purged)', /already purged/.test(again.refused || ''), again.refused || '');

  // ── 5. Failure isolation ──
  const coll: any = M('Review').collection;
  const orig = coll.deleteMany;
  coll.deleteMany = () => { throw new Error('simulated Review failure'); };
  const d1 = await purgeAccount(String(D), { mode: 'live', now, deps });
  coll.deleteMany = orig;
  const dUser: any = await M('User').collection.findOne({ _id: D });
  const dLeads = await M('Lead').collection.countDocuments({ businessId: D1 });
  check('P13', 'one collection failing: others still purged, account NOT marked purged (retried next run)', !d1.complete && d1.errors.some((e) => /Review/.test(e)) && dLeads === 0 && !dUser.purgedAt && dUser.fullName === 'Dev Failing', d1.errors.join('; '));
  const d2 = await purgeAccount(String(D), { mode: 'live', now, deps });
  check('P14', 'retry after the failure clears: purge completes', d2.complete && (await M('Review').collection.countDocuments({ businessId: D1 })) === 0, `complete ${d2.complete}`);

  // ── 6. Billing ──
  const cancelled: string[] = [];
  const bill = await retryBillingCancelForDeletedAccounts({ mode: 'live', cancel: async (id) => { cancelled.push(id); } });
  check('P15', 'deleted account with a live subscription is cancelled; active customers are not', cancelled.join() === 'sub_E' && bill.cancelled === 1, `cancelled: ${cancelled.join(', ')}`);
  await M('User').collection.updateOne({ _id: A }, { $set: { purgedAt: new Date(now.getTime() - 9 * 365 * DAY) } });
  await M('Business').collection.updateOne({ _id: A1 }, { $set: { purgedAt: new Date(now.getTime() - 9 * 365 * DAY) } });
  const dryBill = await expireBillingRecords({ mode: 'dry_run', now });
  const stillThere = await M('Subscription').collection.countDocuments({ userId: A });
  const liveBill = await expireBillingRecords({ mode: 'live', now });
  check('P16', 'billing kept 8 years, then removed (dry run counts only first)', dryBill.subscriptions === 1 && stillThere === 1 && liveBill.subscriptions === 1 && (await M('Subscription').collection.countDocuments({ userId: A })) === 0 && (await M('Subscription').collection.countDocuments({ userId: B })) === 1,
    `dry ${dryBill.subscriptions}, live ${liveBill.subscriptions}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.n).join(', ')}` : ''}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
