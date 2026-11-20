/**
 * One-off: give existing Super Admin CRM leads the right source, matched by
 * phone. Made for leads a CSV import saved as "CSV Import" because their
 * source ("Event") was not a known source yet — the original word was not
 * kept, so the phones are the only way to find them.
 *
 * Only leads whose source is still "CSV Import" are changed (unless --any).
 * "CSV Import" in their channel list is replaced too, so the Source filter
 * shows them under the new source only.
 *
 *   Dry run (shows what would change, no writes):
 *     npx tsx scripts/set-lead-source.ts --source Event --phones 9051783110,9618754411
 *   Apply:
 *     npx tsx scripts/set-lead-source.ts --source Event --phones 9051783110,9618754411 --apply
 *
 * On the droplet, prefix MONGODB_URI from .env.production (see deploy notes).
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { CRM_SOURCES } from '../src/lib/admin/platformCrm.ts';
import { phoneDedupeKey } from '../src/lib/phone.ts';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
  }
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] || '' : '';
};
const APPLY = process.argv.includes('--apply');
const ANY = process.argv.includes('--any');
const source = CRM_SOURCES.find((s) => s.toLowerCase() === arg('source').trim().toLowerCase());
const keys = [...new Set(arg('phones').split(/[,\s]+/).map((p) => phoneDedupeKey(p)).filter(Boolean) as string[])];

if (!source) {
  console.error(`--source must be one of: ${CRM_SOURCES.join(', ')}`);
  process.exit(1);
}
if (!keys.length) {
  console.error('--phones is required: comma-separated numbers, e.g. --phones 9051783110,9618754411');
  process.exit(1);
}
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set (put it in .env.local or prefix the command).');
  process.exit(1);
}

async function main() {
  await mongoose.connect(uri!);
  const leads = mongoose.connection.collection('leads');
  // Last 10 digits, so +91 / 91 / 0 prefixes all match.
  const rx = keys.map((k) => new RegExp(`${k}$`));
  const found = await leads
    .find({ tenantId: 'gmbboost-internal', phone: { $in: rx } })
    .project({ name: 1, phone: 1, source: 1, captureSources: 1 })
    .toArray();

  const matched = new Set<string>();
  let changed = 0;
  for (const lead of found) {
    const key = phoneDedupeKey(lead.phone);
    if (key) matched.add(key);
    const label = `${lead.name || '(no name)'} ${lead.phone}`;
    if (lead.source === source) { console.log(`  already ${source}: ${label}`); continue; }
    if (!ANY && lead.source !== 'CSV Import') { console.log(`  skipped (source is ${lead.source}): ${label}`); continue; }
    const sources: string[] = Array.isArray(lead.captureSources) ? lead.captureSources : [];
    const nextSources = [...new Set([...sources.filter((s) => s !== lead.source), source])];
    console.log(`  ${APPLY ? 'changed' : 'would change'}: ${label}  ${lead.source} → ${source}`);
    if (APPLY) await leads.updateOne({ _id: lead._id }, { $set: { source, captureSources: nextSources } });
    changed++;
  }
  for (const k of keys) if (!matched.has(k)) console.log(`  not found in the CRM: ${k}`);
  console.log(`\n${APPLY ? 'Changed' : 'Would change'} ${changed} lead(s).${APPLY ? '' : ' Dry run — add --apply to save.'}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
