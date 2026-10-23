/**
 * One-off: switch every business to auto-reply (reviewReplySettings.mode
 * 'auto'), the new default — owner's decision, Oct 23 2026. Rules:
 * src/lib/reviewReplyConsent.ts.
 *
 * SAFETY
 *  - Loads NO .env file: the target database must be given explicitly.
 *  - Dry run by default — prints counts, writes nothing, queues nothing.
 *  - Writing requires --apply AND --confirm-db=<the database name in MONGODB_URI>.
 *  - Only sets reviewReplySettings.mode; tone, reviews and drafts are untouched.
 *    Writes the ids it switched to a JSON file so the change can be undone.
 *  - --queue-backlog (with --apply) also queues each switched, Google-connected
 *    business's unreplied reviews for the auto-reply job — the same thing the
 *    owner switching auto on does. That runs AI drafting and posts replies to
 *    Google, so it needs INNGEST_EVENT_KEY for the target environment and
 *    should run off-peak (each review is one or two Groq calls).
 *
 *   MONGODB_URI=<uri> npx tsx scripts/migrate-review-reply-auto.ts
 *   MONGODB_URI=<uri> npx tsx scripts/migrate-review-reply-auto.ts --apply --confirm-db=<db>
 *   MONGODB_URI=<uri> INNGEST_EVENT_KEY=<key> npx tsx scripts/migrate-review-reply-auto.ts --apply --confirm-db=<db> --queue-backlog
 */
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name: string) => flag(name)?.split('=').slice(1).join('=') || '';
const queueBacklog = !!flag('queue-backlog');

for (const k of Object.keys(process.env)) {
  // Nothing here needs storage, messaging, billing or AI credentials; Inngest only to queue the backlog.
  if (/^(DO_SPACES|TWILIO|META_|RAZORPAY|GROQ|OPENAI|RESEND|SENDGRID)_?/.test(k)) delete process.env[k];
  if (!queueBacklog && /^INNGEST_/.test(k)) delete process.env[k];
}

function dbNameOf(uri: string): string {
  try {
    const u = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
    return decodeURIComponent(u.pathname.replace(/^\//, '')) || '(default "test")';
  } catch {
    return '(unparseable)';
  }
}

async function main(): Promise<number> {
  const uri = process.env.MONGODB_URI || '';
  if (!uri) {
    console.error('MONGODB_URI must be set explicitly for this run (no .env file is read).');
    return 2;
  }
  const db = dbNameOf(uri);
  const apply = !!flag('apply');
  if (apply && value('confirm-db') !== db) {
    console.error(`Refusing to write: pass --confirm-db=${db} to confirm the target database.`);
    return 2;
  }
  if (queueBacklog && !apply) {
    console.error('--queue-backlog only runs together with --apply.');
    return 2;
  }
  if (queueBacklog && !process.env.INNGEST_EVENT_KEY) {
    console.error('--queue-backlog needs INNGEST_EVENT_KEY for the target environment.');
    return 2;
  }

  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();
  const { default: Business } = await import('../src/models/Business');
  const { default: Review } = await import('../src/models/Review');

  const notAuto = { isDeleted: { $ne: true }, 'reviewReplySettings.mode': { $ne: 'auto' } };
  const [alreadyAuto, manual, unset] = await Promise.all([
    Business.countDocuments({ isDeleted: { $ne: true }, 'reviewReplySettings.mode': 'auto' }),
    Business.countDocuments({ isDeleted: { $ne: true }, 'reviewReplySettings.mode': 'manual' }),
    Business.countDocuments({ isDeleted: { $ne: true }, 'reviewReplySettings.mode': { $exists: false } }),
  ]);
  const targets = await Business.find(notAuto).select('_id googleConnected').lean<{ _id: any; googleConnected?: boolean }[]>();
  const connectedIds = targets.filter((b) => b.googleConnected).map((b) => b._id);
  const backlog = connectedIds.length
    ? await Review.countDocuments({ businessId: { $in: connectedIds }, response: { $in: [null, undefined, ''] }, replyStatus: { $in: [null, 'PENDING'] } })
    : 0;

  console.log(`[migrate] database: ${db} — ${apply ? 'APPLY' : 'dry run (nothing is written)'}`);
  console.log(`[migrate] businesses already auto: ${alreadyAuto}; manual: ${manual}; no setting: ${unset}`);
  console.log(`[migrate] to switch to auto: ${targets.length} (${connectedIds.length} Google-connected)`);
  console.log(`[migrate] unreplied, undrafted reviews on those connected businesses: ${backlog}`);

  if (!apply) {
    console.log('[migrate] dry run complete.');
    return 0;
  }

  const ids = targets.map((b) => String(b._id));
  const undo = path.resolve(`migrate-review-reply-auto.${db}.${Date.now()}.json`);
  fs.writeFileSync(undo, JSON.stringify({ db, switchedToAuto: ids, at: new Date().toISOString() }, null, 2));
  const res = await Business.updateMany({ _id: { $in: targets.map((b) => b._id) }, ...notAuto }, { $set: { 'reviewReplySettings.mode': 'auto' } });
  console.log(`[migrate] switched ${res.modifiedCount} business(es) to auto. Ids written to ${undo}`);

  if (queueBacklog) {
    const { queueUnrepliedBacklog } = await import('../src/services/reviews/replyBacklog');
    let queued = 0;
    for (const id of connectedIds) queued += await queueUnrepliedBacklog(String(id));
    console.log(`[migrate] queued ${queued} review(s) across ${connectedIds.length} business(es) for auto-reply.`);
  }
  return 0;
}

main()
  .then(async (code) => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect().catch(() => {});
    process.exit(code);
  })
  .catch(async (err) => {
    // Message only — never the URI.
    console.error('[migrate] failed:', err?.message ?? err);
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
