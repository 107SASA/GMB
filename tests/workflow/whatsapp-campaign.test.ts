/**
 * Super Admin → Leads & Pipeline → Send WhatsApp, through the REAL routes, the
 * real background job (runDurably) and the real send path, against an
 * in-memory MongoDB. Twilio's Content API is faked at the HTTP level; every
 * WhatsApp send is suppressed into a MessageQueue row. Nothing leaves the
 * machine.
 *
 * Run: npx tsx --test tests/workflow/whatsapp-campaign.test.ts
 */
import { signInAsSuperAdmin, jsonReq, startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runDurably } from '../helpers/inngestReplay';

process.env.TWILIO_ACCOUNT_SID = 'ACtest_not_real';
process.env.TWILIO_AUTH_TOKEN = 'test_not_real';
process.env.WHATSAPP_PROVIDER = 'twilio';

const APPROVED = 'HX' + 'a'.repeat(32);
const PENDING = 'HX' + 'b'.repeat(32);
const MISSING = 'HX' + 'c'.repeat(32);
const BODY = 'Hi {{1}}, this is the GrowwMatics team.\n\n{{2}}\n\nReply to this message if you have any questions.';

// Fake Twilio Content API (the harness already blocks every other outside call).
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const m = url.match(/^https:\/\/content\.twilio\.com\/v1\/Content\/(HX\w+)(\/ApprovalRequests)?$/);
  if (m) {
    if (m[1] === MISSING) return json({ message: 'not found' }, 404);
    if (m[2]) return json({ whatsapp: { status: m[1] === APPROVED ? 'approved' : 'pending', category: 'MARKETING', name: 'growwmatics_general_update' } });
    return json({ sid: m[1], friendly_name: 'growwmatics_general_update', types: { 'twilio/quick-reply': { body: BODY, actions: [] } } });
  }
  return harnessFetch(input, init);
}) as typeof fetch;

let skipReason: string | null = null;
let m: any = {};
const dispatched: any[] = [];
const BASE = 'https://app.example.test';

before(async () => {
  skipReason = await startMemoryDb('wa_campaign');
  if (skipReason) return;
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async (e: any) => { for (const x of [e].flat()) dispatched.push(x); return { ids: [] }; };
  m = {
    templates: await import('../../src/app/api/admin/whatsapp-templates/route'),
    templateOne: await import('../../src/app/api/admin/whatsapp-templates/[id]/route'),
    preview: await import('../../src/app/api/admin/crm/whatsapp/preview/route'),
    campaigns: await import('../../src/app/api/admin/crm/whatsapp/campaigns/route'),
    campaignOne: await import('../../src/app/api/admin/crm/whatsapp/campaigns/[id]/route'),
    job: await import('../../src/services/inngest/whatsappCampaign'),
    Lead: (await import('../../src/models/Lead')).default,
    Recipient: (await import('../../src/models/WhatsAppCampaignRecipient')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    WaMessage: (await import('../../src/models/WhatsAppMessage')).default,
    LeadEvent: (await import('../../src/models/LeadEvent')).default,
  };
  await m.Recipient.init();
  await signInAsSuperAdmin('campaign-admin@example.invalid');
});
after(stopMemoryDb);

const post = (route: any, path: string, body: unknown) => route.POST(jsonReq(`${BASE}${path}`, 'POST', body));
let seq = 0;
const lead = (extra: Record<string, unknown> = {}) =>
  m.Lead.create({ tenantId: 'gmbboost-internal', name: `Lead ${++seq}`, phone: `+9198400${String(seq).padStart(5, '0')}`, source: 'Manual', currentStage: 'NEW', ...extra } as any);
const runSend = async (campaignId: string) => runDurably(m.job.whatsappCampaignSend, { data: { campaignId } });

let approvedId = '';

test('templates are added by SID from Super Admin; details and approval come from Twilio; only approved ones can be sent', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal((await post(m.templates, '/api/admin/whatsapp-templates', { contentSid: 'HX123' })).status, 400, 'not a SID');
  assert.equal((await post(m.templates, '/api/admin/whatsapp-templates', { contentSid: MISSING })).status, 404, 'not in this Twilio account');

  const res = await post(m.templates, '/api/admin/whatsapp-templates', { contentSid: APPROVED, label: 'General update' });
  assert.equal(res.status, 201);
  const { template } = await res.json();
  approvedId = template.id;
  assert.equal(template.twilioName, 'growwmatics_general_update');
  assert.equal(template.category, 'MARKETING');
  assert.deepEqual(template.placeholders, [1, 2]);
  assert.equal(template.usable, true);
  assert.equal((await post(m.templates, '/api/admin/whatsapp-templates', { contentSid: APPROVED })).status, 409, 'no duplicate');

  const pending = await (await post(m.templates, '/api/admin/whatsapp-templates', { contentSid: PENDING, label: 'Offer' })).json();
  assert.equal(pending.template.usable, false);
  assert.match(pending.template.notUsableReason, /pending/);
  const l = await lead();
  const refused = await post(m.preview, '/api/admin/crm/whatsapp/preview', { ids: [String(l._id)], templateId: pending.template.id, message: 'x' });
  assert.equal(refused.status, 409, 'a pending template cannot be sent');
});

