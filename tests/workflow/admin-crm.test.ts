/**
 * Super admin CRM — the REAL routes (add, edit, stage, notes, bulk move,
 * CSV import, export, lead detail) against an in-memory MongoDB, signed in
 * as a Super Admin through the real session check. No message is sent.
 *
 * Run: npx tsx --test tests/workflow/admin-crm.test.ts
 */
import { signInAsSuperAdmin, signOut, startMemoryDb, stopMemoryDb, jsonReq } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';

let skipReason: string | null = null;
let m: any = {};
let admin: any;
const T = 'gmbboost-internal';
const BASE = 'https://app.example.test';

before(async () => {
  skipReason = await startMemoryDb('admin_crm');
  if (skipReason) return;
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async () => ({ ids: [] }); // background jobs never leave the machine
  m = {
    mongoose: (await import('mongoose')).default,
    rules: await import('../../src/lib/admin/platformCrm'),
    leads: await import('../../src/app/api/admin/crm/leads/route'),
    leadOne: await import('../../src/app/api/admin/crm/leads/[id]/route'),
    notes: await import('../../src/app/api/admin/crm/leads/[id]/notes/route'),
    bulk: await import('../../src/app/api/admin/crm/leads/bulk/route'),
    importRoute: await import('../../src/app/api/admin/crm/leads/import/route'),
    exportRoute: await import('../../src/app/api/admin/crm/export/route'),
    pipeline: await import('../../src/app/api/admin/conversion/pipeline/route'),
    detail: await import('../../src/app/api/admin/conversion/leads/[id]/route'),
    Lead: (await import('../../src/models/Lead')).default,
    LeadEvent: (await import('../../src/models/LeadEvent')).default,
    ScheduledAction: (await import('../../src/models/ScheduledAction')).default,
    SalesConversation: (await import('../../src/models/SalesConversation')).default,
    User: (await import('../../src/models/User')).default,
    FollowUp: (await import('../../src/models/FollowUp')).default,
    prospect: await import('../../src/services/leads/platformProspectEntry'),
    bookDemo: await import('../../src/app/api/leads/book-demo/route'),
    calls: await import('../../src/app/api/admin/crm/leads/[id]/calls/route'),
    leadFollowUps: await import('../../src/app/api/admin/crm/leads/[id]/follow-ups/route'),
    followUps: await import('../../src/app/api/admin/crm/follow-ups/route'),
    followUpOne: await import('../../src/app/api/admin/crm/follow-ups/[id]/route'),
    subStages: await import('../../src/app/api/admin/crm/sub-stages/route'),
    activity: await import('../../src/services/admin/platformCrmActivity'),
  };
  admin = await signInAsSuperAdmin('crm-admin@example.invalid');
});
after(stopMemoryDb);

let seq = 0;
const phone = () => `+9196000${String(++seq).padStart(5, '0')}`;
const body = async (res: Response) => ({ status: res.status, json: await res.json() });
const create = (b: Record<string, unknown>) => m.leads.POST(jsonReq(`${BASE}/api/admin/crm/leads`, 'POST', b)).then(body);
const patch = (id: string, b: Record<string, unknown>) =>
  m.leadOne.PATCH(jsonReq(`${BASE}/api/admin/crm/leads/${id}`, 'PATCH', b), { params: Promise.resolve({ id }) }).then(body);
const detail = (id: string) => m.detail.GET(new Request(`${BASE}/x`), { params: Promise.resolve({ id }) }).then((r: Response) => r.json());
const pipeline = (qs: string) => m.pipeline.GET(new Request(`${BASE}/api/admin/conversion/pipeline?${qs}`)).then((r: Response) => r.json());

function csvUpload(csv: string, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('file', new File([csv], 'leads.csv', { type: 'text/csv' }));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return m.importRoute.POST(new Request(`${BASE}/api/admin/crm/leads/import`, { method: 'POST', body: fd })).then(body);
}

