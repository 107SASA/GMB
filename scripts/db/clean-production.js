#!/usr/bin/env node
/**
 * Fresh start for the production database: removes every user, business,
 * lead, chat, report, review, payment record and log — and keeps the Super
 * Admin team and everything set up in the Super Admin (agent settings,
 * nurture schedule, plans and billing policy, CRM stages, WhatsApp templates,
 * review follow-up settings, salesperson calendars) plus public lookup caches.
 *
 * DRY RUN by default: prints what it would keep and delete, changes nothing.
 *
 *   node scripts/db/clean-production.js --backup-db growwmatics_dev
 *   node scripts/db/clean-production.js --backup-db growwmatics_dev --apply --confirm <this database's name>
 *
 * --keep-email <email> (repeatable): also keep that customer account and its
 * whole workspace — organization, businesses, subscription and everything
 * linked to them — e.g. the store reviewer account (reviewer@growwmatics.com).
 * Stops if the email is not found, so a typo never deletes it.
 *
 * --backup-db: the copy made with scripts/db/copy-database.js on the same
 * cluster. It must exist and hold as many users as this database, or nothing
 * is deleted. Collections deleted are emptied (not dropped), so their indexes
 * stay. A collection the script does not know is left alone and listed.
 * Prints counts only — no names, emails or phone numbers.
 */
const { loadEnvConfig } = require('@next/env');
const { MongoClient } = require('mongodb');

/** Set up in the Super Admin, or shared public data — kept as is. */
const KEEP = {
  salesagentconfigs: 'Sales Agent settings',
  bookingagentconfigs: 'Booking Agent settings',
  reportagentconfigs: 'Report Agent settings',
  orchestrationconfigs: 'nurture / orchestration settings',
  nurtureconfigaudits: 'history of nurture setting changes',
  scoringruleconfigs: 'lead scoring rules',
  billingpolicies: 'Billing Controls',
  billingplans: 'plans and prices',
  plans: 'plans',
  planconfigs: 'plan limits',
  platformsettings: 'platform settings',
  platformcrmconfigs: 'CRM custom stages',
  contenttemplates: 'content templates',
  whatsapptemplates: 'WhatsApp templates (Settings)',
  reviewfollowuppolicies: 'review follow-up settings',
  admininvites: 'Super Admin team invites',
  adminactionlogs: 'Super Admin action history',
  keywordvolumecaches: 'public keyword-volume cache',
  placeinsightcaches: 'public Google Maps cache',
  localitycaches: 'public locality cache',
  websiteintelligences: 'public website facts cache',
};

/** Kept only for the Super Admin team (see below). */
const PARTIAL = {
  users: 'Super Admins (links to deleted businesses removed) and --keep-email accounts kept; every other user deleted',
  salespersoncalendarconnections: "Super Admins' Google Calendars kept; others deleted",
  securityevents: 'Super Admin sign-ins and admin actions kept; customer sign-ins, login codes and webhook rejections deleted',
};

