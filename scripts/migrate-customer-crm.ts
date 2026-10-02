/**
 * Customer CRM migration (Oct 2026) — DRY RUN BY DEFAULT.
 *
 *   npx tsx scripts/migrate-customer-crm.ts                    # preview: counts + samples, no writes
 *   npx tsx scripts/migrate-customer-crm.ts --apply            # write (backup file written first)
 *   npx tsx scripts/migrate-customer-crm.ts --verify           # post-check: exits 1 if anything is left to migrate
 *   npx tsx scripts/migrate-customer-crm.ts --rollback=<file>  # restore every field the apply changed
 *
 * Customer leads only (tenantId != 'gmbboost-internal'). The super-admin CRM
 * (platform prospects) is never read or written.
 *
 *  0. Indexes for CallEvent / FollowUp / Lead (production has autoIndex off).
 *  1. Business.leadStages: store the stable sub-stage ids (only configs that
 *     lack them; a business still on the defaults has nothing stored).
 *  2. Leads (services/crm/stageMigration.ts):
 *       legacy pipelineStage → lifeCycleStage + subStageId/subStage;
 *       name-only sub-stage → its id;
 *       converted without a deal → deal.valueMissing (no value is estimated);
 *       closed without lostAt → lostAt.
 *     A source outside the schema enum (it would fail validation on the next
 *     save) → its canonical alias, else 'Manual'.
 *  3. Old auto-WhatsApp FollowUp rows (kind != 'task', status pending) on
 *     customer leads → cancelled. Their Inngest dispatch is already a no-op.
 *
 * Never deletes or creates documents, never touches notes, activities,
 * phones, owners, workspaces or updatedAt (a migration is not an edit).
 * Idempotent: a second run finds nothing to do.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

for (const file of ['.env.local', '.env']) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) continue;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2]; if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, ''); v = v.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');
const ROLLBACK = process.argv.find((a) => a.startsWith('--rollback='))?.slice('--rollback='.length);
const PLATFORM_TENANT = 'gmbboost-internal';
const SAMPLE = 20;

type BackupRow = { collection: 'leads' | 'businesses' | 'followups'; _id: string; before: Record<string, unknown> };

async function rollback(file: string) {
  const db = mongoose.connection.db!;
  const rows: BackupRow[] = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  let restored = 0;
  for (const r of rows) {
    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(r.before)) {
      if (v === undefined || (v as any)?.__absent) unset[k] = '';
      else set[k] = k.endsWith('At') && typeof v === 'string' ? new Date(v) : v;
    }
    await db.collection(r.collection).updateOne(
      { _id: new mongoose.Types.ObjectId(r._id) },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    );
    restored++;
  }
  console.log(`Rolled back ${restored} document(s) from ${file}`);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  // autoIndex off: importing models must not build every index on production
  // data — only the Customer CRM indexes below, explicitly, on --apply.
  await mongoose.connect(uri, { autoIndex: false });
  if (ROLLBACK) { await rollback(ROLLBACK); await mongoose.disconnect(); return; }

  const { default: Business } = await import('../src/models/Business');
  const { default: Lead } = await import('../src/models/Lead');
  const { default: FollowUp } = await import('../src/models/FollowUp');
  const { default: CallEvent } = await import('../src/models/CallEvent');
  const { resolveLeadStagesConfig, assignSubStageIds, SUB_STAGE_GROUPS } = await import('../src/lib/leadStages');
  const { planLeadStageMigration } = await import('../src/services/crm/stageMigration');
  const { canonicalSource } = await import('../src/services/crm/sources');
  const validSources: string[] = (Lead.schema.path('source') as any).enumValues;

  const mode = APPLY ? 'APPLY — writing changes' : VERIFY ? 'VERIFY — read only' : 'DRY RUN — no writes (pass --apply to write)';
  console.log(`== ${mode} ==`);

  let backup: fs.WriteStream | null = null;
  let backupPath = '';
  if (APPLY) {
    backupPath = path.resolve(`crm-migration-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
    backup = fs.createWriteStream(backupPath, { flags: 'wx' });
    console.log(`Backup of every changed field → ${backupPath}`);
  }
  const save = (row: BackupRow) => backup?.write(`${JSON.stringify(row)}\n`);
  const before = (doc: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, doc[k] === undefined ? { __absent: true } : doc[k]]));

  const counts = {
    indexesToCreate: 0,
    businessesWithCustomerLeads: 0,
    stageConfigsGettingIds: 0,
    leadsScanned: 0,
    leadsUpdated: 0,
    legacyPipelineStageMapped: 0,
    subStageIdAdded: 0,
    convertedMarkedValueMissing: 0,
    invalidSourceFixed: 0,
    legacyFollowUpsCancelled: 0,
    customerLeadsWithoutBusinessId: 0,
  };
  const samples: string[] = [];

  // 0. Customer CRM indexes (production runs with autoIndex off). Missing ones
  // are created; nothing is ever dropped. CallEvent's unique {provider, callId}
  // is what keeps racing Twilio callbacks from creating duplicate calls.
  // ONLY the indexes this change introduced — never a model-wide build, which
  // would also try every other (pre-existing) index on live data.
  const CRM_INDEXES: Array<[any, Record<string, 1 | -1>, Record<string, unknown>?]> = [
    [CallEvent, { provider: 1, callId: 1 }, { unique: true }],
    [CallEvent, { businessId: 1, startedAt: -1 }],
    [FollowUp, { businessId: 1, status: 1, scheduledFor: 1 }],
    [Lead, { businessId: 1, createdAt: -1 }],
    [Lead, { businessId: 1, lifeCycleStage: 1 }],
    [Lead, { businessId: 1, phone: 1 }],
  ];
  const indexPlan: string[] = [];
  for (const [M, key, options] of CRM_INDEXES) {
    const existing: any[] = await M.collection.indexes().catch(() => []); // collection may not exist yet
    if (existing.some((ix) => JSON.stringify(ix.key) === JSON.stringify(key))) continue;
    indexPlan.push(`${M.modelName} ${JSON.stringify(key)}`);
    if (APPLY) await M.collection.createIndex(key, options ?? {});
  }
  counts.indexesToCreate = indexPlan.length;
  if (indexPlan.length) console.log(`Indexes ${APPLY ? 'created' : 'to create'}:\n  ${indexPlan.join('\n  ')}`);

  counts.customerLeadsWithoutBusinessId = await Lead.countDocuments({ tenantId: { $ne: PLATFORM_TENANT }, $or: [{ businessId: null }, { businessId: { $exists: false } }] });

  const businessIds: any[] = await Lead.distinct('businessId', { businessId: { $ne: null }, tenantId: { $ne: PLATFORM_TENANT } });
  for (const bid of businessIds) {
    const biz: any = await Business.findById(bid).select('leadStages').lean();
    counts.businessesWithCustomerLeads++;
    const stored = biz?.leadStages;
    const config = assignSubStageIds(resolveLeadStagesConfig(stored), resolveLeadStagesConfig(stored));
    if (biz && stored && SUB_STAGE_GROUPS.some((g) => (stored[g] || []).some((s: any) => !s?.id))) {
      counts.stageConfigsGettingIds++;
      if (APPLY) {
        save({ collection: 'businesses', _id: String(bid), before: before(biz, ['leadStages']) });
        await Business.updateOne({ _id: bid }, { $set: { leadStages: config } }, { timestamps: false });
      }
    }

    const cursor = Lead.find({ businessId: bid, tenantId: { $ne: PLATFORM_TENANT } })
      .select('lifeCycleStage subStage subStageId pipelineStage deal convertedAt lostAt updatedAt source')
      .lean()
      .cursor();
    for await (const lead of cursor as any) {
      counts.leadsScanned++;
      const set: Record<string, unknown> = { ...(planLeadStageMigration(lead, config) ?? {}) };
      if (set.lifeCycleStage) counts.legacyPipelineStageMapped++;
      if (set.subStageId && !set.lifeCycleStage) counts.subStageIdAdded++;
      if ((set.deal as any)?.valueMissing) counts.convertedMarkedValueMissing++;
      if (lead.source != null && !validSources.includes(lead.source)) {
        set.source = canonicalSource(lead.source);
        counts.invalidSourceFixed++;
      }
      if (!Object.keys(set).length) continue;
      counts.leadsUpdated++;
      if (samples.length < SAMPLE) samples.push(`  lead ${lead._id}: ${JSON.stringify(set)}`);
      if (APPLY) {
        save({ collection: 'leads', _id: String(lead._id), before: before(lead, Object.keys(set)) });
        await Lead.updateOne({ _id: lead._id }, { $set: set }, { timestamps: false });
      }
    }

    const leadIds = await Lead.find({ businessId: bid, tenantId: { $ne: PLATFORM_TENANT } }).distinct('_id');
    const legacyFilter = { leadId: { $in: leadIds }, kind: { $ne: 'task' }, status: 'pending' };
    const legacy: any[] = await FollowUp.find(legacyFilter).select('status').lean();
    counts.legacyFollowUpsCancelled += legacy.length;
    if (APPLY && legacy.length) {
      for (const f of legacy) save({ collection: 'followups', _id: String(f._id), before: { status: f.status } });
      await FollowUp.updateMany({ _id: { $in: legacy.map((f) => f._id) } }, { $set: { status: 'cancelled' } }, { timestamps: false });
    }
  }

  if (backup) await new Promise<void>((r) => backup!.end(r));
  if (samples.length) console.log(`Sample changes (first ${SAMPLE}):\n${samples.join('\n')}`);
  console.log(counts);
  const pending = counts.stageConfigsGettingIds + counts.leadsUpdated + counts.legacyFollowUpsCancelled + (APPLY ? 0 : indexPlan.length);
  if (counts.customerLeadsWithoutBusinessId) {
    console.log(`Note: ${counts.customerLeadsWithoutBusinessId} legacy customer lead(s) have no businessId — not shown in any workspace today, left untouched.`);
  }
  if (VERIFY) {
    console.log(pending === 0 ? 'VERIFY OK — nothing left to migrate.' : `VERIFY: ${pending} item(s) still need migrating.`);
    await mongoose.disconnect();
    process.exit(pending === 0 ? 0 : 1);
  }
  if (APPLY) console.log(`Done. Re-run with --verify to confirm (expect "nothing left to migrate"). Rollback: --rollback=${backupPath}`);
  await mongoose.disconnect();
}

// Exit explicitly: imported models can leave timers open after disconnect.
main().then(() => process.exit(0)).catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