test('pure: stages, CSV rows and display names', (t) => {
  if (skipReason) return t.skip(skipReason);
  const r = m.rules;
  assert.equal(r.parseCrmStage('demo scheduled'), 'DEMO_SCHEDULED');
  assert.equal(r.parseCrmStage('LOST'), 'LOST');
  assert.equal(r.parseCrmStage('With a human'), null, 'a human takeover is never set from a stage picker');
  assert.equal(r.crmDisplayName({ name: '+919000000001', businessType: 'Asha Bakery', phone: '+919000000001' }), 'Asha Bakery', 'business when the name is only the number');
  assert.equal(r.crmDisplayName({ name: 'New User', phone: '+91900' }), '+91900');
  const ok = r.normaliseCrmImportRow({ Name: 'Asha', Phone: '098765 43210', Business: 'Asha Bakery', Stage: 'Qualifying', Tags: 'a; b', Source: 'referral' });
  assert.equal(ok.ok, true);
  assert.equal(ok.row.phone, '+919876543210');
  assert.equal(ok.row.stage, 'QUALIFYING');
  assert.equal(ok.row.source, 'Referral');
  assert.deepEqual(ok.row.tags, ['a', 'b']);
  assert.match(r.normaliseCrmImportRow({ name: 'x' }).error, /phone is missing/);
  assert.match(r.normaliseCrmImportRow({ phone: '9876543210' }).error, /name or business/);
  assert.match(r.normaliseCrmImportRow({ phone: '9876543210', name: 'x', stage: 'banana' }).error, /not a CRM stage/);
  // The sample CSV the page offers is itself importable.
  const lines = r.CRM_CSV_TEMPLATE.trim().split('\n');
  assert.equal(lines[0], r.CRM_CSV_COLUMNS.join(','));
});

test('add lead: created with the team as actor; same phone → 409 with the existing lead; never by a non-admin', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = phone();
  const res = await create({ name: 'Meera', phone: p.slice(3), businessType: 'Glow Salon', city: 'Pune', source: 'Referral', stage: 'QUALIFYING', tags: ['vip'], notes: 'Met at expo' });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const lead: any = await m.Lead.findById(res.json.leadId).lean();
  assert.equal(lead.tenantId, T);
  assert.equal(lead.phone, p, 'stored as E.164');
  assert.equal(lead.currentStage, 'QUALIFYING');
  assert.equal(lead.city, 'Pune');
  const events: any[] = await m.LeadEvent.find({ leadId: lead._id }).lean();
  assert.ok(events.some((e) => e.type === 'LEAD_CREATED' && e.actor === String(admin._id)));
  assert.ok(events.some((e) => e.type === 'NOTE_ADDED' && e.payload.text === 'Met at expo'));

  const dup = await create({ name: 'Other', phone: p });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.leadId, String(lead._id));
  assert.equal((await create({ phone: phone() })).status, 400, 'name or business required');

  signOut();
  try {
    assert.equal((await create({ name: 'x', phone: phone() })).status, 401);
  } finally {
    await (await import('../helpers/adminRouteHarness')).signInAs(admin);
  }
});

test('edit: details saved and audited; bad email, taken phone and non-team assignee refused', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const id = (await create({ name: 'Ravi', phone: phone() })).json.leadId;
  const taken = phone();
  await create({ name: 'Taken', phone: taken });
  assert.equal((await patch(id, { email: 'not-an-email' })).status, 400);
  assert.equal((await patch(id, { phone: taken })).status, 409);
  const client: any = await m.User.create({ fullName: 'Client', email: 'client-crm@example.invalid', phone: phone(), role: 'CLIENT' } as any);
  assert.equal((await patch(id, { assignedUserId: String(client._id) })).status, 400, 'only team members');

  const ok = await patch(id, { businessType: 'Kumar Salon', city: 'Mumbai', tags: ['hot', 'call'], assignedUserId: String(admin._id), dealValue: 9999 });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const lead: any = await m.Lead.findById(id).lean();
  assert.equal(lead.businessType, 'Kumar Salon');
  assert.deepEqual(lead.tags, ['hot', 'call']);
  assert.equal(String(lead.assignedUserId), String(admin._id));
  assert.equal(lead.deal.value, 9999);
  const ev: any = await m.LeadEvent.findOne({ leadId: id, type: 'LEAD_UPDATED' }).lean();
  assert.deepEqual(ev.payload.fields.sort(), ['assignedUserId', 'businessType', 'city', 'dealValue', 'tags']);

  // Opt-out belongs to the person, never the team.
  await m.Lead.updateOne({ _id: id }, { $set: { nurtureStatus: 'OPTED_OUT' } });
  assert.equal((await patch(id, { nurtureStatus: 'ACTIVE' })).status, 409);
});

