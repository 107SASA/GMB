/**
 * Step 2 of the legacy billing migration: prove which inventoried Razorpay
 * subscriptions are TEST-mode. Read-only on both sides — no database access at
 * all, and only GET /subscriptions/:id against Razorpay.
 *
 * Runs ONLY with TEST keys: refuses unless RAZORPAY_KEY_ID starts with
 * rzp_test_. Never use live keys here.
 *
 * Verdicts per id:
 *   confirmed_test          found with test keys → exists in test mode (Razorpay ids are
 *                           unique), so it can never charge real money
 *   not_found_unproven      not found with test keys → proves NOTHING (may be live,
 *                           another account, or bad data) → manual review
 *   lookup_failed_unproven  network/auth/rate-limit error → unproven → retry / review
 *
 * Usage:
 *   npx tsx scripts/billing-verify-test-mode.ts --in inventory.json --out verification.json
 * with RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET set to TEST keys in the environment
 * (e.g. a dedicated env file holding only the two test keys). Key values are never printed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import Razorpay from 'razorpay';
import { subscriptionIdsFromInventory, verifyTestModeSubscriptions, type LegacyInventory } from '../src/lib/billing/legacyInventory';

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : null;
  };
  const inFile = arg('--in');
  const outFile = arg('--out');
  if (!inFile || !outFile) throw new Error('Usage: --in <inventory.json> --out <verification.json>');

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId?.startsWith('rzp_test_') || !keySecret) {
    throw new Error('Refusing to run: set RAZORPAY_KEY_ID (rzp_test_…) and RAZORPAY_KEY_SECRET to TEST keys.');
  }

  const inventory = JSON.parse(readFileSync(inFile, 'utf8')) as LegacyInventory;
  const ids = subscriptionIdsFromInventory(inventory);
  const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const results = await verifyTestModeSubscriptions(ids, {
    keyId,
    fetchSubscription: (id) => client.subscriptions.fetch(id),
    delayMs: 250, // stay well under Razorpay rate limits
  });

  const summary = results.reduce<Record<string, number>>((acc, r) => ((acc[r.verdict] = (acc[r.verdict] ?? 0) + 1), acc), {});
  writeFileSync(outFile, JSON.stringify({ inventoryDatabase: inventory.database, verifiedAt: new Date().toISOString(), summary, results }, null, 2));
  console.log(`Verified ${results.length} subscription id(s) with TEST keys → ${outFile}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('[billing-verify-test-mode] failed:', err?.message ?? err);
  process.exit(1);
});
