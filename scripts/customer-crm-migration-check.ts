/**
 * Customer CRM MIGRATION check on a throwaway in-memory MongoDB.
 *   npx tsx scripts/customer-crm-migration-check.ts
 *
 * Seeds data in the PRE-change shape (legacy pipelineStage, name-only
 * sub-stages, converted leads without a deal, custom / duplicate / deleted
 * stages, an invalid source, legacy auto-WhatsApp FollowUps, a platform
 * prospect), then runs the REAL script (scripts/migrate-customer-crm.ts) as a
 * child process: preview → apply → apply again → verify → rollback → apply.
 * Finally opens the migrated leads through the web API route and the mobile
 * app's own parser (mobile/src/api/endpoints/leads.ts).
 * Never touches a real database: MONGODB_URI points at the in-memory server.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];

let ctx: any = null;
let apiGetResponse: any = null;
const esm = (o: Record<string, unknown>) => { const m: any = { __esModule: true, ...o }; m.default = m; return m; };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) return esm({ requireBusinessContext: async () => ctx });
  if (/lib[\\/]moduleGating(\.ts)?$/.test(request)) return esm({ requireModule: async () => ({ ok: true }) });
  if (/services[\\/]inngest[\\/]client(\.ts)?$/.test(request)) return esm({ inngest: { send: async () => ({ ids: [] }) } });
  // The mobile app's axios client → answer with what the web route returned.
  if (/mobile[\\/]src[\\/]api[\\/]client(\.ts)?$/.test(request) || request === '../client') {
    return esm({ api: { get: async () => ({ data: apiGetResponse }) }, getApiErrorMessage: () => '' });
  }
  return origLoad.call(this, request, ...rest);
};
for (const rel of ['src/lib/tenant.ts', 'src/lib/moduleGating.ts', 'src/services/inngest/client.ts', 'mobile/src/api/client.ts']) {
  const filename = path.resolve(rel);
  const m = new Module(filename);
  m.filename = filename; m.loaded = true; m.exports = Module._load(filename);
  require.cache[filename] = m;
}

const results: Array<{ t: string; pass: boolean }> = [];
const check = (t: string, what: string, pass: boolean, detail = '') => { results.push({ t, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  [${t}] ${what}${detail ? ` — ${detail}` : ''}`); };

function runMigration(uri: string, args: string[]) {
  // Same command an operator runs (npx tsx …), pointed at the in-memory server.
  const r = spawnSync('npx', ['tsx', 'scripts/migrate-customer-crm.ts', ...args.map((x) => `"${x}"`)], {
    cwd: path.resolve('.'),
    env: { ...process.env, MONGODB_URI: uri },
    encoding: 'utf8',
    shell: true,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  const counts = out.match(/\{[\s\S]*?customerLeadsWithoutBusinessId: \d+\s*\}/)?.[0] ?? '';
  const num = (k: string) => Number(counts.match(new RegExp(`${k}: (\\d+)`))?.[1] ?? NaN);
  const backup = out.match(/--rollback=(\S+)/)?.[1] ?? null;
  return { status: r.status, out, num, backup };
}

(async () => {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  const uri = mem.getUri('crm_migration_check');
  process.env.MONGODB_URI = uri;
  const backups: string[] = [];
  try {
    const mongoose = (await import('mongoose')).default;
    const dbConnect = (await import('../src/lib/mongodb')).default; await dbConnect();
    const db = mongoose.connection.db!;
    const oid = () => new mongoose.Types.ObjectId();

    // ── Seed: pre-change shapes, written raw (no new-schema defaults) ───
    const orgX = oid(); const bizX = oid(); const bizY = oid(); const orgY = oid();
    await db.collection('businesses').insertMany([
      { _id: bizX, name: 'Clinic X', category: 'Dentist', organizationId: orgX, userId: oid(),
        leadStages: { initialLabel: 'Open',
          active: [{ name: 'New', color: 'sky' }, { name: 'Interested', color: 'orange' }, { name: 'VIP Follow', color: 'violet' }, { name: 'VIP Follow', color: 'pink' }],
          converted: [{ name: 'Sales Closed', color: 'emerald' }],
          closed: [{ name: 'Lost', color: 'rose' }, { name: 'No Need', color: 'slate' }] } },
      { _id: bizY, name: 'Gym Y', category: 'Gym', organizationId: orgY, userId: oid() }, // on defaults (nothing stored)
    ]);
    const t0 = new Date('2026-09-01T10:00:00Z');
    const L = (o: Record<string, unknown>) => ({ _id: oid(), tenantId: String(orgX), organizationId: String(orgX), businessId: bizX, status: 'active', source: 'WhatsApp', createdAt: t0, updatedAt: t0, ...o });
    const leads = {
      pipeInterested: L({ name: 'P Interested', phone: '+919800000101', lifeCycleStage: 'initial', subStage: null, pipelineStage: 'Interested' }),
      pipeConverted: L({ name: 'P Converted', phone: '+919800000102', lifeCycleStage: 'initial', subStage: null, pipelineStage: 'Converted' }),
      pipeQualified: L({ name: 'P Qualified', phone: '+919800000103', lifeCycleStage: 'initial', subStage: null, pipelineStage: 'Qualified' }),
      webWonNoDeal: L({ name: 'Web Won', phone: '+919800000104', lifeCycleStage: 'converted', subStage: 'Sales Closed', valuation: 50000 }),
      custom: L({ name: 'Custom VIP', phone: '+919800000105', lifeCycleStage: 'active', subStage: 'VIP Follow' }),
      lostNoDate: L({ name: 'Lost One', phone: '+919800000106', lifeCycleStage: 'closed', subStage: 'Lost' }),
      badSource: L({ name: 'Bad Source', phone: '+919800000107', lifeCycleStage: 'initial', subStage: null, source: 'Import' }),
      fallbackScore: L({ name: 'Fallback Score', phone: '+919800000113', lifeCycleStage: 'initial', subStage: null, aiLeadScore: 75, aiInsights: null }),
      realScore: L({ name: 'Real Score', phone: '+919800000114', lifeCycleStage: 'initial', subStage: null, aiLeadScore: 82, aiInsights: 'Asked for a quote twice.' }),
      plain: L({ name: 'Plain Lead', phone: '098000 00108', email: 'plain@x.com', notes: 'VIP — call after 6pm', lifeCycleStage: 'initial', subStage: null, assignedUserId: oid() }),
      deletedStage: L({ name: 'Deleted Stage', phone: '+919800000109', lifeCycleStage: 'active', subStage: 'Old Removed Stage' }),
      yDefault: { ...L({ name: 'Y Lead', phone: '+919800000110', lifeCycleStage: 'active', subStage: 'Follow Up' }), tenantId: String(orgY), organizationId: String(orgY), businessId: bizY },
    };
    const noBusiness = { _id: oid(), tenantId: String(orgX), name: 'Legacy No Biz', phone: '+919800000111', source: 'Manual', lifeCycleStage: 'initial', pipelineStage: 'Converted', createdAt: t0, updatedAt: t0 };
    const platform = { _id: oid(), tenantId: 'gmbboost-internal', leadType: 'Platform Prospect', name: 'Platform', phone: '+919800000112', source: 'Website', lifeCycleStage: 'initial', pipelineStage: 'Converted', currentAgent: 'SALES', createdAt: t0, updatedAt: t0 };
    await db.collection('leads').insertMany([...Object.values(leads), noBusiness, platform]);
    const acts = await db.collection('activities').insertMany([
      { tenantId: String(orgX), leadId: leads.plain._id, type: 'note', content: 'Prefers evenings', createdAt: t0 },
      { tenantId: String(orgX), leadId: leads.plain._id, type: 'call', content: 'Called, interested', createdAt: t0 },
    ]);
    await db.collection('followups').insertMany([
      { tenantId: String(orgX), leadId: leads.plain._id, status: 'pending', messageTemplate: 'Day 3 check-in', scheduledFor: new Date('2026-09-04') },
      { tenantId: String(orgX), leadId: leads.plain._id, status: 'completed', messageTemplate: 'Day 1', scheduledFor: new Date('2026-09-02') },
      { tenantId: String(orgX), businessId: bizX, leadId: leads.custom._id, kind: 'task', type: 'Call', status: 'pending', scheduledFor: new Date('2026-10-05') },
      { tenantId: 'gmbboost-internal', leadId: platform._id, status: 'pending', messageTemplate: 'platform' },
    ]);
    const snapshot = async () => JSON.stringify({
      leads: await db.collection('leads').find().sort({ _id: 1 }).toArray(),
      businesses: await db.collection('businesses').find().sort({ _id: 1 }).toArray(),
      followups: await db.collection('followups').find().sort({ _id: 1 }).toArray(),
    });
    const seed = await snapshot();
    const platformBefore = JSON.stringify(await db.collection('leads').findOne({ _id: platform._id }));

    // ── 1. Preview ──────────────────────────────────────────────────────
    const pv = runMigration(uri, []);
    check('M1', 'preview runs and writes NOTHING', pv.status === 0 && (await snapshot()) === seed, `exit ${pv.status}`);
    check('M2', 'preview reports what it would change',
      pv.num('leadsUpdated') === 8 && Number.isNaN(pv.num('legacyFallbackScoresCleared')) && pv.num('legacyPipelineStageMapped') === 3 && pv.num('convertedMarkedValueMissing') === 2 &&
      pv.num('invalidSourceFixed') === 1 && pv.num('legacyFollowUpsCancelled') === 1 && pv.num('stageConfigsGettingIds') === 1 && pv.num('customerLeadsWithoutBusinessId') === 1,
      pv.out.match(/\{[^{}]*leadsScanned[^{}]*\}/)?.[0].replace(/\s+/g, ' ') ?? pv.out.slice(-400));

    check('M2b', 'preview lists the missing Customer CRM indexes (production runs with autoIndex off)',
      pv.num('indexesToCreate') > 0 && /CallEvent \{"provider":1,"callId":1\}/.test(pv.out) && /Lead \{"businessId":1,"phone":1\}/.test(pv.out), `${pv.num('indexesToCreate')} to create`);

    // ── 2. Apply ────────────────────────────────────────────────────────
    const ap = runMigration(uri, ['--apply']);
    if (ap.backup) backups.push(ap.backup);
    const callIx = await db.collection('callevents').indexes().catch(() => [] as any[]);
    check('M2c', 'apply creates the indexes (CallEvent unique provider+callId guards duplicate call records)',
      callIx.some((ix: any) => ix.unique && ix.key?.provider === 1 && ix.key?.callId === 1), callIx.map((ix: any) => ix.name).join(','));
    const get = (id: any) => db.collection('leads').findOne({ _id: id }) as Promise<any>;
    const biz: any = await db.collection('businesses').findOne({ _id: bizX });
    const ids = biz.leadStages.active.map((s: any) => s.id);
    check('M3', 'stage config stored with stable ids; duplicate custom names get distinct ids',
      ap.status === 0 && ids.join(',') === 'active-new,active-interested,active-vip-follow,active-vip-follow-2' && biz.leadStages.converted[0].id === 'converted-sales-closed', ids.join(','));
    const a = await get(leads.pipeInterested._id); const b = await get(leads.pipeConverted._id); const q = await get(leads.pipeQualified._id);
    check('M4', 'legacy pipelineStage → canonical stage (exact sub-stage match, else keyword group)',
      a.lifeCycleStage === 'active' && a.subStageId === 'active-interested' && a.subStage === 'Interested' &&
      b.lifeCycleStage === 'converted' && q.lifeCycleStage === 'active' && q.subStageId == null && a.pipelineStage === 'Interested' &&
      a.updatedAt.getTime() === t0.getTime() /* a migration is not an edit */,
      `${a.lifeCycleStage}/${a.subStageId} · ${b.lifeCycleStage} · ${q.lifeCycleStage}/${q.subStageId}`);
    const w = await get(leads.webWonNoDeal._id);
    check('M5', 'Won/converted without a deal → kept Won, deal.value null + valueMissing (estimated valuation NOT used as revenue)',
      b.deal?.value === null && b.deal?.valueMissing === true && w.lifeCycleStage === 'converted' && w.deal?.value === null && w.deal?.valueMissing === true && w.valuation === 50000 && !!w.convertedAt);
    const c = await get(leads.custom._id); const lo = await get(leads.lostNoDate._id); const d = await get(leads.deletedStage._id);
    check('M6', 'custom stage → its id; closed gets lostAt; lead on a deleted stage keeps its group + name (not moved elsewhere)',
      c.subStageId === 'active-vip-follow' && c.subStage === 'VIP Follow' && !!lo.lostAt && d.lifeCycleStage === 'active' && d.subStage === 'Old Removed Stage' && d.subStageId == null);
    const fs1 = await get(leads.fallbackScore._id); const rs = await get(leads.realScore._id);
    check('M7b', 'old stored AI score values are left as they are (no destructive cleanup; the Customer CRM no longer reads them)',
      fs1.aiLeadScore === 75 && fs1.aiInsights == null && rs.aiLeadScore === 82 && rs.aiInsights === 'Asked for a quote twice.' && fs1.aiScoreSource === undefined && rs.aiScoreSource === undefined);
    const bs = await get(leads.badSource._id);
    check('M7', 'invalid source (rejected by the schema) → canonical value', bs.source === 'CSV Import', bs.source);
    const p = await get(leads.plain._id);
    check('M8', 'untouched fields preserved: phone (as stored), email, notes, owner, workspace, tenant',
      p.phone === '098000 00108' && p.email === 'plain@x.com' && p.notes === 'VIP — call after 6pm' && String(p.assignedUserId) === String((leads.plain as any).assignedUserId) &&
      String(p.businessId) === String(bizX) && p.tenantId === String(orgX) && p.lifeCycleStage === 'initial');
    const fus: any[] = await db.collection('followups').find().toArray();
    check('M9', 'legacy pending auto-WhatsApp FollowUp → cancelled; completed history and owner tasks kept; platform untouched',
      fus.find((f) => f.messageTemplate === 'Day 3 check-in')?.status === 'cancelled' && fus.find((f) => f.messageTemplate === 'Day 1')?.status === 'completed' &&
      fus.find((f) => f.kind === 'task')?.status === 'pending' && fus.find((f) => f.messageTemplate === 'platform')?.status === 'pending');
    check('M10', 'super-admin platform prospect and the business-less legacy lead are untouched',
      JSON.stringify(await db.collection('leads').findOne({ _id: platform._id })) === platformBefore && (await get(noBusiness._id)).lifeCycleStage === 'initial');
    check('M11', 'no documents created or deleted (leads, activities, followups, call events)',
      (await db.collection('leads').countDocuments()) === 14 && (await db.collection('activities').countDocuments()) === acts.insertedCount &&
      (await db.collection('followups').countDocuments()) === 4 && (await db.collection('callevents').countDocuments()) === 0);
    const yb: any = await db.collection('businesses').findOne({ _id: bizY });
    const y = await get(leads.yDefault._id);
    check('M12', 'business on default stages: nothing stored, lead gets the default id', !yb.leadStages && y.subStageId === 'active-follow-up');

    // ── 3. Idempotency + verify ─────────────────────────────────────────
    const afterFirst = await snapshot();
    const ap2 = runMigration(uri, ['--apply']);
    if (ap2.backup) backups.push(ap2.backup);
    check('M13', 'second --apply changes nothing (idempotent)', ap2.status === 0 && ap2.num('leadsUpdated') === 0 && ap2.num('stageConfigsGettingIds') === 0 && ap2.num('legacyFollowUpsCancelled') === 0 && (await snapshot()) === afterFirst);
    const vf = runMigration(uri, ['--verify']);
    check('M14', '--verify passes (exit 0, nothing left)', vf.status === 0 && /VERIFY OK/.test(vf.out));

    // ── 4. Rollback, then re-apply ──────────────────────────────────────
    const rb = runMigration(uri, [`--rollback=${ap.backup}`]);
    // Field ORDER may differ after $set/$unset — compare values, key-sorted.
    const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
    const rolled = canon(JSON.parse(await snapshot()));
    const seedObj = canon(JSON.parse(seed));
    const diffs: string[] = [];
    for (const col of ['leads', 'followups', 'businesses']) {
      rolled[col].forEach((doc: any, i: number) => {
        if (JSON.stringify(doc) !== JSON.stringify(seedObj[col][i])) {
          const keys = new Set([...Object.keys(doc), ...Object.keys(seedObj[col][i] ?? {})]);
          for (const k of keys) if (JSON.stringify(doc[k]) !== JSON.stringify(seedObj[col][i]?.[k])) diffs.push(`${col}.${doc.name ?? doc._id}.${k}: ${JSON.stringify(seedObj[col][i]?.[k])} → ${JSON.stringify(doc[k])}`);
        }
      });
    }
    check('M15', 'rollback restores leads, follow-ups and stage configs exactly', rb.status === 0 && diffs.length === 0, diffs.slice(0, 6).join(' | ') || 'identical');
    const vf2 = runMigration(uri, ['--verify']);
    check('M16', '--verify after rollback reports pending work (exit 1)', vf2.status === 1);
    const ap3 = runMigration(uri, ['--apply']);
    if (ap3.backup) backups.push(ap3.backup);
    check('M17', 're-apply after rollback succeeds', ap3.status === 0 && ap3.num('leadsUpdated') === 8);

    // ── 5. Existing leads open on web + mobile after migration ──────────
    ctx = { ok: true, userId: String(oid()), organizationId: String(orgX), businessId: String(bizX), business: {} };
    const leadsRoute = await import('../src/app/api/crm/leads/route');
    const timelineRoute = await import('../src/app/api/crm/leads/[id]/timeline/route');
    const res = await leadsRoute.GET(new Request('http://local.test/api/crm/leads'));
    apiGetResponse = await res.json();
    const webIds = new Set(apiGetResponse.leads.map((l: any) => String(l._id)));
    const expected = Object.entries(leads).filter(([k]) => k !== 'yDefault').map(([, l]) => String(l._id));
    check('E1', 'web: every Business X lead is listed (none disappeared); no other workspace leaks in',
      expected.every((id) => webIds.has(id)) && webIds.size === expected.length, `${webIds.size}/${expected.length}`);
    const tl: any = await (await timelineRoute.GET(new Request(`http://local.test/x`) as any, { params: Promise.resolve({ id: String(leads.plain._id) }) } as any)).json();
    check('E2', 'existing lead opens: timeline keeps its activities + legacy follow-up history', tl.success && tl.timeline.filter((t: any) => t.timelineType === 'activity').length === 2, `${tl.timeline?.length} entries`);
    const mobile = await import('../mobile/src/api/endpoints/leads');
    const parsed = await mobile.fetchLeads();
    const mp = parsed.find((l) => l._id === String(leads.pipeInterested._id));
    const mw = parsed.find((l) => l._id === String(leads.webWonNoDeal._id));
    check('E3', 'mobile parser: every lead parses, with the same canonical stage + deal state as web',
      parsed.length === expected.length && mp?.lifeCycleStage === 'active' && mp?.subStageId === 'active-interested' && mw?.lifeCycleStage === 'converted' && mw?.deal?.value === null && mw?.deal?.valueMissing === true,
      `${parsed.length} parsed`);
  } finally {
    for (const f of backups) try { fs.unlinkSync(f); } catch { /* ignore */ }
    await mem.stop({ doCleanup: true, force: true }).catch(() => {});
  }
  const failed = results.filter((x) => !x.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.t).join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
