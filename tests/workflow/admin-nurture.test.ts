/**
 * Nurturing Configuration through the REAL routes (GET/PUT
 * /api/admin/nurture-config, POST …/preview, GET …/skipped) against an
 * in-memory MongoDB: only real controls, nurture separate from the Sales
 * agent, copy never touched, preview = the drip's own decision.
 *
 * Run: npx tsx --test tests/workflow/admin-nurture.test.ts
 */
import { jsonReq, signInAs, signInAsSuperAdmin, startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';

// The Sales Agent route loads the AI client; a closed port means nothing ever leaves the machine.
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let skipReason: string | null = null;
let m: any = {};
const DAY = 86_400_000;

before(async () => {
  skipReason = await startMemoryDb('admin_nurture');
  if (skipReason) return;
  m = {
    mongoose: (await import('mongoose')).default,
    route: await import('../../src/app/api/admin/nurture-config/route'),
    preview: await import('../../src/app/api/admin/nurture-config/preview/route'),
    skipped: await import('../../src/app/api/admin/nurture-config/skipped/route'),
    salesRoute: await import('../../src/app/api/admin/sales-agent/route'),
    policy: await import('../../src/services/sales/preSalesPolicy'),
    SalesAgentConfig: (await import('../../src/models/SalesAgentConfig')).default,
    OrchestrationConfig: (await import('../../src/models/OrchestrationConfig')).default,
    SalesConversation: (await import('../../src/models/SalesConversation')).default,
    Lead: (await import('../../src/models/Lead')).default,
    LeadEvent: (await import('../../src/models/LeadEvent')).default,
    User: (await import('../../src/models/User')).default,
  };
  // An existing production-like document saved before nurtureEnabled existed.
  await m.SalesAgentConfig.collection.insertOne({
    key: 'default', enabled: true,
    firstMessage: { mode: 'template', enabled: true, delayMinutes: 2, template: 'Invite copy', aiSystemPrompt: '' },
    followUps: [
      { id: 'follow-up-1', enabled: true, delayHours: 24, delayMinutes: 1440, mode: 'template', template: 'Follow-up copy', onlyIfNoReply: true },
      { id: 'follow-up-2', enabled: true, delayHours: 72, mode: 'template', template: 'Unsent extra step', onlyIfNoReply: true },
    ],
    quietHours: { enabled: false, start: '21:00', end: '09:00' },
    minimumMessageGapMinutes: 0, maxNurtureMessages: 0, nurtureConfigVersion: 3,
  });
  await m.OrchestrationConfig.collection.insertOne({ key: 'default', rolloutPercentage: 25, leadIdAllowlist: [] });
  await signInAsSuperAdmin('nurture-admin@example.invalid');
});
after(stopMemoryDb);

const get = async () => (await m.route.GET()).json();
const put = async (body: any) => { const r = await m.route.PUT(jsonReq('https://x.invalid/api/admin/nurture-config', 'PUT', body)); return { status: r.status, body: await r.json() }; };
const preview = async (leadId: string) => (await m.preview.POST(jsonReq('https://x.invalid/api/admin/nurture-config/preview', 'POST', { leadId }))).json();

test('read: only real controls; an older document inherits the agent switch; the shown delay is the one actually waited', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { config } = await get();
  assert.equal(config.enabled, true, 'nurtureEnabled unset → follows enabled');
  assert.equal(config.salesAgentEnabled, true);
  assert.equal(config.firstMessage.delayMinutes, 120, 'stored 2 min is raised to the 2-hour minimum the sender uses');
  assert.equal(config.followUp.enabled, true);
  assert.deepEqual(config.rules, { minFirstDelayMinutes: 120, followUpDelayMinutes: 2880, followUps: 1 });
  for (const dead of ['rolloutPercentage', 'leadIdAllowlist', 'minimumMessageGapMinutes', 'maxNurtureMessages', 'followUps']) {
    assert.ok(!(dead in config), `${dead} is not offered`);
  }
});