test('preview shows who gets it and who is left out; the send goes out once per lead with their first name and the message', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const good1 = await lead({ name: 'Rahul Patil' });
  const good2 = await lead({ name: '+919840099999', phone: '+919840099999' }); // imported without a name: the number is the name
  const sameNumber = await lead({ name: 'Rahul again', phone: good1.phone }); // two leads, one number
  const optedOut = await lead({ nurtureStatus: 'OPTED_OUT' });
  const dnc = await lead({ currentStage: 'DO_NOT_CONTACT' });
  const customer = await lead({ currentStage: 'CUSTOMER' });
  const ids = [good1, good2, sameNumber, optedOut, dnc, customer].map((x) => String(x._id));
  const message = 'It was great meeting you at the Pune Business Meet.\nWould you like a free report?';

  const pv = await (await post(m.preview, '/api/admin/crm/whatsapp/preview', { ids, templateId: approvedId, message })).json();
  assert.equal(pv.success, true);
  assert.equal(pv.total, 6);
  assert.equal(pv.eligible, 2);
  assert.deepEqual(pv.skipped.map((s: any) => s.reason).sort(), ['already-in-campaign', 'customer', 'do-not-contact', 'opted-out']);
  assert.equal(pv.preview.text, 'Hi Rahul, this is the GrowwMatics team.\n\nIt was great meeting you at the Pune Business Meet. Would you like a free report?\n\nReply to this message if you have any questions.');

  const created = await post(m.campaigns, '/api/admin/crm/whatsapp/campaigns', { ids, templateId: approvedId, message, name: 'Pune meet' });
  assert.equal(created.status, 201);
  const { campaignId, queued, skipped } = await created.json();
  assert.equal(queued, 2);
  assert.equal(skipped, 4);
  assert.ok(dispatched.some((e) => e.name === 'whatsapp/campaign.send' && e.data.campaignId === campaignId));

  await runSend(campaignId);
  await runSend(campaignId); // a duplicate event or retry sends nothing more
  const sends: any[] = await m.MessageQueue.find({ 'payload.contentSid': APPROVED }).lean();
  assert.equal(sends.length, 2, 'two messages, once each');
  const byPhone = new Map(sends.map((s) => [s.payload.phone, s.payload.variables]));
  assert.deepEqual(byPhone.get(good1.phone), { '1': 'Rahul', '2': 'It was great meeting you at the Pune Business Meet. Would you like a free report?' });
  assert.equal(byPhone.get(good2.phone)['1'], 'there', 'a phone number is never used as a first name');

  const c = (await (await m.campaignOne.GET(new Request(`${BASE}/x`), { params: Promise.resolve({ id: campaignId }) })).json()).campaign;
  assert.equal(c.status, 'done');
  assert.deepEqual(c.counts, { total: 6, sent: 2, failed: 0, skipped: 4 });
  assert.equal(await m.LeadEvent.countDocuments({ leadId: good1._id, type: 'MESSAGE_SENT', 'payload.source': 'WHATSAPP_CAMPAIGN' }), 1, 'on the lead timeline');
  const inbox: any = await m.WaMessage.findOne({ phoneKey: good1.phone.slice(-10), direction: 'out' }).lean();
  assert.equal(inbox.sender, 'team', 'in the WhatsApp Inbox as the team\'s message');

  // Within 7 days the same leads are left out, unless the sender switches that off.
  const again = await (await post(m.preview, '/api/admin/crm/whatsapp/preview', { ids: [String(good1._id)], templateId: approvedId, message: 'Hello again' })).json();
  assert.equal(again.eligible, 0);
  assert.equal(again.skipped[0].reason, 'recently-messaged');
  const override = await (await post(m.preview, '/api/admin/crm/whatsapp/preview', { ids: [String(good1._id)], templateId: approvedId, message: 'Hello again', skipRecent: false })).json();
  assert.equal(override.eligible, 1);
});

