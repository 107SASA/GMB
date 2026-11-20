/**
 * One-off: delete Super Admin CRM leads by phone (e.g. a CSV imported by
 * mistake). The CRM has no delete button.
 *
 * Removed with each lead: its timeline events, follow-ups, scheduled AI
 * actions and unsent queued messages; a queued campaign message to it is
 * marked skipped, so nothing is sent to a deleted lead. Sent WhatsApp
 * history is kept.
 *
 * Safety: a lead that is a customer, a Growth Partner lead, or has a demo
 * booking is NOT deleted unless --force is given.
 *
 *   Dry run (lists what would be deleted, no writes):
 *     npx tsx scripts/delete-leads.ts --phones 919741303741,919972821065
 *   Delete:
 *     npx tsx scripts/delete-leads.ts --phones 919741303741,919972821065 --apply
 *   Or one number per line in a file:
 *     npx tsx scripts/delete-leads.ts --file phones.txt [--apply]
 *
 * On the droplet, prefix MONGODB_URI from .env.production (see deploy notes).
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { phoneDedupeKey } from '../src/lib/phone.ts';
import Lead from '../src/models/Lead.ts';
import LeadEvent from '../src/models/LeadEvent.ts';
import FollowUp from '../src/models/FollowUp.ts';
import ScheduledAction from '../src/models/ScheduledAction.ts';
import MessageQueue from '../src/models/MessageQueue.ts';
import DemoBooking from '../src/models/DemoBooking.ts';
import WhatsAppCampaignRecipient from '../src/models/WhatsAppCampaignRecipient.ts';

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
const FORCE = process.argv.includes('--force');
const file = arg('file');
const rawPhones = `${arg('phones')} ${file && fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''}`;
const keys = [...new Set(rawPhones.split(/[,\s]+/).map((p) => phoneDedupeKey(p)).filter(Boolean) as string[])];

if (!keys.length) {
  console.error('Give the numbers: --phones 919741303741,919972821065  or  --file phones.txt');
  process.exit(1);
}
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set (put it in .env.local or prefix the command).');
  process.exit(1);
}

async function main() {
  await mongoose.connect(uri!);
  // Last 10 digits, so +91 / 91 / 0 prefixes all match.
  const found: any[] = await Lead.collection
    .find({ tenantId: 'gmbboost-internal', phone: { $in: keys.map((k) => new RegExp(`${k}$`)) } })
    .project({ name: 1, phone: 1, source: 1, currentStage: 1, currentAgent: 1, partnerId: 1 })
    .toArray();

  const matched = new Set<string>();
  const toDelete: any[] = [];
  for (const lead of found) {
    const key = phoneDedupeKey(lead.phone);
    if (key) matched.add(key);
    const label = `${lead.name || '(no name)'}  ${lead.phone}  [${lead.source || '-'}]`;
    const reasons: string[] = [];
    if (lead.currentStage === 'CUSTOMER' || lead.currentAgent === 'IN_HOUSE') reasons.push('customer');
    if (lead.partnerId) reasons.push('Growth Partner lead');
    if (await DemoBooking.exists({ leadId: lead._id })) reasons.push('has a demo booking');
    if (reasons.length && !FORCE) {
      console.log(`  KEPT (${reasons.join(', ')} — add --force to delete): ${label}`);
      continue;
    }
    console.log(`  ${APPLY ? 'deleting' : 'would delete'}: ${label}${reasons.length ? `  (${reasons.join(', ')})` : ''}`);
    toDelete.push(lead);
  }
  for (const k of keys) if (!matched.has(k)) console.log(`  not found in the CRM: ${k}`);

  if (APPLY && toDelete.length) {
    const ids = toDelete.map((l) => l._id);
    const [events, followUps, actions, queued, campaign, leads] = await Promise.all([
      LeadEvent.collection.deleteMany({ leadId: { $in: ids } }),
      FollowUp.collection.deleteMany({ leadId: { $in: ids } }),
      ScheduledAction.collection.deleteMany({ leadId: { $in: ids } }),
      MessageQueue.collection.deleteMany({ leadId: { $in: ids }, status: 'PENDING' }),
      WhatsAppCampaignRecipient.collection.updateMany({ leadId: { $in: ids }, status: 'queued' }, { $set: { status: 'skipped' } }),
      Lead.collection.deleteMany({ _id: { $in: ids } }),
    ]);
    console.log(`\nDeleted ${leads.deletedCount} lead(s); also removed ${events.deletedCount} timeline event(s), ${followUps.deletedCount} follow-up(s), ${actions.deletedCount} scheduled action(s), ${queued.deletedCount} queued message(s); ${campaign.modifiedCount} queued campaign message(s) skipped.`);
  } else {
    console.log(`\n${APPLY ? 'Nothing to delete.' : `Would delete ${toDelete.length} lead(s). Dry run — add --apply to delete.`}`);
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