test('stages keep the AI consistent: Customer → in-house, leaving it → Sales, Lost cancels queued messages, Do not contact stops nurture', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const id = (await create({ name: 'Stage Test', phone: phone() })).json.leadId;
  await m.Lead.updateOne({ _id: id }, { $set: { currentAgent: 'SALES', currentStage: 'NURTURING' } });

  assert.equal((await patch(id, { stage: 'CUSTOMER' })).status, 200);
  let lead: any = await m.Lead.findById(id).lean();
  assert.equal(lead.currentStage, 'CUSTOMER');
  assert.equal(lead.currentAgent, 'IN_HOUSE');

  await patch(id, { stage: 'NURTURING' });
  lead = await m.Lead.findById(id).lean();
  assert.equal(lead.currentAgent, 'SALES');
  assert.equal(lead.currentStage, 'NURTURING');

  await m.ScheduledAction.create({ leadId: id, actionType: 'SHOW_VALUE', dueAt: new Date(Date.now() + 3600_000), status: 'PENDING', idempotencyKey: `crm-${id}`, createdBy: 'test', payload: {} } as any);
  await patch(id, { stage: 'LOST', lostReason: 'Went with a competitor' });
  lead = await m.Lead.findById(id).lean();
  assert.equal(lead.currentStage, 'LOST');
  assert.ok(lead.lostAt);
  assert.equal((await m.ScheduledAction.findOne({ idempotencyKey: `crm-${id}` }).lean()).status, 'CANCELLED');

  await patch(id, { stage: 'DO_NOT_CONTACT' });
  assert.equal((await m.Lead.findById(id).lean()).nurtureStatus, 'STOPPED');

  assert.equal((await patch(id, { stage: 'HUMAN_HANDOFF' })).status, 400, 'take over from the Inbox instead');
  const changes: any[] = await m.LeadEvent.find({ leadId: id, type: 'STAGE_CHANGED' }).sort({ createdAt: 1 }).lean();
  assert.deepEqual(changes.map((c) => c.payload.to), ['CUSTOMER', 'NURTURING', 'LOST', 'DO_NOT_CONTACT']);
  assert.ok(changes.every((c) => c.actor === String(admin._id)));
});

test('notes and the lead page: who said what — lead, AI, team — and who changed what', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = phone();
  const id = (await create({ name: 'Priya', phone: p, businessType: 'Priya Cafe' })).json.leadId;
  const note = await m.notes.POST(jsonReq(`${BASE}/x`, 'POST', { text: 'Called — wants pricing' }), { params: Promise.resolve({ id }) });
  assert.equal(note.status, 201);
  assert.equal((await m.notes.POST(jsonReq(`${BASE}/x`, 'POST', { text: '  ' }), { params: Promise.resolve({ id }) })).status, 400);
  await m.SalesConversation.create({
    businessId: new m.mongoose.Types.ObjectId(), leadPhone: p, status: 'active',
    messages: [
      { role: 'lead', text: 'Hi', at: new Date(Date.now() - 3000) },
      { role: 'agent', text: 'Hello from the AI', at: new Date(Date.now() - 2000) },
      { role: 'agent', text: 'Hello from Rahul', sender: 'human', at: new Date(Date.now() - 1000) },
    ],
  } as any);
  const d = await detail(id);
  const sales = d.conversations.find((c: any) => c.type === 'sales');
  assert.deepEqual(sales.messages.map((x: any) => x.by), ['lead', 'ai', 'team']);
  const ev = d.timeline.find((e: any) => e.type === 'NOTE_ADDED');
  assert.equal(ev.payload.text, 'Called — wants pricing');
  assert.equal(ev.actorName, 'Root Admin', 'the team member, not an id');
  assert.equal(d.lead.displayName, 'Priya');
  assert.equal(d.lead.businessType, 'Priya Cafe');
});

