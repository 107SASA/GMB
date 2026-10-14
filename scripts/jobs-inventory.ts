/**
 * Prints the native-queue view of every Inngest function (id, triggers,
 * attempts, concurrency, cancelOn) and flags anything the adapter cannot
 * honour. Read-only: loads the function module, never connects to a DB.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:1/x npx tsx scripts/jobs-inventory.ts [--json]
 */
import { assertOwnable } from '../src/services/jobs/adapter';

async function main() {
  process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/inventory-only'; // import-time guard in lib/mongodb; never connected
  const { loadRegistry } = await import('../src/services/jobs/dispatch');
  const fns = (await loadRegistry()).sort((a, b) => a.id.localeCompare(b.id));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(fns.map(({ handler, ...rest }) => rest), null, 2));
  } else {
    for (const f of fns) {
      const trig = [...f.events.map((e) => `event:${e}`), ...f.crons.map((c) => `cron:${c}`)].join(' | ');
      const extra = [
        f.concurrencyKeyPath ? `key=${f.concurrencyKeyPath}` : '',
        f.concurrencyLimit ? `limit=${f.concurrencyLimit}` : '',
        f.cancelOn.length ? `cancelOn=${f.cancelOn.map((c) => `${c.event}~${c.field}`).join(',')}` : '',
        f.unsupported ? `UNSUPPORTED[${f.unsupported.join('; ')}]` : '',
      ].filter(Boolean).join(' ');
      console.log(`${f.id.padEnd(34)} attempts=${f.maxAttempts} ${trig} ${extra}`);
    }
  }
  let ownable = 0;
  for (const f of fns) {
    try {
      assertOwnable(fns, new Set([f.id]));
      ownable++;
    } catch {
      /* counted via unsupported above */
    }
  }
  console.error(`\n${fns.length} functions, ${ownable} natively ownable, ${fns.length - ownable} blocked by unsupported options`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
