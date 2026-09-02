/**
 * Read-only observability trace for a single lead during the LEAD_ENGINE_V2
 * controlled test. Joins FOUR collections into one chronological timeline so
 * you can see whether a lead actually travels
 *
 *   LEAD_CREATED -> MESSAGE_RECEIVED -> INTENT_CHANGED -> LEAD_SCORE_CHANGED
 *   -> NURTURE_ACTION_SCHEDULED -> MESSAGE_SENT -> ...
 *
 * or just
 *
 *   MESSAGE_SENT x4   (plumbing works, but no intelligence — STOP)
 *
 * Collections joined, keyed by phone (last 10 digits) and any linked Lead._id:
 *   - leads             — current ownership/intelligence snapshot (top of output)
 *   - leadevents        — the decision/action/outcome timeline
 *   - scheduledactions  — PENDING/EXECUTED/SKIPPED nurture rows + reasons
 *   - messagequeue      — actual Twilio/Meta outbound attempts + failedReason
 *
 * NOTHING is written. Safe to run against production.
 *
 * Run:
 *   MONGODB_URI="mongodb+srv://..." node scripts/lead-engine-trace.mjs "+919876543210"
 *   MONGODB_URI="..." node scripts/lead-engine-trace.mjs "+919876543210" --limit 80
 *   MONGODB_URI="..." node scripts/lead-engine-trace.mjs 64f0c...   (a Lead _id also works)
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Prefix the command with MONGODB_URI="..."');
  process.exit(1);
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: MONGODB_URI="..." node scripts/lead-engine-trace.mjs "<phone or leadId>" [--limit N]');
  process.exit(1);
}
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? Number(process.argv[limitIdx + 1]) || 60 : 60;

const isObjectId = /^[a-f0-9]{24}$/i.test(arg);

function last10(p) {
  return String(p).replace(/[^\d]/g, '').slice(-10);
}

function fmt(d) {
  return d instanceof Date ? d.toISOString().replace('T', ' ').slice(0, 19) : String(d ?? '-');
}

function short(v, n = 120) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + '…' : s;
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  const leads = db.collection('leads');
  const leadEvents = db.collection('leadevents');
  const scheduled = db.collection('scheduledactions');
  const mq = db.collection('messagequeue');

  // ---- resolve the lead(s) --------------------------------------------------
  let leadDocs = [];
  let phoneRegex = null;
  if (isObjectId) {
    const l = await leads.findOne({ _id: new mongoose.Types.ObjectId(arg) });
    if (l) {
      leadDocs = [l];
      if (l.phone) phoneRegex = new RegExp(`${last10(l.phone)}$`);
    }
  } else {
    phoneRegex = new RegExp(`${last10(arg)}$`);
    leadDocs = await leads.find({ phone: phoneRegex }).toArray();
  }
  const leadIds = leadDocs.map((l) => l._id);

  console.log('='.repeat(90));
  console.log(`TRACE: ${arg}`);
  console.log('='.repeat(90));

  if (!leadDocs.length) {
    console.log('\nNo Lead document found. (Platform sales/support conversations have no Lead');
    console.log('until a demo is booked — the timeline below is still shown, keyed by phone.)\n');
  }

  for (const l of leadDocs) {
    console.log(`\nLEAD ${l._id}  (tenantId=${l.tenantId ?? '-'})`);
    console.log(`  name:            ${l.name ?? '-'}`);
    console.log(`  phone:           ${l.phone ?? '-'}`);
    console.log(`  currentAgent:    ${l.currentAgent ?? 'NONE'}      currentStage: ${l.currentStage ?? '-'}`);
    console.log(`  nurtureStatus:   ${l.nurtureStatus ?? '-'}       humanHandoff.active: ${l.humanHandoff?.active ?? false}`);
    console.log(`  leadScore:       ${l.leadScore ?? '-'}            intent: ${l.intent ?? '-'}`);
    console.log(`  nextBestAction:  ${l.nextBestAction ?? '-'}       nextActionAt: ${fmt(l.nextActionAt)}`);
    console.log(`  objections:      ${short(l.objections ?? [])}`);
    console.log(`  lastProactiveMessageAt: ${fmt(l.lastProactiveMessageAt)}`);
    console.log(`  recentExtractionConfidences: ${short(l.recentExtractionConfidences ?? [])}`);
  }

  // ---- gather all three timelines ----------------------------------------
  const orPhone = phoneRegex ? [{ phone: phoneRegex }] : [];
  const orLead = leadIds.length ? [{ leadId: { $in: leadIds } }] : [];
  const anyKey = [...orPhone, ...orLead];
  if (!anyKey.length) {
    console.log('\nNothing to trace (no phone match and no leadId).');
    await mongoose.disconnect();
    return;
  }

  const evs = await leadEvents.find({ $or: anyKey }).sort({ createdAt: 1 }).toArray();
  const acts = leadIds.length
    ? await scheduled.find({ leadId: { $in: leadIds } }).sort({ createdAt: 1 }).toArray()
    : [];
  const msgs = await mq
    .find({ $or: [...(phoneRegex ? [{ 'payload.phone': phoneRegex }] : []), ...orLead] })
    .sort({ createdAt: 1 })
    .toArray();

  // ---- merge into one timeline -----------------------------------------
  const rows = [];
  for (const e of evs) {
    rows.push({
      t: e.createdAt,
      kind: 'EVENT',
      line: `${e.type}  actor=${e.actor}  conv=${e.conversationType ?? '-'}` +
            (e.payload ? `\n         payload: ${short(e.payload, 220)}` : ''),
    });
  }
  for (const a of acts) {
    rows.push({
      t: a.createdAt,
      kind: 'SCHED',
      line: `${a.actionType}  status=${a.status}  createdBy=${a.createdBy}` +
            (a.reason ? `  reason=${a.reason}` : '') +
            (a.claimedAt ? `  claimedAt=${fmt(a.claimedAt)}` : '') +
            `  dueAt=${fmt(a.dueAt)}` +
            (a.payload ? `\n         payload: ${short(a.payload, 160)}` : ''),
    });
    if (a.updatedAt && a.status !== 'PENDING' && +a.updatedAt !== +a.createdAt) {
      rows.push({ t: a.updatedAt, kind: 'SCHED', line: `${a.actionType} -> ${a.status}${a.reason ? ` (${a.reason})` : ''}` });
    }
  }
  for (const m of msgs) {
    const p = m.payload || {};
    const content = p.body
      ? `\n         body: ${short(p.body, 200)}`
      : p.contentSid
        ? `\n         template: ${p.contentSid}  vars: ${short(p.variables ?? {}, 120)}`
        : '';
    rows.push({
      t: m.createdAt,
      kind: 'MSG',
      line: `${m.direction ?? 'OUTBOUND'}  status=${m.status}  sid=${p.sid ?? '-'}` +
            (m.failedReason ? `  failedReason=${m.failedReason}` : '') +
            (p.sentAsTemplate ? '  (sent as template fallback)' : '') +
            content,
    });
  }

  rows.sort((a, b) => +new Date(a.t) - +new Date(b.t));

  console.log('\n' + '-'.repeat(90));
  console.log('TIMELINE (chronological — EVENT = decision/state, SCHED = nurture row, MSG = real send)');
  console.log('-'.repeat(90));
  if (!rows.length) {
    console.log('(empty — nothing has happened for this lead yet)');
  }
  for (const r of rows.slice(-LIMIT)) {
    console.log(`${fmt(r.t)}  ${r.kind.padEnd(5)}  ${r.line}`);
  }

  // ---- quick verdict --------------------------------------------------------
  const types = new Set(evs.map((e) => e.type));
  const intelligenceSeen = ['INTENT_CHANGED', 'LEAD_SCORE_CHANGED', 'OBJECTION_DETECTED', 'NBA_OVERRIDDEN'].some((t) => types.has(t));
  const sends = evs.filter((e) => e.type === 'MESSAGE_SENT').length;
  console.log('\n' + '-'.repeat(90));
  console.log(`SUMMARY: ${evs.length} events, ${acts.length} scheduled actions, ${msgs.length} outbound attempts, ${sends} MESSAGE_SENT`);
  if (sends >= 2 && !intelligenceSeen) {
    console.log('⚠️  Multiple sends but NO intent/score/objection/NBA events — plumbing only, no intelligence.');
  } else if (intelligenceSeen) {
    console.log('✓  Intelligence events present (intent/score/objection changed) — the loop is doing more than sending.');
  }
  console.log('-'.repeat(90));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