test('someone who opts out after the send was created is not messaged; a switched-off template stops the send', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await lead({ name: 'Asha' });
  const b = await lead({ name: 'Bina' });
  const { campaignId } = await (await post(m.campaigns, '/api/admin/crm/whatsapp/campaigns', { ids: [String(a._id), String(b._id)], templateId: approvedId, message: 'Our offer this week' })).json();
  await m.Lead.updateOne({ _id: a._id }, { $set: { nurtureStatus: 'OPTED_OUT' } });
  await runSend(campaignId);
  const rows: any[] = await m.Recipient.find({ campaignId }).lean();
  assert.equal(rows.find((r) => String(r.leadId) === String(a._id)).status, 'skipped');
  assert.equal(rows.find((r) => String(r.leadId) === String(b._id)).status, 'sent');

  const c = await lead({ name: 'Chetan' });
  const second = await (await post(m.campaigns, '/api/admin/crm/whatsapp/campaigns', { ids: [String(c._id)], templateId: approvedId, message: 'Another offer' })).json();
  await m.templateOne.PATCH(jsonReq(`${BASE}/x`, 'PATCH', { active: false }), { params: Promise.resolve({ id: approvedId }) });
  await runSend(second.campaignId);
  const row: any = await m.Recipient.findOne({ campaignId: second.campaignId }).lean();
  assert.equal(row.status, 'failed');
  assert.match(row.reason, /switched off/);
  await m.templateOne.PATCH(jsonReq(`${BASE}/x`, 'PATCH', { active: true }), { params: Promise.resolve({ id: approvedId }) });
});

test('"all leads matching the filters" uses the Leads & Pipeline filters; more than 1000 is refused', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await lead({ name: 'Filter One', currentStage: 'QUALIFYING' });
  await lead({ name: 'Filter Two', currentStage: 'QUALIFYING' });
  const pv = await (await post(m.preview, '/api/admin/crm/whatsapp/preview', { filters: 'crmStage=QUALIFYING&page=3', templateId: approvedId, message: 'Hi' })).json();
  assert.equal(pv.success, true);
  assert.equal(pv.total, 2);
  const { default: mongoose } = await import('mongoose');
  const ids = Array.from({ length: 1001 }, () => new mongoose.Types.ObjectId().toString());
  const tooMany = await post(m.preview, '/api/admin/crm/whatsapp/preview', { ids, templateId: approvedId, message: 'Hi' });
  assert.equal(tooMany.status, 400);
});

test('the "Stop messages" button on the template opts the person out, like STOP', async () => {
  const { isOptOutKeyword } = await import('../../src/services/messaging/inboundOptOut');
  assert.equal(isOptOutKeyword('Stop messages'), true);
  assert.equal(isOptOutKeyword('STOP'), true);
  assert.equal(isOptOutKeyword('please stop sending the report link'), false, 'only the exact words');
});