test('save: turning nurturing off never switches off the Sales agent, never touches copy or extra steps, and is audited', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { config } = await get();
  const body = { enabled: false, timezone: 'Asia/Kolkata', quietHours: { enabled: true, start: '22:00', end: '08:00' }, firstMessage: { enabled: true, delayMinutes: 180 }, followUp: { enabled: false } };
  const res = await put(body);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.version, config.version + 1);
  assert.ok(res.body.changes.some((c: string) => /Nurturing: on → off/.test(c)));

  const stored: any = await m.SalesAgentConfig.findOne({ key: 'default' }).lean();
  assert.equal(stored.enabled, true, 'live replies untouched');
  assert.equal(stored.nurtureEnabled, false);
  assert.equal(stored.firstMessage.template, 'Invite copy');
  assert.equal(stored.firstMessage.delayMinutes, 180);
  assert.equal(stored.followUps.length, 2, 'extra step kept');
  assert.equal(stored.followUps[0].template, 'Follow-up copy');
  assert.equal(stored.followUps[0].enabled, false);
  assert.equal(stored.followUps[1].template, 'Unsent extra step');
  assert.deepEqual(stored.quietHours, { enabled: true, start: '22:00', end: '08:00' });
  const orch: any = await m.OrchestrationConfig.findOne({ key: 'default' }).lean();
  assert.equal(orch.rolloutPercentage, 25, 'experimental rollout data is not rewritten from this page');

  const again = await put(body);
  assert.deepEqual(again.body.changes, [], 'saving unchanged settings does not bump the version');
  assert.equal(again.body.version, res.body.version);
});

test('save validation: delays below the real minimum, bad timezones and malformed bodies are refused', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ok = { enabled: true, timezone: 'Asia/Kolkata', quietHours: { enabled: false, start: '21:00', end: '09:00' }, firstMessage: { enabled: true, delayMinutes: 120 }, followUp: { enabled: true } };
  assert.equal((await put({ ...ok, firstMessage: { enabled: true, delayMinutes: 30 } })).status, 400);
  assert.equal((await put({ ...ok, timezone: 'Mars/Base' })).status, 400);
  assert.equal((await put({ ...ok, quietHours: { enabled: true, start: '9pm', end: '09:00' } })).status, 400);
  assert.equal((await put({ ...ok, quietHours: { enabled: true, start: '09:00', end: '09:00' } })).status, 400);
  assert.equal((await put({ ...ok, followUp: undefined })).status, 400);
  assert.equal((await put(ok)).status, 200);
});

test('only a Super Admin can read or change it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const client: any = await m.User.create({ fullName: 'C', email: 'c-nurture@example.invalid', phone: '+919000000777', role: 'CLIENT' } as any);
  await signInAs(client);
  assert.equal((await m.route.GET()).status, 403);
  assert.equal((await put({ enabled: false })).status, 403);
  assert.equal((await m.skipped.GET(new Request('https://x.invalid'))).status, 403);
  await signInAsSuperAdmin('nurture-admin-2@example.invalid');
});

let n = 0;
async function convo(over: Record<string, unknown> = {}, lead: Record<string, unknown> = {}) {
  const phone = `+9198880${String(++n).padStart(5, '0')}`;
  const l: any = await m.Lead.create({ tenantId: 'gmbboost-internal', name: `Lead ${n}`, phone, currentAgent: 'SALES', currentStage: 'NURTURING', ...lead } as any);
  const c: any = await m.SalesConversation.create({
    businessId: new m.mongoose.Types.ObjectId(), leadPhone: phone, phoneKey: phone.slice(-10), status: 'active', consentStatus: 'not_required',
    firstSentAt: new Date(Date.now() - DAY), nurtureSentKeys: ['first'],
    nurtureTiming: { version: 1, timezone: 'Asia/Kolkata', quietHours: { enabled: false, start: '21:00', end: '09:00' }, minimumMessageGapMinutes: 0, maxNurtureMessages: 5, firstMessage: { enabled: true, delayMinutes: 120 }, followUps: [{ id: 'follow-up-1', enabled: true, delayMinutes: 2880, onlyIfNoReply: true }] },
    ...over,
  } as any);
  return { lead: l, convo: c };
}