test('bulk move and the stage filter', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await create({ name: `Bulk ${i}`, phone: phone(), tags: ['bulk-test'] })).json.leadId);
  const res = await m.bulk.POST(jsonReq(`${BASE}/x`, 'POST', { ids: [...ids, ids[0]], stage: 'COLD' })).then(body);
  assert.equal(res.status, 200);
  assert.equal(res.json.updated, 3);
  assert.equal(res.json.skipped, 1, 'already cold the second time');
  const list = await pipeline('crmStage=COLD');
  assert.ok(ids.every((id) => list.rows.some((r: any) => r._id === id)));
  assert.ok(list.rows.every((r: any) => r.currentStage === 'COLD'));
  assert.equal((await m.bulk.POST(jsonReq(`${BASE}/x`, 'POST', { ids, stage: 'NOPE' }))).status, 400);
});

test('CSV import: new leads created, existing ones only filled in, duplicates and bad rows reported, stages only when asked', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const existingPhone = phone();
  const existingId = (await create({ name: 'Existing Person', phone: existingPhone, email: 'keep@example.com' })).json.leadId;
  const newPhone = phone();
  const csv = [
    'name,phone,email,business,city,source,stage,tags,notes',
    `Anil,${newPhone.slice(3)},anil@example.com,Anil Motors,Nashik,Phone Call,Demo scheduled,cars;nashik,Call back Monday`,
    `Someone Else,${existingPhone},overwrite@example.com,Existing Biz,Pune,,Customer,imported,`,
    `Anil Again,${newPhone},,,,,,,`,
    `,9123,,,,,,,`,
    `Bad Stage,${phone()},,,,,Banana,,`,
  ].join('\n');
  const res = await csvUpload(csv);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.created, 1);
  assert.equal(res.json.updated, 1);
  assert.deepEqual(res.json.errors.map((e: any) => e.row).sort(), [4, 5, 6]);

  const anil: any = await m.Lead.findOne({ tenantId: T, phone: newPhone }).lean();
  assert.equal(anil.businessType, 'Anil Motors');
  assert.equal(anil.currentStage, 'DEMO_SCHEDULED');
  assert.equal(anil.source, 'Phone Call');
  assert.ok(await m.LeadEvent.exists({ leadId: anil._id, type: 'LEAD_IMPORTED' }));
  assert.ok(await m.LeadEvent.exists({ leadId: anil._id, type: 'NOTE_ADDED' }));

  let existing: any = await m.Lead.findById(existingId).lean();
  assert.equal(existing.name, 'Existing Person', 'a real name is never overwritten');
  assert.equal(existing.email, 'keep@example.com', 'an existing email is never overwritten');
  assert.equal(existing.businessType, 'Existing Biz', 'an empty field is filled');
  assert.ok(existing.tags.includes('imported'));
  assert.equal(existing.currentStage, 'NEW', 'stage untouched unless asked');

  const again = await csvUpload(`name,phone,stage\nExisting Person,${existingPhone},Customer`, { updateStages: 'true' });
  assert.equal(again.json.updated, 1);
  existing = await m.Lead.findById(existingId).lean();
  assert.equal(existing.currentStage, 'CUSTOMER');
  assert.equal(existing.currentAgent, 'IN_HOUSE');

  assert.equal((await csvUpload('')).status, 400);
});

test('export CSV is exactly the filtered list, with a header', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const res: Response = await m.exportRoute.GET(new Request(`${BASE}/api/admin/crm/export?crmStage=COLD`));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/csv/);
  const lines = (await res.text()).trim().split('\n');
  assert.match(lines[0], /^name,phone,email,business/);
  const list = await pipeline('crmStage=COLD&pageSize=500');
  assert.equal(lines.length - 1, list.pagination.total);
  assert.ok(lines.slice(1).every((l) => l.includes(',Cold,')));
});

// ── Capture sources, calls, follow-ups, custom stages ─────────────────────

