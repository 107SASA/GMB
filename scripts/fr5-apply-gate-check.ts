/**
 * FR-5 APPROVE / APPLY / ROLLBACK GATE CHECK — throwaway in-memory MongoDB.
 *
 *   npx tsx scripts/fr5-apply-gate-check.ts
 *
 * Runs the real store (approveChange / executeChange / rollbackChange) with
 * both live-write flags OFF. The Google client is replaced by counting stubs,
 * no .env file is read, and storage credentials are removed, so nothing can
 * reach Google or production data. Exits 1 on any failure.
 */
process.env.GBP_LIVE_WRITES_ENABLED = 'false';
process.env.GBP_FR5_LIVE_WRITES_ENABLED = 'false';
for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];

const googleCalls: string[] = [];
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]gbpClient(\.ts)?$/.test(request)) {
    const stub = (name: string) => async () => { googleCalls.push(name); throw new Error('stubbed Google client'); };
    return {
      mirrorVerifiedProfile: stub('mirrorVerifiedProfile'),
      patchLocationAttributes: stub('patchLocationAttributes'),
      patchLocationRaw: stub('patchLocationRaw'),
      readLocationAttributes: stub('readLocationAttributes'),
      readLocationRaw: stub('readLocationRaw'),
      updateLocationProfile: stub('updateLocationProfile'),
    };
  }
  return origLoad.call(this, request, ...rest);
};

let failures = 0;
const check = (name: string, pass: boolean, detail = '') => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = mem.getUri('growwmatics_fr5_apply_gate_check');
  try { await run(); } finally {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect().catch(() => {});
    await mem.stop({ doCleanup: true, force: true }).catch(() => {});
  }
}

async function run() {
  const mongoose = (await import('mongoose')).default;
  const GbpProfileChange = (await import('../src/models/GbpProfileChange')).default;
  const GBPToken = (await import('../src/models/GBPToken')).default;
  const { approveChange, executeChange, rollbackChange, LIVE_WRITES_DISABLED } = await import('../src/services/gbp/changes/store');
  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();

  const businessId = new mongoose.Types.ObjectId();
  const otherBusinessId = new mongoose.Types.ObjectId();
  const userId = String(new mongoose.Types.ObjectId());
  const locationId = 'accounts/1/locations/check-1';
  await GBPToken.collection.insertOne({ businessId, organizationId: new mongoose.Types.ObjectId(), googleAccountId: 'check', googleEmail: 'check@example.test', accessToken: 'x', refreshToken: 'x', expiresAt: new Date(Date.now() + 3_600_000), locationId });
  const make = (over: Record<string, unknown>) => GbpProfileChange.create({
    businessId, locationId, kind: 'description', fields: ['description'], source: 'owner', before: 'Old.', proposed: 'New text.',
    beforeFingerprint: 'fp', status: 'PROPOSED', validation: { valid: true, violations: [] }, requestedBy: userId, ...over,
  });
  const actor = { userId, businessId: String(businessId) };
  const statusOf = async (id: unknown) => (await GbpProfileChange.findById(id).lean<{ status: string; error?: string | null; executedAt?: Date | null }>())!;

  // Approve: PROPOSED → APPROVED, no Google call.
  const a = await make({});
  const approved = await approveChange(String(a._id), actor);
  const afterApprove = await statusOf(a._id);
  check('approve persists APPROVED', approved.ok && afterApprove.status === 'APPROVED', afterApprove.status);
  check('approve makes no Google call', googleCalls.length === 0, googleCalls.join(','));

  // Concurrent approvals of one proposal: exactly one wins.
  const c = await make({});
  const both = await Promise.all([approveChange(String(c._id), actor), approveChange(String(c._id), actor)]);
  check('concurrent approve: exactly one succeeds', both.filter((r) => r.ok).length === 1);

  // Sensitive fields need the explicit confirmation.
  const s = await make({ kind: 'title', sensitive: true, proposed: 'New Name' });
  const unconfirmed = await approveChange(String(s._id), actor);
  check('sensitive approve without confirm is refused', !unconfirmed.ok && (await statusOf(s._id)).status === 'PROPOSED');
  const confirmed = await approveChange(String(s._id), actor, true);
  check('sensitive approve with confirm persists APPROVED', confirmed.ok && (await statusOf(s._id)).status === 'APPROVED');

  // Another workspace cannot approve or apply this proposal.
  const foreign = await approveChange(String(c._id), { userId, businessId: String(otherBusinessId) });
  check('cross-tenant approve refused', !foreign.ok && foreign.error === 'Change not found.');

  // Apply with both flags off: refused, record unchanged, no Google call.
  const before = await statusOf(a._id);
  const applied = await executeChange(String(a._id), actor);
  const afterApply = await statusOf(a._id);
  check('apply with writes off is refused', !applied.ok && applied.error === LIVE_WRITES_DISABLED, applied.ok ? 'ok' : String(applied.error));
  check('apply with writes off keeps APPROVED (not BLOCKED)', afterApply.status === 'APPROVED', afterApply.status);
  check('apply with writes off does not touch error / executedAt', (afterApply.error ?? null) === (before.error ?? null) && String(afterApply.executedAt ?? null) === String(before.executedAt ?? null));
  check('apply with writes off makes no Google call', googleCalls.length === 0, googleCalls.join(','));
  const again = await executeChange(String(a._id), actor);
  check('apply can be retried and stays APPROVED', !again.ok && (await statusOf(a._id)).status === 'APPROVED');

  // Apply on a still-PROPOSED change keeps the existing message.
  const p = await make({});
  const early = await executeChange(String(p._id), actor);
  check('apply before approval is refused', !early.ok && early.error === 'Approve the change before applying it.' && (await statusOf(p._id)).status === 'PROPOSED');

  // Rollback with writes off: refused, VERIFIED unchanged, no Google call.
  const v = await make({ status: 'VERIFIED', after: 'New text.', afterFingerprint: 'fp-after' });
  const rolled = await rollbackChange(String(v._id), actor);
  check('rollback with writes off is refused', !rolled.ok && rolled.error === LIVE_WRITES_DISABLED);
  check('rollback with writes off keeps VERIFIED', (await statusOf(v._id)).status === 'VERIFIED');
  check('no Google call in the whole run', googleCalls.length === 0, googleCalls.join(','));
}

main().then(() => {
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