test('preview gives exactly the drip decision, for every kind of lead', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const cases = [
    await convo(),
    await convo({ lastLeadReplyAt: new Date() }),
    await convo({}, { intent: 'DEMO_INTEREST' }),
    await convo({}, { currentAgent: 'HUMAN', humanHandoff: { active: true } }),
    await convo({}, { nurtureStatus: 'OPTED_OUT' }),
    await convo({ 'nurtureTiming.followUps': [{ id: 'follow-up-1', enabled: false, delayMinutes: 2880 }] } as any),
  ];
  for (const nurtureEnabled of [true, false]) {
    await m.SalesAgentConfig.updateOne({ key: 'default' }, { $set: { nurtureEnabled, enabled: true } });
    for (const c of cases) {
      const p = (await preview(String(c.lead._id))).preview;
      const drip = await m.policy.followUpBlockedReason(String(c.convo._id), 0);
      assert.equal(p.step, 'follow-up');
      assert.equal(p.reasonCode, drip.reason, `${c.lead.name} (nurture ${nurtureEnabled})`);
      assert.equal(p.nurtureEligible, drip.reason === null);
    }
  }
  await m.SalesAgentConfig.updateOne({ key: 'default' }, { $set: { nurtureEnabled: true } });
  const eligible = (await preview(String(cases[0].lead._id))).preview;
  assert.equal(eligible.nurtureEligible, true, JSON.stringify(eligible));
  assert.equal(new Date(eligible.dueAt).getTime(), new Date(cases[0].convo.firstSentAt).getTime() + 48 * 3600_000, 'due 48h after the invitation');
  const replied = (await preview(String(cases[1].lead._id))).preview;
  assert.equal(replied.reasonCode, 'lead-replied');
  assert.match(replied.reason, /replied/);

  const done = await convo({ nurtureSentKeys: ['first', 'followup-0'] });
  assert.equal((await preview(String(done.lead._id))).preview.step, 'done');
  const notStarted: any = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'New', phone: '+919888899999' } as any);
  assert.equal((await preview(String(notStarted._id))).preview.step, 'invitation');
  assert.equal((await preview('not-an-id')).success, false);
});

test('skipped messages are listed newest first with a readable reason and the lead link; tenant events are excluded', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const c = await convo();
  await m.LeadEvent.create({ phone: c.lead.phone, type: 'NURTURE_ACTION_SKIPPED', payload: { reason: 'lead-replied', agent: 'sales-agent-drip' }, actor: 'sales-agent', conversationType: 'sales' });
  await m.LeadEvent.create({ leadId: c.lead._id, phone: c.lead.phone, type: 'NURTURE_ACTION_SKIPPED', payload: { reason: 'nurture-disabled', agent: 'sales-agent-invite' }, actor: 'sales-agent', conversationType: 'sales' });
  await m.LeadEvent.create({ phone: c.lead.phone, type: 'NURTURE_ACTION_SKIPPED', payload: { reason: 'tenant-thing' }, actor: 'tenant', conversationType: 'tenant' });
  const json = await (await m.skipped.GET(new Request('https://x.invalid/api/admin/nurture-config/skipped'))).json();
  assert.equal(json.success, true);
  assert.equal(json.skipped.length, 2);
  assert.equal(json.skipped[0].reasonCode, 'nurture-disabled');
  assert.equal(json.skipped[0].reason, 'Nurturing is switched off.');
  assert.equal(json.skipped[1].leadId, String(c.lead._id), 'phone-only event resolved to the platform lead');
  assert.match(json.skipped[1].reason, /replied/);
});

test('follow-up deleted on the Sales Agent page: shown as not configured, cannot be switched on, and saving never recreates it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const original: any = await m.SalesAgentConfig.findOne({ key: 'default' }).lean();
  await m.SalesAgentConfig.updateOne({ key: 'default' }, { $set: { followUps: [] } });
  try {
    const { config } = await get();
    assert.deepEqual(config.followUp, { enabled: false, configured: false }, 'matches the sender: an empty list sends nothing');
    const base = { enabled: true, timezone: 'Asia/Kolkata', quietHours: { enabled: false, start: '21:00', end: '09:00' }, firstMessage: { enabled: true, delayMinutes: 150 }, followUp: { enabled: true } };
    const refused = await put(base);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /no follow-up message/i);
    const ok = await put({ ...base, followUp: { enabled: false } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const stored: any = await m.SalesAgentConfig.findOne({ key: 'default' }).lean();
    assert.deepEqual(stored.followUps, [], 'not recreated');
    assert.equal(stored.firstMessage.delayMinutes, 150, 'the rest still saved');
  } finally {
    await m.SalesAgentConfig.replaceOne({ key: 'default' }, original);
  }
});

