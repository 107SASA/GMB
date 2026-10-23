/**
 * One-off: create MessagingSuppression rows for WhatsApp opt-outs recorded
 * before that collection existed (Segment 3.1). Logic and categories:
 * src/services/messaging/suppressionBackfill.ts.
 *
 * SAFETY
 *  - Loads NO .env file: the target database must be given explicitly.
 *  - Dry run by default — prints counts and a few masked samples, writes nothing.
 *  - Writing requires --apply AND --confirm-db=<the database name in MONGODB_URI>.
 *  - customer_flag_only (opted out with no STOP evidence) is never written
 *    unless also listed in --categories — a policy decision.
 *  - Only inserts missing suppression rows; never edits customers, leads or
 *    requests. Idempotent: safe to re-run or resume. Sends nothing.
 *
 *   MONGODB_URI=<uri> npx tsx scripts/backfill-messaging-suppression.ts
 *   MONGODB_URI=<uri> npx tsx scripts/backfill-messaging-suppression.ts --apply --confirm-db=<db> --categories=tenant_stop,platform_stop
 *
 * Run on a staging copy first; on production only after approval, off-peak
 * (it scans Conversation for inbound STOP text and Customer by phone).
 */
for (const k of Object.keys(process.env)) {
  // Nothing here needs storage, messaging or AI credentials.
  if (/^(DO_SPACES|TWILIO|META_|RAZORPAY|GROQ|OPENAI|RESEND|SENDGRID|INNGEST)_?/.test(k)) delete process.env[k];
}

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name: string) => flag(name)?.split('=').slice(1).join('=') || '';

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
  const { BACKFILL_CATEGORIES, planSuppressionBackfill, applySuppressionBackfill } = await import('../src/services/messaging/suppressionBackfill');
  const requested = (value('categories') || 'tenant_stop,platform_stop').split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = requested.filter((c) => !(BACKFILL_CATEGORIES as string[]).includes(c));
  if (unknown.length) {
    console.error(`Unknown categories: ${unknown.join(', ')} (allowed: ${BACKFILL_CATEGORIES.join(', ')})`);
    return 2;
  }
  if (apply && value('confirm-db') !== db) {
    console.error(`Refusing to write: pass --confirm-db=${db} to confirm the target database.`);
    return 2;
  }

  console.log(`[backfill] database: ${db} — ${apply ? 'APPLY' : 'dry run (nothing is written)'}`);
  const plan = await planSuppressionBackfill();
  console.log(`[backfill] missing suppressions by category: ${JSON.stringify(plan.counts)}`);
  console.log(`[backfill] already suppressed: ${plan.alreadySuppressed}; phones that cannot be normalized (skipped): ${plan.unnormalizablePhones}`);
  const mask = (p: string) => `${p.slice(0, 4)}…${p.slice(-4)}`;
  for (const r of plan.rows.slice(0, 10)) console.log(`  ${r.category.padEnd(18)} business ${r.businessId} ${mask(r.phoneE164)} — ${r.evidence}`);

  if (!apply) {
    console.log(`[backfill] dry run complete. Would write categories: ${requested.join(', ')}.`);
    return 0;
  }
  const res = await applySuppressionBackfill(plan.rows, requested as any);
  console.log(`[backfill] inserted ${res.inserted} of ${res.considered} selected rows (the rest already existed).`);
  return 0;
}

main()
  .then(async (code) => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect().catch(() => {});
    process.exit(code);
  })
  .catch(async (err) => {
    console.error('[backfill] failed:', err?.message || err);
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
