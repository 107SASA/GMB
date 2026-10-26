/**
 * READ-ONLY duplicate-lead report. Writes nothing, deletes nothing, merges
 * nothing — it only reads the `leads` collection and prints groups.
 *
 * Two leads are reported as duplicates when they are in the SAME tenant and
 * their phones normalise to the same E.164 number (+919876543210,
 * 919876543210, 9876543210, 09876543210, "+91 98765 43210" are one number).
 * Leads without a usable phone are skipped. Different tenants never match:
 * the same person can legitimately be a lead of several businesses.
 *
 * Run it before considering a unique (tenantId, phone) index — the index
 * cannot be built while any exact-phone duplicates exist, and format-variant
 * duplicates need a reviewed identity rule before anything is merged.
 *
 *   node --env-file=.env.production scripts/report-duplicate-leads.mjs [--tenant gmbboost-internal] [--json out.json]
 */
import { writeFileSync } from 'node:fs';
import mongoose from 'mongoose';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

/** Same rules as src/lib/phone.ts normalizePhoneE164 for the formats leads are stored in. */
export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^whatsapp:/i, '');
  const hasPlus = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);
  if (!digits) return null;
  if (hasPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export async function duplicateLeadReport(db, { tenant } = {}) {
  const match = tenant ? { tenantId: tenant } : {};
  const cursor = db.collection('leads').find(match, {
    projection: { tenantId: 1, phone: 1, name: 1, createdAt: 1, currentStage: 1, currentAgent: 1, leadType: 1 },
  });
  const groups = new Map();
  let scanned = 0;
  let noPhone = 0;
  for await (const l of cursor) {
    scanned += 1;
    const e164 = normalizePhone(l.phone);
    if (!e164) { noPhone += 1; continue; }
    const key = `${l.tenantId}|${e164}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  const duplicates = [...groups.entries()]
    .filter(([, leads]) => leads.length > 1)
    .map(([key, leads]) => {
      const [tenantId, phone] = key.split('|');
      const exact = new Set(leads.map((l) => l.phone)).size < leads.length;
      return {
        tenantId,
        phone,
        count: leads.length,
        // Exact duplicates block a unique (tenantId, phone) index; format variants don't, but are still the same person.
        kind: exact ? 'exact' : 'format-variant',
        leads: leads
          .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
          .map((l) => ({ id: String(l._id), storedPhone: l.phone, name: l.name, createdAt: l.createdAt, stage: l.currentStage, agent: l.currentAgent, leadType: l.leadType })),
      };
    })
    .sort((a, b) => b.count - a.count);
  return { scanned, noPhone, groups: duplicates.length, extraLeads: duplicates.reduce((n, g) => n + g.count - 1, 0), duplicates };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Run with --env-file=.env.production (or prefix MONGODB_URI="...").');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const tenant = arg('--tenant');
  const report = await duplicateLeadReport(db, { tenant });
  console.log(`READ-ONLY report on "${db.databaseName}"${tenant ? `, tenant ${tenant}` : ', all tenants'}`);
  console.log(`Scanned ${report.scanned} leads (${report.noPhone} without a usable phone).`);
  console.log(`${report.groups} duplicate group(s), ${report.extraLeads} extra lead(s).\n`);
  for (const g of report.duplicates) {
    console.log(`${g.tenantId}  ${g.phone}  ×${g.count}  [${g.kind}]`);
    for (const l of g.leads) console.log(`    ${l.id}  ${String(l.storedPhone).padEnd(16)} ${l.stage ?? '-'}/${l.agent ?? '-'}  ${new Date(l.createdAt || 0).toISOString().slice(0, 10)}  ${l.name ?? ''}`);
  }
  const out = arg('--json');
  if (out) {
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\nWrote ${out}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error('Failed:', err?.message || err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
