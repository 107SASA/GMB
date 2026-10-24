/**
 * READ-ONLY inventory of billing records saved before the Razorpay test/live
 * mode was recorded. Writes nothing: no app models are loaded (so no index
 * builds), the connection has autoIndex/autoCreate off, and the collector only
 * sees a read-only wrapper (src/lib/billing/legacyInventory.ts) that throws on
 * any write method.
 *
 * Output: JSON with counts and identifiers only (ObjectIds, Razorpay ids,
 * statuses, dates) — no names, phones, emails, phone hashes or secrets. The
 * connection string is never printed.
 *
 * Usage (point MONGODB_URI at the database you mean to inventory):
 *   npx tsx --env-file=<env file> scripts/billing-legacy-inventory.ts [--out inventory.json]
 *
 * Next step (separate, TEST keys only): scripts/billing-verify-test-mode.ts
 */
import { writeFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { collectLegacyBillingInventory } from '../src/lib/billing/legacyInventory';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (pass --env-file=<file>).');
  const outIdx = process.argv.indexOf('--out');
  const outFile = outIdx > -1 ? process.argv[outIdx + 1] : null;

  const conn = await mongoose.createConnection(uri, { autoIndex: false, autoCreate: false }).asPromise();
  try {
    const inventory = await collectLegacyBillingInventory(conn.db);
    const json = JSON.stringify(inventory, null, 2);
    if (outFile) {
      writeFileSync(outFile, json);
      console.log(`Inventory of "${inventory.database}" written to ${outFile}`);
      console.log(JSON.stringify(inventory.counts, null, 2));
    } else {
      console.log(json);
    }
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error('[billing-legacy-inventory] failed:', err?.message ?? err);
  process.exit(1);
});