test('website free report → "Website Free Report"; WhatsApp report → "WhatsApp Free Report"; a later website demo keeps the first source and adds its own', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const web = phone();
  await m.prospect.fileFreeReportPlatformLead({ name: 'Web Person', phone: web, businessName: 'Web Biz', channel: 'website' });
  let lead: any = await m.Lead.findOne({ tenantId: T, phone: web }).lean();
  assert.equal(lead.source, 'Website Free Report');
  assert.deepEqual(lead.captureSources, ['Website Free Report']);

  const wa = phone();
  await m.prospect.fileFreeReportPlatformLead({ name: 'Wa Person', phone: wa, businessName: 'Wa Biz', channel: 'whatsapp' });
  assert.equal((await m.Lead.findOne({ tenantId: T, phone: wa }).lean()).source, 'WhatsApp Free Report', 'no longer mislabelled Website');

  // The same website visitor books a demo through the website form.
  process.env.QA_TESTING_MODE = 'true';
  const res = await m.bookDemo.POST(jsonReq(`${BASE}/api/leads/book-demo`, 'POST', { name: 'Web Person', phone: web, businessName: 'Web Biz' }));
  assert.ok([200, 201].includes(res.status), String(res.status));
  lead = await m.Lead.findOne({ tenantId: T, phone: web }).lean();
  assert.equal(lead.source, 'Website Free Report', 'first channel kept');
  assert.deepEqual(lead.captureSources, ['Website Free Report', 'Website Demo Booking']);
  assert.ok(await m.LeadEvent.exists({ leadId: lead._id, type: 'LEAD_CAPTURED', 'payload.source': 'Website Demo Booking' }));

  // A brand-new website demo visitor.
  const demoOnly = phone();
  await m.bookDemo.POST(jsonReq(`${BASE}/api/leads/book-demo`, 'POST', { name: 'Demo Only', phone: demoOnly, businessName: 'Demo Biz' }));
  const d: any = await m.Lead.findOne({ tenantId: T, phone: demoOnly }).lean();
  assert.equal(d.source, 'Website Demo Booking');
  assert.equal(d.businessType, 'Demo Biz');

  // Filter by source finds a lead by ANY of its channels.
  const list = await pipeline(`source=${encodeURIComponent('Website Demo Booking')}`);
  const phones = list.rows.map((r: any) => r.phone);
  assert.ok(phones.includes(web) && phones.includes(demoOnly));
});

test('call log: recorded on the timeline with the team member, updates last contact, bad input refused', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const id = (await create({ name: 'Caller', phone: phone() })).json.leadId;
  const post = (b: any) => m.calls.POST(jsonReq(`${BASE}/x`, 'POST', b), { params: Promise.resolve({ id }) }).then(body);
  assert.equal((await post({ outcome: 'teleported' })).status, 400);
  assert.equal((await post({ outcome: 'connected', durationMin: 9999 })).status, 400);
  const ok = await post({ direction: 'outbound', outcome: 'connected', durationMin: 12, notes: 'Interested in yearly plan' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const d = await detail(id);
  const call = d.timeline.find((e: any) => e.type === 'CALL_LOGGED');
  assert.equal(call.payload.outcomeLabel, 'Connected');
  assert.equal(call.payload.durationMin, 12);
  assert.equal(call.actorName, 'Root Admin');
  assert.ok((await m.Lead.findById(id).lean()).lastContactedAt);
});

test('follow-ups: scheduled for a team member, listed, reminded once when due (push only, lead never messaged), completed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const id = (await create({ name: 'Follow Me', phone: phone() })).json.leadId;
  const due = new Date(Date.now() + 60_000).toISOString();
  const res = await m.leadFollowUps.POST(jsonReq(`${BASE}/x`, 'POST', { dueAt: due, type: 'Call', note: 'Pricing call' }), { params: Promise.resolve({ id }) }).then(body);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const row: any = await m.FollowUp.findById(res.json.followUpId).lean();
  assert.equal(row.tenantId, T);
  assert.equal(row.businessId, undefined, 'never visible to a customer CRM');
  assert.equal(String(row.assignedUserId), String(admin._id), 'defaults to the person who scheduled it');
  const bad = await m.leadFollowUps.POST(jsonReq(`${BASE}/x`, 'POST', { dueAt: 'nope' }), { params: Promise.resolve({ id }) });
  assert.equal(bad.status, 400);

  const open = await m.followUps.GET(new Request(`${BASE}/api/admin/crm/follow-ups?mine=1`)).then((r: Response) => r.json());
  assert.ok(open.followUps.some((f: any) => f._id === res.json.followUpId && f.leadName === 'Follow Me'));

  const first = await m.activity.sendDuePlatformFollowUpReminders(new Date(Date.now() + 120_000));
  const second = await m.activity.sendDuePlatformFollowUpReminders(new Date(Date.now() + 180_000));
  assert.ok(first.reminded >= 1);
  assert.equal(second.reminded, 0, 'once per due time');
  const { default: MessageQueue } = await import('../../src/models/MessageQueue');
  const lead: any = await m.Lead.findById(id).lean();
  assert.equal(await MessageQueue.countDocuments({ 'payload.phone': lead.phone }), 0, 'the lead is never messaged');

  const done = await m.followUpOne.PATCH(jsonReq(`${BASE}/x`, 'PATCH', { status: 'completed' }), { params: Promise.resolve({ id: res.json.followUpId }) });
  assert.equal(done.status, 200);
  assert.equal((await m.FollowUp.findById(res.json.followUpId).lean()).status, 'completed');
  assert.ok(await m.LeadEvent.exists({ leadId: id, type: 'FOLLOW_UP_DONE' }));

  // A customer workspace's follow-up is out of reach of the platform routes.
  const customer = await m.FollowUp.create({ tenantId: 'org-x', businessId: new m.mongoose.Types.ObjectId(), leadId: new m.mongoose.Types.ObjectId(), kind: 'task', scheduledFor: new Date(), status: 'pending' } as any);
  const blocked = await m.followUpOne.PATCH(jsonReq(`${BASE}/x`, 'PATCH', { status: 'completed' }), { params: Promise.resolve({ id: String(customer._id) }) });
  assert.equal(blocked.status, 404);
});

