/**
 * Super Admin → Leads follows the free trial: started → "Free trial",
 * cancelled, ended unpaid → purchase intent, paid → converted. In-memory
 * MongoDB, no WhatsApp, no Razorpay.
 *
 * Run: npx tsx --test tests/workflow/lead-trial-sync.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST)_/.test(k)) delete process.env[k];

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_lead_trial_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    Lead: (await import('../../src/models/Lead')).default,
    LeadEvent: (await import('../../src/models/LeadEvent')).default,
    sync: await import('../../src/services/billing/leadTrialSync'),
    milestones: await import('../../src/lib/admin/leadMilestones'),
  };
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

let seq = 0;
/** An owner + workspace + CRM lead whose phone is spelled differently from the account's. */
async function setup(leadPhone: (last10: string) => string, stage = 'DEMO_SCHEDULED') {
  const last10 = `98765${String(++seq).padStart(5, '0')}`;
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: `Trial ${seq}`, category: 'Bakery', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId() } as any);
  await m.User.create({ _id: userId, fullName: `Owner ${seq}`, email: `trial${seq}@example.invalid`, phone: `+91${last10}`, role: 'CLIENT', businessIds: [b._id] } as any);
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: `Lead ${seq}`, phone: leadPhone(last10), source: 'Manual', currentStage: stage } as any);
  return { userId: String(userId), businessId: String(b._id), leadId: lead._id };
}

const later = (days: number) => new Date(Date.now() + days * 86_400_000);

test('trial start shows "Free trial" even when the lead phone is saved without +91', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { userId, businessId, leadId } = await setup((d) => d);
  await m.sync.syncLeadTrial(userId, businessId, { kind: 'started', endsAt: later(7) });
  const lead = await m.Lead.findById(leadId).lean();
  assert.equal(lead.trial.status, 'active');
  assert.equal(m.milestones.currentFunnelStage(lead), 'Free trial');
  assert.equal(await m.LeadEvent.countDocuments({ leadId, type: 'TRIAL_STARTED' }), 1);
});

test('a cancelled trial still shows as a free trial until its end date', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { userId, businessId, leadId } = await setup((d) => `+91 ${d.slice(0, 5)} ${d.slice(5)}`);
  await m.sync.syncLeadTrial(userId, businessId, { kind: 'started', endsAt: later(7) });
  await m.sync.syncLeadTrial(userId, businessId, { kind: 'cancelled' });
  const lead = await m.Lead.findById(leadId).lean();
  assert.equal(lead.trial.status, 'cancelled');
  assert.equal(m.milestones.currentFunnelStage(lead), 'Free trial');
});

test('trial ended unpaid → purchase intent; the badge leaves "Free trial"', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { userId, businessId, leadId } = await setup((d) => `+91${d}`);
  await m.sync.syncLeadTrial(userId, businessId, { kind: 'started', endsAt: later(7) });
  await m.sync.syncLeadTrial(userId, businessId, { kind: 'ended' });
  const lead = await m.Lead.findById(leadId).lean();
  assert.equal(lead.trial.status, 'ended');
  assert.equal(lead.currentStage, 'CONVERSION_PENDING');
  assert.equal(m.milestones.currentFunnelStage(lead), 'Purchase intent');
});

test('paid after the trial → converted, never shown as a trial again', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { userId, businessId, leadId } = await setup((d) => `+91${d}`);
  await m.sync.syncLeadTrial(userId, businessId, { kind: 'started', endsAt: later(7) });
  await m.sync.syncLeadTrial(userId, businessId, { kind: 'converted' });
  const lead = await m.Lead.findById(leadId).lean();
  assert.equal(lead.trial.status, 'converted');
  assert.equal(m.milestones.isOnTrialNow(lead), false);
});

test('a trial past its end date is not shown as active', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(m.milestones.isOnTrialNow({ trial: { status: 'active', endsAt: later(-1) } }), false);
  assert.equal(m.milestones.isOnTrialNow({ trial: { status: 'active', endsAt: later(1) } }), true);
});

test('no matching lead → no throw, nothing written', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.sync.syncLeadTrial(String(new m.mongoose.Types.ObjectId()), null, { kind: 'started', endsAt: later(7) });
});
