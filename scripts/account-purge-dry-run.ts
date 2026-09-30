/**
 * READ-ONLY dry run of the account hard-purge against the database in
 * MONGODB_URI (e.g. production) — run this and review its output before
 * setting ACCOUNT_PURGE_MODE=live.
 *
 *   npx tsx scripts/account-purge-dry-run.ts            # uses .env.local / .env
 *
 * Writes nothing: purgeAccount() in dry_run mode only counts documents, and
 * lists (never deletes) stored files. Output is ids and counts only.
 */
import fs from 'fs';
import path from 'path';

for (const file of ['.env.local', '.env']) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) continue;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '');
    v = v.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

async function main() {
  const { findUsersDueForPurge, purgeAccount, expireBillingRecords } = await import('../src/services/account/hardPurge');
  const { retryBillingCancelForDeletedAccounts } = await import('../src/lib/billing/deletionCancel');
  const now = new Date();
  const due = await findUsersDueForPurge(now, undefined, 500);
  console.log(`Accounts due for purge (deleted > 30 days ago, not SUPER_ADMIN, not yet purged): ${due.length}`);
  const totals: Record<string, number> = {};
  let files = 0;
  for (const id of due) {
    const r = await purgeAccount(id, { mode: 'dry_run', now });
    const n = Object.values(r.counts).reduce((a, c) => a + c, 0);
    files += r.storageObjects;
    for (const [k, v] of Object.entries(r.counts)) totals[k] = (totals[k] ?? 0) + v;
    console.log(`  user ${id}: ${r.refused ? `REFUSED (${r.refused})` : `${r.businessIds.length} business(es), ${n} documents, ${r.storageObjects} files`}${r.errors.length ? ` · errors: ${r.errors.join('; ')}` : ''}`);
  }
  console.log('\nWould delete, by collection:');
  for (const [k, v] of Object.entries(totals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  console.log(`  stored files: ${files}`);
  const billing = await retryBillingCancelForDeletedAccounts({ mode: 'dry_run' });
  console.log(`\nDeleted accounts whose Razorpay subscription is still not cancelled: ${billing.pending}`);
  const exp = await expireBillingRecords({ mode: 'dry_run', now });
  console.log(`Billing records past the 8-year retention: ${exp.subscriptions}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