test('follow-up never stored (sender uses the default): shown on; saving records that default with the chosen switch', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const original: any = await m.SalesAgentConfig.findOne({ key: 'default' }).lean();
  await m.SalesAgentConfig.collection.updateOne({ key: 'default' }, { $unset: { followUps: '' } });
  try {
    const { config } = await get();
    assert.deepEqual(config.followUp, { enabled: true, configured: true });
    const res = await put({ enabled: true, timezone: 'Asia/Kolkata', quietHours: { enabled: false, start: '21:00', end: '09:00' }, firstMessage: { enabled: true, delayMinutes: 120 }, followUp: { enabled: false } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const stored: any = await m.SalesAgentConfig.findOne({ key: 'default' }).lean();
    assert.equal(stored.followUps.length, 1);
    assert.equal(stored.followUps[0].enabled, false);
    assert.ok(stored.followUps[0].template, 'the default copy the sender would have used');
  } finally {
    await m.SalesAgentConfig.replaceOne({ key: 'default' }, original);
  }
});

test('skipped list: categories are labelled; demo reminders and live replies are not listed as follow-ups', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.LeadEvent.create({ phone: '+919888800001', type: 'NURTURE_ACTION_SKIPPED', payload: { reason: 'quiet', agent: 'demo-agent', actionType: 'DEMO_REMINDER' }, actor: 'demo-agent', conversationType: null });
  await m.LeadEvent.create({ phone: '+919888800002', type: 'NURTURE_ACTION_SKIPPED', payload: { reason: 'nurture-disabled', category: 'preparation', agent: 'sales-agent-prep' }, actor: 'sales-agent' });
  await m.LeadEvent.create({ phone: '+919888800003', type: 'NURTURE_ACTION_SKIPPED', payload: { reason: 'cooldown-active', agent: 'SALES', isReply: false }, actor: 'sales-agent' });
  const json = await (await m.skipped.GET(new Request('https://x.invalid/api/admin/nurture-config/skipped?limit=200'))).json();
  const by = (phone: string) => json.skipped.find((s: any) => s.phone === phone);
  assert.equal(by('+919888800001'), undefined, 'a demo reminder is not a nurturing message');
  assert.equal(by('+919888800002').categoryLabel, 'not started');
  assert.equal(by('+919888800003').categoryLabel, 'follow-up');
  assert.equal(by('+919888800003').reason, 'Too soon after the last automated message (cooldown).');
});

test('Sales Agent page: an invitation delay under 2 hours is refused (it was saved and then silently raised)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const current = await (await m.salesRoute.GET()).json();
  const base = {
    enabled: current.config.enabled,
    firstMessage: { mode: 'template', delayMinutes: 2, template: current.config.firstMessage.template || 'Invite copy', aiSystemPrompt: '' },
    followUps: (current.config.followUps || []).map((f: any) => ({ delayHours: f.delayHours ?? 48, mode: f.mode || 'template', template: f.template || '', aiSystemPrompt: f.aiSystemPrompt || '', onlyIfNoReply: true })),
    agentSystemPrompt: current.config.agentSystemPrompt || '',
    subscribeUrl: '', shopUrl: '',
  };
  const put = (b: any) => m.salesRoute.PUT(jsonReq('https://x.invalid/api/admin/sales-agent', 'PUT', b));
  const refused = await put(base);
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /sooner than 2 hours/);
  const ok = await put({ ...base, firstMessage: { ...base.firstMessage, delayMinutes: 150 } });
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  assert.equal((await m.SalesAgentConfig.findOne({ key: 'default' }).lean()).firstMessage.delayMinutes, 150);
});