/** User data, conversations, payments and logs — emptied. */
const DELETE = [
  'accountpurgelogs', 'activities', 'aiusagelogs', 'appointments', 'audits', 'automationlogs',
  'billingevents', 'billingrecoveryepisodes', 'bookingconversations', 'businessaiconfigs', 'businesses',
  'callevents', 'campaigns', 'contentgenerationlogs', 'conversations', 'conversationthreads', 'customers',
  'demobookings', 'faqs', 'festivalprompts', 'followups', 'gbpconnecthandoffs', 'gbpinsights', 'gbpkeywordintels',
  'gbpkeywords', 'gbplocationsnapshots', 'gbpmediaassets', 'gbpprofilechanges', 'gbptokens', 'jobqueues',
  'leadevents', 'leads', 'loginlinks', 'messagequeues', 'messagingsuppressions', 'notifications',
  'optimizationactions', 'organizations', 'ownernotifydigests', 'pendinggbpconnections', 'posts',
  'processedwebhookevents', 'profileactivities', 'reportconversations', 'reportshares', 'reviewanalytics',
  'reviewmonitorlogs', 'reviewreplies', 'reviewrequests', 'reviews', 'salesconversations', 'scheduledactions',
  'seocontents', 'seoplans', 'showcaseassets', 'subscriptions', 'subscriptionusages', 'supportconversations',
  'testimonials', 'trialclaims', 'usagetrackings', 'userlimitoverrides', 'weeklymonitors', 'weeklyoffers',
  'whatsappappointments', 'whatsappcampaignrecipients', 'whatsappcampaigns', 'whatsappconversationsummaries',
  'whatsappmessages', 'whatsappthreads',
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function args(name) {
  return process.argv.flatMap((a, i) => (a === name && process.argv[i + 1] ? [process.argv[i + 1]] : []));
}

(async () => {
  const { combinedEnv } = loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const uri = process.env.MONGODB_URI || combinedEnv.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set.');
  const apply = process.argv.includes('--apply');
  const backupName = arg('--backup-db');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const host = String(uri).replace(/^[a-z+]+:\/\/([^@]*@)?/, '').split('/')[0].split('?')[0];
  console.log(`Database: ${host} / ${db.databaseName}`);
  console.log(apply ? 'MODE: APPLY — data will be deleted\n' : 'MODE: DRY RUN — nothing is changed\n');

  // 1. The copy must exist before anything is deleted.
  if (!backupName) throw new Error('Give --backup-db <name of the copy made with copy-database.js>.');
  if (backupName === db.databaseName) throw new Error('--backup-db must be the copy, not this database.');
  const backup = client.db(backupName);
  const [usersHere, usersInBackup] = await Promise.all([db.collection('users').countDocuments(), backup.collection('users').countDocuments()]);
  if (!usersInBackup || usersInBackup < usersHere) {
    throw new Error(`The copy "${backupName}" has ${usersInBackup} users, this database has ${usersHere}. Make the copy first (copy-database.js).`);
  }
  console.log(`Copy "${backupName}" found: ${usersInBackup} users (this database: ${usersHere}).\n`);

  const present = new Set((await db.listCollections({ type: 'collection' }, { nameOnly: true }).toArray()).map((c) => c.name));
  const count = (name, q = {}) => (present.has(name) ? db.collection(name).countDocuments(q) : Promise.resolve(0));

  // 2. Customer accounts kept on request (--keep-email), with their whole workspace.
  const keepEmails = args('--keep-email').map((e) => e.trim().toLowerCase());
  const keptUsers = keepEmails.length && present.has('users')
    ? await db.collection('users').find({ email: { $in: keepEmails } }, { projection: { email: 1, role: 1, organizationId: 1, businessIds: 1 } }).toArray()
    : [];
  const missing = keepEmails.filter((e) => !keptUsers.some((u) => String(u.email).toLowerCase() === e));
  if (missing.length) throw new Error(`--keep-email not found in this database: ${missing.join(', ')}`);
  const keptUserIds = keptUsers.map((u) => u._id);
  const keptBusinesses = keptUserIds.length
    ? await db.collection('businesses').find({ $or: [{ userId: { $in: keptUserIds } }, { _id: { $in: keptUsers.flatMap((u) => u.businessIds || []) } }] }, { projection: { _id: 1, organizationId: 1 } }).toArray()
    : [];
  const keptBizIds = keptBusinesses.map((b) => b._id);
  const keptOrgIds = [...new Map([...keptUsers, ...keptBusinesses].filter((d) => d.organizationId).map((d) => [String(d.organizationId), d.organizationId])).values()];
  // A document survives when it is, or belongs to, a kept account / workspace.
  const keptLinks = keptUserIds.length
    ? [
      { _id: { $in: [...keptUserIds, ...keptBizIds, ...keptOrgIds] } },
      { businessId: { $in: keptBizIds } },
      { userId: { $in: keptUserIds } },
      { organizationId: { $in: keptOrgIds } },
    ]
    : null;
  const deleteFilter = keptLinks ? { $nor: keptLinks } : {};

  // 3. Paid or trial workspaces: their Razorpay subscription keeps charging unless cancelled in Razorpay.
  const billed = await count('businesses', {
    _id: { $nin: keptBizIds },
    razorpaySubscriptionId: { $exists: true, $nin: [null, ''] },
    subscriptionStatus: { $in: ['active', 'trial_active', 'past_due'] },
  });
  if (billed) {
    console.log(`WARNING: ${billed} workspace(s) have an active, trial or past-due Razorpay subscription.`);
    console.log('         Deleting them here does NOT stop Razorpay. Cancel those subscriptions in the Razorpay');
    console.log('         dashboard (Live mode → Subscriptions) first, then run with --razorpay-cancelled.\n');
  }

  // 4. Who is kept.
  const admins = present.has('users')
    ? await db.collection('users').find({ role: 'SUPER_ADMIN' }, { projection: { _id: 1 } }).toArray()
    : [];
  const adminIds = admins.map((u) => u._id);
  if (!adminIds.length) throw new Error('No Super Admin account found — refusing to remove every user.');
  const partialFilters = {
    users: { role: { $ne: 'SUPER_ADMIN' }, _id: { $nin: keptUserIds } },
    salespersoncalendarconnections: { userId: { $nin: [...adminIds, ...keptUserIds] } },
    securityevents: { $nor: [{ type: /^admin\./ }, { userId: { $in: [...adminIds, ...keptUserIds] } }] },
  };

  console.log('KEEP (Super Admin setup and public caches)');
  for (const [name, what] of Object.entries(KEEP)) {
    if (present.has(name)) console.log(`  ${name.padEnd(34)} ${String(await count(name)).padStart(7)}  ${what}`);
  }
  console.log('\nPARTLY KEPT');
  for (const [name, what] of Object.entries(PARTIAL)) {
    if (!present.has(name)) continue;
    const [total, removed] = await Promise.all([count(name), count(name, partialFilters[name])]);
    console.log(`  ${name.padEnd(34)} keep ${String(total - removed).padStart(5)}, delete ${String(removed).padStart(6)}  ${what}`);
  }
  console.log(keptLinks
    ? `\nDELETE (all but the ${keptUsers.length} kept account(s)' workspace data; indexes kept)`
    : '\nDELETE (emptied, indexes kept)');
  let toDelete = 0;
  for (const name of DELETE) {
    if (!present.has(name)) continue;
    const [total, n] = await Promise.all([count(name), count(name, deleteFilter)]);
    toDelete += n;
    if (total) console.log(`  ${name.padEnd(34)} ${String(n).padStart(7)}${total > n ? `  (keep ${total - n})` : ''}`);
  }
  const known = new Set([...Object.keys(KEEP), ...Object.keys(PARTIAL), ...DELETE]);
  const unknown = [...present].filter((name) => !known.has(name) && !name.startsWith('system.'));
  if (unknown.length) {
    console.log('\nNOT TOUCHED (not in this script\'s lists — tell the developer what they are)');
    for (const name of unknown) console.log(`  ${name.padEnd(34)} ${String(await count(name)).padStart(7)}`);
  }
  console.log(`\n${toDelete} documents deleted from the collections above, ${adminIds.length} Super Admin account(s) kept.`);
  if (keptUsers.length) {
    console.log(`Also kept: ${keptUsers.map((u) => `${u.email} (${u.role})`).join(', ')} with ${keptBizIds.length} business(es), ${keptOrgIds.length} organization(s).`);
  }

  if (!apply) {
    console.log('\nDry run only. To delete, run again with:');
    console.log(`  --backup-db ${backupName}${keepEmails.map((e) => ` --keep-email ${e}`).join('')} --apply --confirm ${db.databaseName}${billed ? ' --razorpay-cancelled' : ''}`);
    await client.close();
    return;
  }

  // 5. Apply.
  if (arg('--confirm') !== db.databaseName) throw new Error(`--confirm must be exactly "${db.databaseName}".`);
  if (billed && !process.argv.includes('--razorpay-cancelled')) {
    throw new Error('Cancel the Razorpay subscriptions listed above first, then add --razorpay-cancelled.');
  }
  for (const name of DELETE) {
    if (!present.has(name)) continue;
    const res = await db.collection(name).deleteMany(deleteFilter);
    if (res.deletedCount) console.log(`  ${name}: deleted ${res.deletedCount}`);
  }
  for (const [name, filter] of Object.entries(partialFilters)) {
    if (!present.has(name)) continue;
    const res = await db.collection(name).deleteMany(filter);
    console.log(`  ${name}: deleted ${res.deletedCount}`);
  }
  // Kept admins no longer point at deleted workspaces.
  const unlinked = await db.collection('users').updateMany(
    { role: 'SUPER_ADMIN' },
    { $set: { businessIds: [] }, $unset: { activeBusinessId: '', organizationId: '' } }
  );
  console.log(`  Super Admin accounts unlinked from deleted workspaces: ${unlinked.modifiedCount}`);
  console.log('\nDone. Restart the app (pm2 restart growwmatics) so nothing cached in memory is reused.');
  await client.close();
})().catch((err) => { console.error('\nStopped, nothing more was changed:', err.message); process.exit(1); });