test('custom stages: saved, validated, picked on a lead, cleared when the lead changes stage or the sub-stage is deleted, renamed everywhere', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const put = (subStages: any) => m.subStages.PUT(jsonReq(`${BASE}/x`, 'PUT', { subStages })).then(body);
  assert.equal((await put([{ name: '', stage: 'QUALIFYING' }])).status, 400);
  assert.equal((await put([{ name: 'X', stage: 'HUMAN_HANDOFF' }])).status, 400);
  assert.equal((await put([{ name: 'Twice', stage: 'QUALIFYING' }, { name: 'twice', stage: 'QUALIFYING' }])).status, 400);
  const saved = await put([{ name: 'Called twice', stage: 'QUALIFYING', color: 'blue' }, { name: 'Needs pricing', stage: 'NURTURING' }]);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const [twice, pricing] = saved.json.subStages;

  const id = (await create({ name: 'Sub Stage', phone: phone(), stage: 'QUALIFYING' })).json.leadId;
  assert.equal((await patch(id, { subStageId: pricing.id })).status, 400, 'belongs to another stage');
  assert.equal((await patch(id, { subStageId: twice.id })).status, 200);
  assert.equal((await m.Lead.findById(id).lean()).subStage, 'Called twice');

  // Stage + sub-stage together.
  assert.equal((await patch(id, { stage: 'NURTURING', subStageId: pricing.id })).status, 200);
  let lead: any = await m.Lead.findById(id).lean();
  assert.equal(lead.currentStage, 'NURTURING');
  assert.equal(lead.subStage, 'Needs pricing', 'kept: it belongs to the new stage');

  // Rename carries through; changing stage clears a sub-stage of the old one.
  await put([{ ...twice }, { ...pricing, name: 'Pricing sent' }]);
  assert.equal((await m.Lead.findById(id).lean()).subStage, 'Pricing sent');
  await patch(id, { stage: 'COLD' });
  lead = await m.Lead.findById(id).lean();
  assert.equal(lead.subStageId, null);

  // Deleting a sub-stage clears it from its leads.
  await patch(id, { stage: 'QUALIFYING', subStageId: twice.id });
  await put([pricing]);
  assert.equal((await m.Lead.findById(id).lean()).subStageId, null);
});
