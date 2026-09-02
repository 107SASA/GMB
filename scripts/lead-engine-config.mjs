/**
 * Operator control panel for the LEAD_ENGINE_V2 controlled test — manages the
 * single OrchestrationConfig {key:'default'} document (the cohort gate).
 *
 * LEAD_ENGINE_V2 is a TWO-gate mechanism:
 *   1. process.env.LEAD_ENGINE_V2 === 'true'   (env var — needs a redeploy/restart)
 *   2. the lead is in the cohort               (this doc — takes effect immediately)
 * BOTH must pass. This script only touches gate 2.
 *
 * Commands:
 *   node scripts/lead-engine-config.mjs status
 *   node scripts/lead-engine-config.mjs init
 *   node scripts/lead-engine-config.mjs allow <phone-or-leadId> [more...]
 *   node scripts/lead-engine-config.mjs remove <phone-or-leadId> [more...]
 *   node scripts/lead-engine-config.mjs disable        # empties allowlist + sets rollout 0 (instant kill of gate 2)
 *   node scripts/lead-engine-config.mjs rollback       # alias for disable
 *
 * All commands need:  MONGODB_URI="mongodb+srv://..."  (use the SAME DB the app runs against)
 *
 * `allow`/`remove` accept a phone in any format (resolved to a Lead by
 * normalized phone under tenantId 'gmbboost-internal') or a raw 24-hex Lead _id.
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Prefix: MONGODB_URI="..." node scripts/lead-engine-config.mjs <command>');
  process.exit(1);
}

const [, , command, ...rest] = process.argv;
if (!command || !['status', 'init', 'allow', 'remove', 'disable', 'rollback'].includes(command)) {
  console.error('Commands: status | init | allow <id...> | remove <id...> | disable | rollback');
  process.exit(1);
}

const DEFAULTS = {
  key: 'default',
  leadIdAllowlist: [],
  rolloutPercentage: 0,
  stuckLeadScoreThreshold: 76,
  stuckNurtureCyclesThreshold: 3,
};

function normE164(raw) {
  const t = String(raw).trim();
  const hasPlus = t.startsWith('+') || t.startsWith('00');
  let d = t.replace(/\D/g, '');
  if (t.startsWith('00')) d = d.slice(2);
  if (!d) return null;
  if (hasPlus) return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  d = d.replace(/^0+/, '');
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith('91')) return `+${d}`;
  return null;
}

async function resolveToLeadId(coll, token) {
  if (/^[a-f0-9]{24}$/i.test(token)) {
    const l = await coll.findOne({ _id: new mongoose.Types.ObjectId(token) }, { projection: { _id: 1, phone: 1, name: 1, tenantId: 1 } });
    return l ? { _id: l._id, phone: l.phone, name: l.name, tenantId: l.tenantId } : null;
  }
  const e164 = normE164(token);
  if (!e164) return null;
  const l = await coll.findOne(
    { phone: e164, tenantId: 'gmbboost-internal' },
    { projection: { _id: 1, phone: 1, name: 1, tenantId: 1 } }
  );
  return l ? { _id: l._id, phone: l.phone, name: l.name, tenantId: l.tenantId } : null;
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const cfgs = db.collection('orchestrationconfigs');
  const leadsColl = db.collection('leads');

  const dbName = db.databaseName;

  if (command === 'init') {
    const res = await cfgs.updateOne({ key: 'default' }, { $setOnInsert: DEFAULTS }, { upsert: true });
    console.log(res.upsertedCount ? `Created OrchestrationConfig{key:'default'} in db "${dbName}".` : `OrchestrationConfig already exists in db "${dbName}" — left unchanged.`);
  }

  if (command === 'disable' || command === 'rollback') {
    await cfgs.updateOne(
      { key: 'default' },
      { $set: { leadIdAllowlist: [], rolloutPercentage: 0 }, $setOnInsert: { key: 'default', stuckLeadScoreThreshold: 76, stuckNurtureCyclesThreshold: 3 } },
      { upsert: true }
    );
    console.log(`Cohort emptied (allowlist=[], rolloutPercentage=0) in db "${dbName}".`);
    console.log('Gate 2 is now closed for everyone — next scheduler tick will SKIP any pending V2 rows.');
    console.log('Note: this does NOT unset LEAD_ENGINE_V2 (gate 1). For a full stop also set LEAD_ENGINE_V2=false and redeploy.');
  }

  if (command === 'allow' || command === 'remove') {
    if (!rest.length) { console.error(`Usage: ${command} <phone-or-leadId> [more...]`); process.exit(1); }
    await cfgs.updateOne({ key: 'default' }, { $setOnInsert: DEFAULTS }, { upsert: true });

    const resolved = [];
    for (const token of rest) {
      const lead = await resolveToLeadId(leadsColl, token);
      if (!lead) { console.log(`  ✗ "${token}" — no Lead found (phone must exist as a tenantId:'gmbboost-internal' Lead, or pass a 24-hex _id)`); continue; }
      resolved.push(lead);
      console.log(`  ✓ "${token}" -> ${lead._id}  ${lead.name || '(no name)'}  ${lead.phone || ''}`);
    }
    if (!resolved.length) { console.log('Nothing resolved — no change.'); }
    else {
      const ids = resolved.map((r) => r._id);
      const op = command === 'allow'
        ? { $addToSet: { leadIdAllowlist: { $each: ids } } }
        : { $pull: { leadIdAllowlist: { $in: ids } } };
      await cfgs.updateOne({ key: 'default' }, op);
      console.log(`${command === 'allow' ? 'Added to' : 'Removed from'} allowlist: ${ids.length} lead(s).`);
    }
  }

  // Always finish by printing status
  const cfg = await cfgs.findOne({ key: 'default' });
  console.log('\n' + '='.repeat(70));
  console.log(`OrchestrationConfig  (db: ${dbName})`);
  console.log('='.repeat(70));
  if (!cfg) {
    console.log('NO DOCUMENT — run:  node scripts/lead-engine-config.mjs init');
  } else {
    console.log(`  rolloutPercentage:          ${cfg.rolloutPercentage ?? 0}`);
    console.log(`  cooldownHours (doc):        ${cfg.cooldownHours ?? '(unset — 4h default / ORCHESTRATOR_COOLDOWN_HOURS wins)'}`);
    console.log(`  stuckLeadScoreThreshold:    ${cfg.stuckLeadScoreThreshold ?? 76}`);
    console.log(`  stuckNurtureCyclesThreshold:${cfg.stuckNurtureCyclesThreshold ?? 3}`);
    const allow = cfg.leadIdAllowlist || [];
    console.log(`  leadIdAllowlist:            ${allow.length} lead(s)`);
    if (allow.length) {
      const docs = await leadsColl.find({ _id: { $in: allow } }, { projection: { _id: 1, name: 1, phone: 1, currentAgent: 1, currentStage: 1, tenantId: 1 } }).toArray();
      const byId = new Map(docs.map((d) => [String(d._id), d]));
      for (const id of allow) {
        const d = byId.get(String(id));
        console.log(d
          ? `     - ${id}  ${String(d.name || '(no name)').padEnd(20)} ${String(d.phone || '').padEnd(15)} agent=${d.currentAgent || 'NONE'} stage=${d.currentStage || '-'} tenant=${d.tenantId}`
          : `     - ${id}  (⚠️ no matching Lead — stale entry, consider 'remove')`);
      }
    }
  }
  console.log('='.repeat(70));
  console.log('Reminder: gate 1 (LEAD_ENGINE_V2 env var) is separate — check it in the running environment.');

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
