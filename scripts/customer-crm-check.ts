/**
 * Customer CRM end-to-end checks on a throwaway in-memory MongoDB, calling
 * the real route handlers as Business A / Business B:
 *   creation paths + dedupe, workspace security matrix, deal value (422),
 *   follow-up tasks + reminders, calls (save / existing / dismiss), ROI API,
 *   no automatic WhatsApp to leads, super-admin leads untouched.
 *   npx tsx scripts/customer-crm-check.ts
 * Nothing is sent: WhatsApp, push, in-app notifications and Inngest are
 * intercepted and captured. Auth (requireBusinessContext) is stubbed.
 */
import fs from 'fs';
import path from 'path';

for (const file of ['.env.local', '.env']) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) continue;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2]; if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, ''); v = v.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];
delete process.env.GROQ_API_KEY;
process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
// The test business owns +14155550100; never route it to the platform line.
for (const k of ['PLATFORM_WHATSAPP_NUMBER', 'NEXT_PUBLIC_WHATSAPP_NUMBER', 'META_WHATSAPP_PHONE_NUMBER_ID']) delete process.env[k];

const whatsapp: Array<{ phone: string; body: string }> = [];
const events: Array<{ name: string; data: any }> = [];
const notifications: Array<{ businessId: string; type: string; title?: string; body?: string; link?: string }> = [];
const pushes: Array<{ businessId: string; data: any }> = [];
let ctx: any = null;

/** __esModule + default=self so both static and lazy `await import()` see the named exports. */
const esm = (o: Record<string, unknown>) => { const m: any = { __esModule: true, ...o }; m.default = m; return m; };
const aiCalls: string[] = [];
class FakeGroq {
  chat = { completions: { create: async () => { aiCalls.push('groq'); return { choices: [{ message: { content: '{}' } }] }; } } };
}
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url ?? '';
  if (/groq\.com|openai\.com|anthropic\.com|generativelanguage\.googleapis\.com/.test(url)) { aiCalls.push(url); return new Response('{}'); }
  return realFetch(input, init);
}) as typeof fetch;
const Module = require('module');
const origLoad = Module._load;
let mobileGet: ((url: string, cfg?: any) => Promise<{ data: any }>) | null = null;
const mobileUrls: string[] = [];
Module._load = function (request: string, ...rest: any[]) {
  if (/mobile[\\/]src[\\/]api[\\/]client(\.ts)?$/.test(request) || request === '../client') {
    return esm({ api: { get: async (url: string, cfg?: any) => { mobileUrls.push(url); return mobileGet!(url, cfg); } }, getApiErrorMessage: () => '' });
  }
  if (request === 'groq-sdk' || /node_modules[\\/]groq-sdk[\\/]/.test(request)) return esm({ Groq: FakeGroq, default: FakeGroq });
  if (/services[\\/]whatsapp[\\/]send(\.ts)?$/.test(request)) {
    const sendOutboundMessage = async (phone: string, body: string) => { whatsapp.push({ phone, body }); return { success: true, sid: 'captured' }; };
    return esm({ sendOutboundMessage });
  }
  if (/services[\\/]inngest[\\/]client(\.ts)?$/.test(request)) {
    const inngest = { send: async (e: any) => { for (const x of Array.isArray(e) ? e : [e]) events.push(x); return { ids: [] }; }, createFunction: (cfg: any, handler: any) => ({ cfg, handler }) };
    return esm({ inngest });
  }
  if (/services[\\/]notifications(\.ts)?$/.test(request)) {
    return esm({ notifyBusinessUsers: async (businessId: string, n: any) => { notifications.push({ businessId, type: n.type, title: n.title, body: n.body, link: n.link }); } });
  }
  if (/services[\\/]push(\.ts)?$/.test(request)) {
    return esm({ sendPushToBusinessUsers: async (businessId: string, m: any) => { pushes.push({ businessId, data: m.data }); }, sendPushToUser: async () => {}, sendPushToSuperAdmins: async () => {} });
  }
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) {
    return esm({ requireBusinessContext: async () => ctx });
  }
  if (/lib[\\/]twilioSignature(\.ts)?$/.test(request)) {
    return esm({ validateTwilioSignature: async () => ({ ok: true }) });
  }
  if (/lib[\\/]moduleGating(\.ts)?$/.test(request)) {
    return esm({ requireModule: async () => ({ ok: true }) });
  }
  return origLoad.call(this, request, ...rest);
};

// Lazy `await import()` of a CJS-compiled .ts file is evaluated through the
// ESM translator, which reads require.cache before running the file — seed the
// same mocks there so lazy and static imports both get them.
for (const rel of ['mobile/src/api/client.ts', 'src/services/whatsapp/send.ts', 'src/services/inngest/client.ts', 'src/services/notifications.ts', 'src/services/push.ts', 'src/lib/tenant.ts', 'src/lib/moduleGating.ts', 'src/lib/twilioSignature.ts']) {
  const filename = path.resolve(rel);
  const exports = Module._load(filename);
  const m = new Module(filename);
  m.filename = filename;
  m.loaded = true;
  m.exports = exports;
  require.cache[filename] = m;
}
try {
  const groqPath = require.resolve('groq-sdk');
  const gm = new Module(groqPath); gm.filename = groqPath; gm.loaded = true; gm.exports = Module._load('groq-sdk');
  require.cache[groqPath] = gm;
} catch { /* groq-sdk not installed — nothing to intercept */ }

const results: Array<{ t: string; pass: boolean }> = [];
const check = (t: string, what: string, pass: boolean, detail = '') => { results.push({ t, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  [${t}] ${what}${detail ? ` — ${detail}` : ''}`); };

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://local.test${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function json(res: Response) { return { status: res.status, body: await res.json().catch(() => ({})) as any }; }

(async () => {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = mem.getUri('customer_crm_check');
  try {
    const mongoose = (await import('mongoose')).default;
    const dbConnect = (await import('../src/lib/mongodb')).default; await dbConnect();
    const { default: Business } = await import('../src/models/Business');
    const { default: Lead } = await import('../src/models/Lead');
    const { default: Activity } = await import('../src/models/Activity');
    const { default: FollowUp } = await import('../src/models/FollowUp');
    const { default: CallEvent } = await import('../src/models/CallEvent');
    const { createOrUpdateCustomerLead } = await import('../src/services/crm/customerLeads');
    const { recordCallEvent } = await import('../src/services/crm/calls');
    const { sendDueFollowUpReminders, sendStaleLeadReminders, STALE_LEAD_DAYS } = await import('../src/services/crm/followUps');
    const { twilioAdapter } = await import('../src/services/telephony/normalize');

    const leadsRoute = await import('../src/app/api/crm/leads/route');
    const leadRoute = await import('../src/app/api/crm/leads/[id]/route');
    const activityRoute = await import('../src/app/api/crm/leads/[id]/activity/route');
    const timelineRoute = await import('../src/app/api/crm/leads/[id]/timeline/route');
    const quickAdd = await import('../src/app/api/leads/quick-add/route');
    const bulkImport = await import('../src/app/api/leads/bulk-import/route');
    const csvImport = await import('../src/app/api/crm/leads/import/route');
    const campaignImport = await import('../src/app/api/campaigns/import/route');
    const appointments = await import('../src/app/api/appointments/route');
    const followups = await import('../src/app/api/followups/route');
    const followup = await import('../src/app/api/followups/[id]/route');
    const callsRoute = await import('../src/app/api/crm/calls/route');
    const callRoute = await import('../src/app/api/crm/calls/[id]/route');
    const roiRoute = await import('../src/app/api/crm/roi/route');
    const investmentRoute = await import('../src/app/api/crm/roi/investment/route');
    const stagesRoute = await import('../src/app/api/business/lead-stages/route');
    const voiceRoute = await import('../src/app/api/twilio/voice/route');
    const waWebhook = await import('../src/app/api/whatsapp/webhook/route');
    const form = (url: string, f: Record<string, string>) => {
      const b = new URLSearchParams(f);
      return new Request(`http://local.test${url}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b.toString() });
    };

    const orgA = new mongoose.Types.ObjectId();
    const orgB = new mongoose.Types.ObjectId();
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const bizA: any = await Business.create({ name: 'Mulsetu Dental', category: 'Dentist', address: 'Shop 4, FC Road, Pune', organizationId: orgA, userId: userA,
      services: 'Root canal, dental implants, teeth cleaning', description: 'Family dental clinic since 2009', whatsappConfig: { businessPhone: '+14155550100' } });
    const bizB: any = await Business.create({ name: 'Other Gym', category: 'Gym', address: 'Nashik', organizationId: orgB, userId: userB });
    const asA = () => { ctx = { ok: true, userId: String(userA), organizationId: String(orgA), businessId: String(bizA._id), business: bizA }; };
    const asB = () => { ctx = { ok: true, userId: String(userB), organizationId: String(orgB), businessId: String(bizB._id), business: bizB }; };

    // Super-admin platform prospect — must stay untouched.
    const platform: any = await Lead.create({ tenantId: 'gmbboost-internal', name: 'Platform Prospect', phone: '+919811111111', source: 'WhatsApp', leadType: 'Platform Prospect' });
    const platformBefore = JSON.stringify(await Lead.findById(platform._id).lean());

    // ── Creation paths ──────────────────────────────────────────────────
    asA();
    let r = await json(await leadsRoute.POST(req('/api/crm/leads', 'POST', { name: 'Rahul', phone: '+91 98000 00001', interest: 'Implant' })));
    const rahulId = r.body.lead?._id;
    check('C1', 'web Add Lead → created, normalized phone, source Manual, initial stage', r.status === 201 && r.body.lead.phone === '+919800000001' && r.body.lead.source === 'Manual' && r.body.lead.lifeCycleStage === 'initial', `${r.status} ${r.body.lead?.phone}`);
    r = await json(await quickAdd.POST(req('/api/leads/quick-add', 'POST', { phone: '09800000001', name: 'Rahul again' })));
    check('C2', 'app quick-add with a different phone format → existing lead returned, no duplicate', r.status === 200 && r.body.existing === true && String(r.body.lead._id) === String(rahulId) && (await Lead.countDocuments({ businessId: bizA._id })) === 1);
    r = await json(await bulkImport.POST(req('/api/leads/bulk-import', 'POST', { leads: [{ name: 'Priya', phone: '+919800000002' }, { name: 'Priya dup', phone: '9800000002' }, { name: 'Rahul', phone: '+919800000001' }] })));
    check('C3', 'contacts import → 1 created, 2 skipped (in-batch + existing)', r.body.created === 1 && r.body.skipped === 2, JSON.stringify(r.body));
    const fd = new FormData();
    fd.append('file', new File(['name,phone,email,source,lifeCycleStage\nAnil,+919800000003,anil@x.com,,active\nRahul,98000-00001,,,\nWon Guy,+919800000004,,Referral,converted\n'], 'leads.csv', { type: 'text/csv' }));
    r = await json(await csvImport.POST(new Request('http://local.test/api/crm/leads/import', { method: 'POST', body: fd }) as any));
    const anil: any = await Lead.findOne({ businessId: bizA._id, phone: '+919800000003' }).lean();
    const wonGuy: any = await Lead.findOne({ businessId: bizA._id, phone: '+919800000004' }).lean();
    check('C4', 'CSV import → source "CSV Import", existing number skipped, "converted" row NOT marked won without a value', r.body.created === 2 && r.body.skipped === 1 && anil?.source === 'CSV Import' && anil?.lifeCycleStage === 'active' && wonGuy?.lifeCycleStage === 'initial' && wonGuy?.source === 'Referral', JSON.stringify({ created: r.body.created, skipped: r.body.skipped }));
    r = await json(await campaignImport.POST(req('/api/campaigns/import', 'POST', { customers: [{ name: 'Old Customer', phone: '+919800000005' }] })));
    const oldCust: any = await Lead.findOne({ businessId: bizA._id, phone: '+919800000005' }).lean();
    check('C5', 'campaign upload → valid source "Campaign Import" (was invalid "Import"), not auto-Converted, no fake score', r.status === 200 && oldCust?.source === 'Campaign Import' && oldCust?.lifeCycleStage === 'initial' && oldCust?.aiScore !== 100 && oldCust?.pipelineStage == null, `${r.status} ${oldCust?.source}`);
    r = await json(await appointments.POST(req('/api/appointments', 'POST', { name: 'Meera', phone: '+919800000006', serviceInterest: 'Cleaning', date: '2026-10-10', time: '11:00', status: 'Booking Pending' }) as any));
    const meera: any = await Lead.findOne({ businessId: bizA._id, phone: '+919800000006' }).lean();
    const apptAct = await Activity.countDocuments({ leadId: meera?._id, type: 'appointment' });
    check('C6', 'appointment → lead source "Appointment", valid status, appointment activity', r.status === 201 && meera?.source === 'Appointment' && r.body.status === 'Scheduled' && apptAct === 1, `${r.status} ${r.body.status}`);

    const created = events.filter((e) => e.name === 'crm/lead-created');
    const orgEv = created.find((e) => e.data.leadId === String(rahulId));
    check('C7', 'every new lead queues the new-lead event (owner alert only for organic sources, never for imports)',
      created.length === 6 && orgEv?.data.notifyOwner === false && created.every((e) => e.data.notifyOwner === false),
      `${created.length} events`);
    const wa: any = await createOrUpdateCustomerLead({ businessId: String(bizA._id), organizationId: String(orgA), name: 'WA Lead', phone: '+919800000007', source: 'WhatsApp' });
    const waEv = events.filter((e) => e.name === 'crm/lead-created').find((e) => e.data.leadId === String(wa.lead._id));
    check('C8', 'WhatsApp lead (organic) → owner alert requested; lead itself is never messaged', waEv?.data.notifyOwner === true && whatsapp.length === 0);
    let refused = false;
    try { await createOrUpdateCustomerLead({ businessId: String(bizA._id), organizationId: 'gmbboost-internal', name: 'x', phone: '+919800000099', source: 'Manual' }); } catch { refused = true; }
    check('C9', 'central service refuses the platform (super-admin) tenant', refused);

    // ── Security matrix (Business B acting on Business A) ───────────────
    asB();
    const sec: string[] = [];
    if ((await json(await leadsRoute.GET(req('/api/crm/leads')))).body.leads.length !== 0) sec.push('list');
    if ((await leadRoute.PATCH(req(`/api/crm/leads/${rahulId}`, 'PATCH', { notes: 'hack' }) as any, params(rahulId))).status !== 404) sec.push('patch');
    if ((await activityRoute.POST(req(`/api/crm/leads/${rahulId}/activity`, 'POST', { type: 'note', content: 'x' }), params(rahulId))).status !== 404) sec.push('activity');
    if ((await timelineRoute.GET(req(`/api/crm/leads/${rahulId}/timeline`) as any, params(rahulId) as any)).status === 200) sec.push('timeline');
    if ((await followups.POST(req('/api/followups', 'POST', { leadId: rahulId, dueAt: new Date().toISOString(), type: 'Call' }))).status !== 404) sec.push('followup-create');
    if ((await appointments.POST(req('/api/appointments', 'POST', { leadId: rahulId }) as any)).status !== 404) sec.push('appointment');
    const roiB = (await json(await roiRoute.GET(req('/api/crm/roi?days=30')))).body.roi;
    if (roiB.totalLeads !== 0) sec.push('roi');
    const stillClean: any = await Lead.findById(rahulId).lean();
    if (stillClean.notes === 'hack') sec.push('write-leak');
    check('S1', 'Business B cannot list, edit, log on, read the timeline of, task, book or count Business A leads', sec.length === 0, sec.join(',') || 'all blocked');

    // ── Stages + deal value ─────────────────────────────────────────────
    asA();
    r = await json(await leadRoute.PATCH(req(`/api/crm/leads/${rahulId}`, 'PATCH', { lifeCycleStage: 'active', subStageId: 'active-interested' }) as any, params(rahulId)));
    check('D1', 'stage move by stable id → lifeCycleStage + subStage + status_change activity', r.status === 200 && r.body.lead.subStage === 'Interested' && (await Activity.countDocuments({ leadId: rahulId, type: 'status_change' })) === 1);
    r = await json(await leadRoute.PATCH(req(`/api/crm/leads/${rahulId}`, 'PATCH', { lifeCycleStage: 'converted', subStageId: 'converted-sales-closed' }) as any, params(rahulId)));
    const afterReject: any = await Lead.findById(rahulId).lean();
    check('D2', 'Won without a deal value → 422 DEAL_VALUE_REQUIRED, lead unchanged', r.status === 422 && r.body.code === 'DEAL_VALUE_REQUIRED' && afterReject.lifeCycleStage === 'active');
    r = await json(await leadRoute.PATCH(req(`/api/crm/leads/${rahulId}`, 'PATCH', { lifeCycleStage: 'converted', subStageId: 'converted-sales-closed', deal: { value: -5, currency: 'INR' } }) as any, params(rahulId)));
    check('D3', 'negative deal value rejected', r.status === 400 && r.body.code === 'INVALID_DEAL');
    r = await json(await leadRoute.PATCH(req(`/api/crm/leads/${rahulId}`, 'PATCH', { lifeCycleStage: 'converted', subStageId: 'converted-sales-closed', deal: { value: 45000, currency: 'INR', notes: 'Implant' } }) as any, params(rahulId)));
    check('D4', 'Won with value → converted, deal stored, convertedAt, deal_won activity', r.status === 200 && r.body.lead.lifeCycleStage === 'converted' && r.body.lead.deal.value === 45000 && !!r.body.lead.convertedAt && (await Activity.countDocuments({ leadId: rahulId, type: 'deal_won' })) === 1);
    const priya: any = await Lead.findOne({ businessId: bizA._id, phone: '+919800000002' });
    r = await json(await leadRoute.PATCH(req(`/api/crm/leads/${priya._id}`, 'PATCH', { pipelineStage: 'Converted' }) as any, params(String(priya._id))));
    check('D5', 'legacy app build (pipelineStage only) → converted with valueMissing, never an invented value', r.status === 200 && r.body.lead.lifeCycleStage === 'converted' && r.body.lead.deal.value === null && r.body.lead.deal.valueMissing === true);
    r = await json(await leadRoute.PATCH(req(`/api/crm/leads/${anil._id}`, 'PATCH', { lifeCycleStage: 'closed', subStageId: 'closed-budget-issues' }) as any, params(String(anil._id))));
    check('D6', 'Lost → lostAt + deal_lost activity', r.status === 200 && !!r.body.lead.lostAt && (await Activity.countDocuments({ leadId: anil._id, type: 'deal_lost' })) === 1);
    r = await json(await leadRoute.PATCH(req(`/api/crm/leads/${anil._id}`, 'PATCH', { lifeCycleStage: 'active', subStageId: 'closed-lost' }) as any, params(String(anil._id))));
    check('D7', 'sub-stage from another group rejected (400 INVALID_STAGE)', r.status === 400 && r.body.code === 'INVALID_STAGE');

    // Stage rename keeps leads attached.
    const st = (await json(await stagesRoute.GET(req('/api/business/lead-stages') as any))).body.leadStages;
    st.active = st.active.map((s: any) => (s.id === 'active-interested' ? { ...s, name: 'Hot Prospect' } : s));
    r = await json(await stagesRoute.PATCH(req('/api/business/lead-stages', 'PATCH', { leadStages: st }) as any));
    const anyInterested: any = await Lead.findOne({ businessId: bizA._id, subStageId: 'active-interested' }).lean();
    check('D8', 'renaming a sub-stage keeps its id and updates lead labels', r.status === 200 && r.body.leadStages.active.some((s: any) => s.id === 'active-interested' && s.name === 'Hot Prospect') && (anyInterested == null || anyInterested.subStage === 'Hot Prospect'));

    // Ids are PERSISTED (re-read from the database, not the PATCH response).
    const stored: any = await Business.findById(bizA._id).select('leadStages').lean();
    const reread = (await json(await stagesRoute.GET(req('/api/business/lead-stages') as any))).body.leadStages;
    check('D9', 'stage ids are stored in the database and survive a re-read after rename',
      stored.leadStages.active.some((x: any) => x.id === 'active-interested' && x.name === 'Hot Prospect') && reread.active.some((x: any) => x.id === 'active-interested' && x.name === 'Hot Prospect'));
    // Reorder → ids unchanged.
    const idsByName = (cfg: any) => cfg.active.map((x: any) => `${x.name}=${x.id}`).sort();
    const beforeOrder = idsByName(reread);
    await stagesRoute.PATCH(req('/api/business/lead-stages', 'PATCH', { leadStages: { ...reread, active: [...reread.active].reverse() } }) as any);
    const reordered = (await json(await stagesRoute.GET(req('/api/business/lead-stages') as any))).body.leadStages;
    check('D10', 'reordering sub-stages keeps every id', JSON.stringify(idsByName(reordered)) === JSON.stringify(beforeOrder) && reordered.active[0].name === reread.active[reread.active.length - 1].name);
    // Every default sub-stage + a custom one, moved to through the API.
    const walker: any = (await createOrUpdateCustomerLead({ businessId: String(bizA._id), organizationId: String(orgA), name: 'Stage Walker', phone: '+919800000300', source: 'Manual', skipAutomation: true })).lead;
    const withCustom = { ...reordered, active: [...reordered.active, { name: 'VIP Follow', color: 'violet' }] };
    const afterCustom = (await json(await stagesRoute.PATCH(req('/api/business/lead-stages', 'PATCH', { leadStages: withCustom }) as any))).body.leadStages;
    const vip = afterCustom.active.find((x: any) => x.name === 'VIP Follow');
    const walk: Array<[string, string, any?]> = [
      ['active', 'active-new'], ['active', 'active-exploring'], ['active', 'active-interested'], ['active', 'active-follow-up'], ['active', 'active-prospect'],
      ['closed', 'closed-lost'], ['closed', 'closed-no-need'], ['closed', 'closed-budget-issues'],
      ['converted', 'converted-sales-closed', { value: 12000, currency: 'INR' }], ['active', vip?.id],
    ];
    const walkFails: string[] = [];
    for (const [lc, id, deal] of walk) {
      const res = await json(await leadRoute.PATCH(req(`/api/crm/leads/${walker._id}`, 'PATCH', { lifeCycleStage: lc, subStageId: id, ...(deal ? { deal } : {}) }) as any, params(String(walker._id))));
      if (res.status !== 200 || res.body.lead.lifeCycleStage !== lc || res.body.lead.subStageId !== id) walkFails.push(`${lc}/${id}:${res.status}`);
    }
    check('D11', 'every stage is reachable by stable id: New, Exploring, Interested(renamed), Follow Up, Prospect, Lost, No Need, Budget Issues, Sales Closed (with value), custom',
      walkFails.length === 0 && !!vip?.id, walkFails.join(', ') || `custom id ${vip?.id}`);
    // Delete the custom stage the lead sits in → lead stays put (not orphaned, not moved).
    await stagesRoute.PATCH(req('/api/business/lead-stages', 'PATCH', { leadStages: { ...afterCustom, active: afterCustom.active.filter((x: any) => x.name !== 'VIP Follow') } }) as any);
    const afterDelete: any = await Lead.findById(walker._id).lean();
    const listed = (await json(await leadsRoute.GET(req('/api/crm/leads')))).body.leads.some((l: any) => String(l._id) === String(walker._id));
    check('D12', 'deleting a sub-stage keeps its leads in the same group with their data (shown as unsorted), still listed — never moved to an unrelated stage',
      afterDelete.lifeCycleStage === 'active' && afterDelete.subStageId === vip.id && afterDelete.subStage === 'VIP Follow' && listed);
    const readd = (await json(await stagesRoute.PATCH(req('/api/business/lead-stages', 'PATCH', { leadStages: afterCustom }) as any))).body.leadStages;
    check('D13', 're-adding the deleted stage by name restores the same id (its leads re-attach)', readd.active.some((x: any) => x.name === 'VIP Follow' && x.id === vip.id));

    // ── Follow-up tasks ─────────────────────────────────────────────────
    const due = new Date(Date.now() - 60_000).toISOString();
    r = await json(await followups.POST(req('/api/followups', 'POST', { leadId: String(meera._id), dueAt: due, type: 'Call', note: 'Discuss quotation' })));
    const fuId = r.body.followUp?._id;
    check('F1', 'follow-up task created (kind task, businessId, type, note, createdBy) + timeline entry', r.status === 201 && r.body.followUp.kind === 'task' && String(r.body.followUp.businessId) === String(bizA._id) && r.body.followUp.note === 'Discuss quotation' && (await Activity.countDocuments({ leadId: meera._id, type: 'follow_up' })) === 1);
    const n1 = await sendDueFollowUpReminders(new Date());
    const n2 = await sendDueFollowUpReminders(new Date());
    check('F2', 'due task → one owner reminder (in-app + push with crmLeadId), never repeated, nothing sent to the lead', n1.reminded === 1 && n2.reminded === 0 && notifications.filter((n) => n.type === 'crm_follow_up_due').length === 1 && pushes.some((p) => p.data?.crmLeadId === String(meera._id)) && whatsapp.length === 0, `${n1.reminded}/${n2.reminded}`);
    asB();
    const fB = (await json(await followups.GET(req('/api/followups')))).body.followUps.length;
    const patchB = (await followup.PATCH(req(`/api/followups/${fuId}`, 'PATCH', { action: 'complete' }), params(fuId))).status;
    check('F3', 'Business B cannot see or complete Business A tasks', fB === 0 && patchB === 404, `${fB} / ${patchB}`);
    asA();
    r = await json(await followup.PATCH(req(`/api/followups/${fuId}`, 'PATCH', { action: 'complete' }), params(fuId)));
    check('F4', 'complete → status completed, completedAt, lastContactedAt on the lead', r.status === 200 && r.body.followUp.status === 'completed' && !!r.body.followUp.completedAt && !!(await Lead.findById(meera._id).lean() as any).lastContactedAt);

    const { default: User } = await import('../src/models/User');
    const member: any = await User.create({ fullName: 'Front Desk', email: 'desk@example.invalid', phone: '+919811100001', businessIds: [bizA._id] });
    const outsider: any = await User.create({ fullName: 'Other Owner', email: 'other@example.invalid', phone: '+919811100002', organizationId: orgB, businessIds: [bizB._id] });
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const tOk = await json(await followups.POST(req('/api/followups', 'POST', { leadId: String(meera._id), dueAt: later, type: 'Meeting', note: 'Visit', assignedUserId: String(member._id) })));
    const tBad = await json(await followups.POST(req('/api/followups', 'POST', { leadId: String(meera._id), dueAt: later, type: 'Call', assignedUserId: String(outsider._id) })));
    check('F5', 'assignee must be a member of this workspace (another business\'s user → 400)', tOk.status === 201 && String(tOk.body.followUp.assignedUserId) === String(member._id) && tOk.body.followUp.type === 'Meeting' && String(tOk.body.followUp.createdBy) === String(userA) && tBad.status === 400);
    const newDue = new Date(Date.now() + 5 * 86_400_000);
    const rs = await json(await followup.PATCH(req(`/api/followups/${tOk.body.followUp._id}`, 'PATCH', { action: 'reschedule', dueAt: newDue.toISOString() }), params(tOk.body.followUp._id)));
    check('F6', 'reschedule → new due date, still pending', rs.status === 200 && new Date(rs.body.followUp.scheduledFor).getTime() === newDue.getTime() && rs.body.followUp.status === 'pending');
    const cx = await json(await followup.PATCH(req(`/api/followups/${tOk.body.followUp._id}`, 'PATCH', { action: 'cancel' }), params(tOk.body.followUp._id)));
    const badType = await json(await followups.POST(req('/api/followups', 'POST', { leadId: String(meera._id), dueAt: 'not-a-date', type: 'Call' })));
    check('F7', 'cancel → cancelled; invalid date rejected', cx.status === 200 && cx.body.followUp.status === 'cancelled' && badType.status === 400);

    // ── Calls ───────────────────────────────────────────────────────────
    const ring = (sid: string, from: string, status = 'ringing', extra: Record<string, string> = {}) =>
      twilioAdapter.normalize({ CallSid: sid, From: from, To: '+14155550100', Direction: 'inbound', CallStatus: status, ...extra })!;
    const leadsBefore = await Lead.countDocuments({ businessId: bizA._id });
    await recordCallEvent(bizA, ring('CA-unknown', '+919800000050'));
    const pendingEv: any = await CallEvent.findOne({ callId: 'CA-unknown' }).lean();
    check('T1', 'unknown caller → pending call, owner asked (in-app + push), NO lead auto-created', pendingEv?.leadState === 'pending' && (await Lead.countDocuments({ businessId: bizA._id })) === leadsBefore && notifications.some((n) => n.type === 'crm_incoming_call') && pushes.some((p) => p.data?.callEventId === String(pendingEv._id)));
    await recordCallEvent(bizA, ring('CA-known', '09800000006'));
    const knownEv: any = await CallEvent.findOne({ callId: 'CA-known' }).lean();
    check('T2', 'existing lead calls (other number format) → linked, call activity, no duplicate', knownEv?.leadState === 'existing_lead' && String(knownEv.leadId) === String(meera._id) && (await Lead.countDocuments({ businessId: bizA._id })) === leadsBefore && (await Activity.countDocuments({ leadId: meera._id, type: 'call' })) >= 1);
    await recordCallEvent(bizA, ring('CA-unknown', '+919800000050', 'no-answer'));
    const missedEv: any = await CallEvent.findOne({ callId: 'CA-unknown' }).lean();
    check('T3', 'status callback on the same call → one record, outcome missed (no duplicate event)', (await CallEvent.countDocuments({ callId: 'CA-unknown' })) === 1 && missedEv.outcome === 'missed');
    asB();
    const callsB = (await json(await callsRoute.GET(req('/api/crm/calls')))).body.calls.length;
    const saveB = (await callRoute.POST(req(`/api/crm/calls/${pendingEv._id}`, 'POST', { action: 'save' }), params(String(pendingEv._id)))).status;
    check('T4', 'Business B cannot list or save Business A calls', callsB === 0 && saveB === 404, `${callsB} / ${saveB}`);
    asA();
    const pend = (await json(await callsRoute.GET(req('/api/crm/calls?state=pending')))).body;
    r = await json(await callRoute.POST(req(`/api/crm/calls/${pendingEv._id}`, 'POST', { action: 'save', name: 'Caller Fifty', createCallbackTask: true }), params(String(pendingEv._id))));
    const callLead: any = await Lead.findOne({ businessId: bizA._id, phone: '+919800000050' }).lean();
    const cb = await FollowUp.countDocuments({ leadId: callLead?._id, kind: 'task', type: 'Call' });
    check('T5', 'Save as Lead → source "Phone Call", call activity, optional callback task; never auto-WhatsApp', pend.pendingCount === 1 && r.status === 200 && r.body.created === true && callLead?.source === 'Phone Call' && cb === 1 && whatsapp.length === 0);
    await recordCallEvent(bizA, ring('CA-again', '+919800000050'));
    const againEv: any = await CallEvent.findOne({ callId: 'CA-again' }).lean();
    check('T6', 'same caller calls again → recognised as existing lead', againEv?.leadState === 'existing_lead' && String(againEv.leadId) === String(callLead._id));
    await recordCallEvent(bizA, ring('CA-spam', '+919800000060'));
    const spam: any = await CallEvent.findOne({ callId: 'CA-spam' }).lean();
    r = await json(await callRoute.POST(req(`/api/crm/calls/${spam._id}`, 'POST', { action: 'dismiss' }), params(String(spam._id))));
    check('T7', 'Dismiss → no lead, call marked dismissed', r.status === 200 && r.body.callEvent.leadState === 'dismissed' && !(await Lead.exists({ businessId: bizA._id, phone: '+919800000060' })));
    await recordCallEvent(bizA, ring('CA-link', '+919800000070'));
    const linkEv: any = await CallEvent.findOne({ callId: 'CA-link' }).lean();
    r = await json(await callRoute.POST(req(`/api/crm/calls/${linkEv._id}`, 'POST', { action: 'link', leadId: String(rahulId) }), params(String(linkEv._id))));
    check('T8', 'Existing Lead → call attached to the chosen lead', r.status === 200 && r.body.callEvent.leadState === 'existing_lead' && String(r.body.callEvent.leadId) === String(rahulId));

    // ── ROI API ─────────────────────────────────────────────────────────
    r = await json(await roiRoute.GET(req('/api/crm/roi?days=30')));
    const roi = r.body.roi;
    check('R1', 'ROI API: converted by lifeCycleStage, revenue only from recorded values, ROI unavailable without investment',
      r.status === 200 && roi.convertedLeads === 2 && roi.convertedWithoutValue === 1 && roi.wonRevenue === 45000 && roi.roiPercent === null && roi.roiNote === 'ROI unavailable — investment/cost not configured.',
      JSON.stringify({ total: roi.totalLeads, conv: roi.convertedLeads, rev: roi.wonRevenue }));
    check('R2', 'phone performance + missed opportunities are counts, not money', roi.phone.callsReceived >= 4 && roi.phone.savedAsLeads === 1 && r.body.missedOpportunities.every((l: string) => !/₹|INR/.test(l)), JSON.stringify(roi.phone));
    await investmentRoute.PATCH(req('/api/crm/roi/investment', 'PATCH', { monthlyAmount: 15000 }));
    r = await json(await roiRoute.GET(req('/api/crm/roi?days=30')));
    check('R3', 'with a monthly investment → ROI % computed', typeof r.body.roi.roiPercent === 'number' && r.body.roi.investment.monthly === 15000, `${r.body.roi.roiPercent}%`);

    // ── Webhook creation paths (real route handlers) ────────────────────
    const leadsBeforeVoice = await Lead.countDocuments({ businessId: bizA._id });
    const vr = await voiceRoute.POST(form('/api/twilio/voice', { CallSid: 'CA-voice', From: '+919800000080', To: '+14155550100', CallStatus: 'ringing', Direction: 'inbound' }));
    const vEv: any = await CallEvent.findOne({ callId: 'CA-voice' }).lean();
    check('W1', 'Twilio voice webhook → normalized CallEvent for the right business, TwiML 200, no auto-created lead',
      vr.status === 200 && /<Response><\/Response>/.test(await vr.text()) && String(vEv?.businessId) === String(bizA._id) && vEv?.leadState === 'pending' && (await Lead.countDocuments({ businessId: bizA._id })) === leadsBeforeVoice);
    const wr = await waWebhook.POST(form('/api/whatsapp/webhook', { MessageSid: 'SM-1', From: 'whatsapp:+919800000090', To: 'whatsapp:+14155550100', Body: 'Hi, price for cleaning?', ProfileName: 'Sana' }));
    const sana: any = await Lead.findOne({ businessId: bizA._id, phone: '+919800000090' }).lean();
    const sanaEv = events.find((e) => e.name === 'crm/lead-created' && e.data.leadId === String(sana?._id));
    check('W2', 'WhatsApp inbound → lead via the central service (source WhatsApp, owner alert), no auto-reply to the lead from the CRM',
      wr.status === 200 && sana?.source === 'WhatsApp' && sana?.name === 'Sana' && sanaEv?.data.notifyOwner === true && whatsapp.length === 0);
    await waWebhook.POST(form('/api/whatsapp/webhook', { MessageSid: 'SM-2', From: 'whatsapp:+919800000090', To: 'whatsapp:+14155550100', Body: 'Hello again' }));
    check('W3', 'second WhatsApp message from the same number → same lead, no duplicate', (await Lead.countDocuments({ businessId: bizA._id, phone: '+919800000090' })) === 1);


    // ── Import at scale: 200 contacts ───────────────────────────────────
    asA();
    const evBefore = events.length;
    const waBefore = whatsapp.length;
    const contacts = Array.from({ length: 200 }, (_, i) => ({ name: `Contact ${i}`, phone: `+9197${String(10000000 + i).padStart(8, '0')}` }));
    const t200 = Date.now();
    r = await json(await bulkImport.POST(req('/api/leads/bulk-import', 'POST', { leads: contacts })));
    const ms200 = Date.now() - t200;
    const newEv = events.slice(evBefore);
    const imported: any[] = await Lead.find({ businessId: bizA._id, source: 'Contacts Import', name: /^Contact \d+$/ }).lean();
    check('I1', '200 contacts → 200 leads (source Contacts Import, this business, Open stage), 0 owner alerts, 0 WhatsApp, 0 Day-1/3/7 events, 0 rescore events',
      r.body.created === 200 && imported.length === 200 && imported.every((l) => String(l.businessId) === String(bizA._id) && l.lifeCycleStage === 'initial') &&
      newEv.filter((e) => e.name === 'crm/lead-created').length === 200 && newEv.every((e) => e.name !== 'crm/lead-created' || e.data.notifyOwner === false) &&
      !newEv.some((e) => e.name === 'crm/dispatch-whatsapp' || e.name === 'crm/lead-rescore') && whatsapp.length === waBefore, `${ms200} ms`);
    r = await json(await bulkImport.POST(req('/api/leads/bulk-import', 'POST', { leads: contacts.slice(0, 50).map((c) => ({ ...c, phone: c.phone.replace('+91', '0') })) })));
    check('I2', 're-importing 50 of them in another format → all skipped (batch dedupe index)', r.body.created === 0 && r.body.skipped === 50);

    // ── Security: more direct-ID manipulation ───────────────────────────
    const bLead: any = (await createOrUpdateCustomerLead({ businessId: String(bizB._id), organizationId: String(orgB), name: 'B Lead', phone: '+919800000400', source: 'Manual', skipAutomation: true })).lead;
    await recordCallEvent(bizA, twilioAdapter.normalize({ CallSid: 'CA-sec', From: '+919800000401', To: '+14155550100', Direction: 'inbound', CallStatus: 'ringing' })!);
    const secCall: any = await CallEvent.findOne({ callId: 'CA-sec' }).lean();
    const sec2: string[] = [];
    asA();
    if ((await callRoute.POST(req(`/api/crm/calls/${secCall._id}`, 'POST', { action: 'link', leadId: String(bLead._id) }), params(String(secCall._id)))).status !== 404) sec2.push('A-links-call-to-B-lead');
    if ((await followups.POST(req('/api/followups', 'POST', { leadId: String(bLead._id), dueAt: new Date().toISOString() }))).status !== 404) sec2.push('A-task-on-B-lead');
    if ((await leadRoute.PATCH(req(`/api/crm/leads/${bLead._id}`, 'PATCH', { lifeCycleStage: 'converted', deal: { value: 1, currency: 'INR' } }) as any, params(String(bLead._id)))).status !== 404) sec2.push('A-wins-B-lead');
    asB();
    const bAppts = await (await appointments.GET(req('/api/appointments') as any)).json();
    if (bAppts.some((x: any) => String(x.businessId) === String(bizA._id))) sec2.push('B-sees-A-appointments');
    if ((await callRoute.POST(req(`/api/crm/calls/${secCall._id}`, 'POST', { action: 'dismiss' }), params(String(secCall._id)))).status !== 404) sec2.push('B-dismisses-A-call');
    if ((await json(await followups.GET(req(`/api/followups?leadId=${meera._id}`)))).body.followUps.length !== 0) sec2.push('B-lists-A-tasks-by-id');
    const aStagesBefore = JSON.stringify((await Business.findById(bizA._id).select('leadStages').lean() as any).leadStages);
    await stagesRoute.PATCH(req('/api/business/lead-stages', 'PATCH', { leadStages: { initialLabel: 'B Open', active: [], converted: [], closed: [] } }) as any);
    if (JSON.stringify((await Business.findById(bizA._id).select('leadStages').lean() as any).leadStages) !== aStagesBefore) sec2.push('B-changes-A-stages');
    const roiB2 = (await json(await roiRoute.GET(req('/api/crm/roi?days=365')))).body.roi;
    if (roiB2.wonRevenue !== 0 || roiB2.phone.callsReceived !== 0) sec2.push('B-sees-A-revenue-or-calls');
    asA();
    check('S2', 'direct ID manipulation blocked both ways: calls, tasks, Won/deal, appointments, stages, ROI/phone stats', sec2.length === 0, sec2.join(', ') || 'all blocked');

    // ── The real background jobs, executed ──────────────────────────────
    const fns: any = await import('../src/services/inngest/functions');
    const stepLog: string[] = [];
    const step = {
      run: async (name: string, fn: () => any) => { stepLog.push(`run:${name}`); return fn(); },
      sleep: async (name: string) => { stepLog.push(`sleep:${name}`); },
      sleepUntil: async (name: string) => { stepLog.push(`sleep:${name}`); },
      sendEvent: async (name: string, e: any) => { stepLog.push(`send:${name}`); for (const x of Array.isArray(e) ? e : [e]) events.push(x); },
      waitForEvent: async () => null,
    };
    const jobLead: any = (await createOrUpdateCustomerLead({ businessId: String(bizA._id), organizationId: String(orgA), name: 'Job Lead', phone: '+919800000600', source: 'WhatsApp', skipAutomation: true })).lead;
    const waJobBefore = whatsapp.length;
    await fns.scheduleLeadFollowUpsJob.handler({ event: { name: 'crm/lead-created', data: { leadId: String(jobLead._id), businessId: String(bizA._id), notifyOwner: true } }, step });
    const jobAfter: any = await Lead.findById(jobLead._id).lean();
    const toLead = whatsapp.slice(waJobBefore).filter((w) => w.phone.replace(/\D/g, '').endsWith('9800000600'));
    check('J1', 'new-lead job (real code): owner alert step only — no AI scoring step, no sleeps, no Day 1/3/7 dispatch, nothing sent to the lead, no score written',
      stepLog.join(' ') === 'run:owner-whatsapp-new-lead' && toLead.length === 0 && !events.some((e) => e.name === 'crm/dispatch-whatsapp') && jobAfter.aiLeadScore == null && jobAfter.aiInsights == null,
      stepLog.join(' '));
    // Run the real new-lead job for EVERY lead created in this run (Add Lead,
    // quick-add, CSV, contacts, campaign, appointment, WhatsApp, saved call…).
    const createdEvents = events.filter((e) => e.name === 'crm/lead-created');
    const aiBeforeJobs = aiCalls.length;
    for (const e of createdEvents) await fns.scheduleLeadFollowUpsJob.handler({ event: e, step });
    const createdBySource: Record<string, number> = {};
    for (const l of await Lead.find({ _id: { $in: createdEvents.map((e) => e.data.leadId) } }).select('source').lean() as any[]) createdBySource[l.source] = (createdBySource[l.source] ?? 0) + 1;
    const sourcesNeeded = ['Manual', 'CSV Import', 'Contacts Import', 'Campaign Import', 'Appointment', 'WhatsApp', 'Phone Call'];
    check('AI0', 'every creation path (Add Lead, quick-add, CSV, contacts, campaign, appointment, WhatsApp, saved Twilio call) → new-lead job ran with 0 AI calls; no score on any lead',
      aiCalls.length === aiBeforeJobs && sourcesNeeded.every((x) => createdBySource[x] > 0) &&
      (await Lead.countDocuments({ businessId: { $ne: null }, tenantId: { $ne: 'gmbboost-internal' }, $or: [{ aiLeadScore: { $ne: null } }, { aiInsights: { $ne: null } }] })) === 0,
      `${createdEvents.length} jobs · ${JSON.stringify(createdBySource)}`);
    check('AI1', 'no Customer CRM rescore job or event exists', !('crmLeadRescoreJob' in fns) && !events.some((e) => e.name === 'crm/lead-rescore'));
    const waLegacy = whatsapp.length;
    const legacyRes = await fns.dispatchWhatsappFollowUpJob.handler({ event: { name: 'crm/dispatch-whatsapp', data: { leadId: String(jobLead._id), businessId: String(bizA._id), templateType: 'Day 3 Follow-Up' } }, step });
    const legacyCust: any = await Lead.create({ tenantId: String(orgA), name: 'Legacy no-business lead', phone: '+919800000601', source: 'Manual' });
    const old1 = await fns.processFollowUpJob.handler({ event: { name: 'scheduler/follow-up', data: { leadId: String(jobLead._id), reminderType: '24h Reminder' } }, step });
    const old2 = await fns.processFollowUpJob.handler({ event: { name: 'scheduler/follow-up', data: { leadId: String(legacyCust._id), reminderType: '24h Reminder' } }, step });
    check('J2', 'already-queued Day 1/3/7 events and the legacy follow-up sender cannot message a customer lead (incl. legacy leads without a business)',
      legacyRes?.sent === 0 && legacyRes?.skipped === true && old1?.skipped === true && old2?.skipped === true && whatsapp.length === waLegacy,
      `${JSON.stringify(legacyRes)} · ${old1?.reason} · ${old2?.reason}`);


    // ── Overdue follow-up reminders (deterministic, no AI) ──────────────
    const orgC = new mongoose.Types.ObjectId();
    const bizC: any = await Business.create({ name: 'Rahul Tours', category: 'Travel agency', address: 'Nashik', organizationId: orgC, userId: new mongoose.Types.ObjectId() });
    const mk = async (name: string, phone: string, daysAgo: number, extra: Record<string, unknown> = {}) => {
      const l: any = (await createOrUpdateCustomerLead({ businessId: String(bizC._id), organizationId: String(orgC), name, phone, source: 'Manual', skipAutomation: true })).lead;
      const when = new Date(Date.now() - daysAgo * 86_400_000);
      await Lead.collection.updateOne({ _id: l._id }, { $set: { createdAt: when, lastContactedAt: when, ...extra } });
      return l;
    };
    const rahul = await mk('Rahul Sharma', '+919800000700', 5.2);
    const recent = await mk('Recent Contact', '+919800000701', 2);
    const tasked = await mk('Has Task', '+919800000702', 9);
    await FollowUp.create({ tenantId: String(orgC), businessId: bizC._id, leadId: tasked._id, kind: 'task', type: 'Call', scheduledFor: new Date(Date.now() + 86_400_000), status: 'pending' });
    const wonC = await mk('Won Lead', '+919800000703', 9, { lifeCycleStage: 'converted' });
    const nB0 = notifications.length; const pB0 = pushes.length; const waC = whatsapp.length; const aiC = aiCalls.length;
    const s1 = await sendStaleLeadReminders(new Date());
    const nC = notifications.slice(nB0).filter((n) => n.businessId === String(bizC._id));
    const pC = pushes.slice(pB0).filter((p) => p.businessId === String(bizC._id));
    const rahulAfter: any = await Lead.findById(rahul._id).lean();
    const otherBizOverdue = notifications.slice(nB0).filter((n) => n.type === 'crm_follow_up_overdue' && n.businessId !== String(bizC._id)).length;
    const skippedOk = !((await Lead.findById(recent._id).lean()) as any).followUpNudgedAt && !((await Lead.findById(tasked._id).lean()) as any).followUpNudgedAt && !((await Lead.findById(wonC._id).lean()) as any).followUpNudgedAt;
    check('O1', `lead with no contact for ${STALE_LEAD_DAYS}+ days → ONE owner in-app + push reminder ("You haven't followed up with Rahul Sharma for 5 days", opens the lead); recent / tasked / Won leads skipped; no AI, nothing to the lead`,
      nC.length === 1 && nC[0].type === 'crm_follow_up_overdue' && pC.length === 1 && pC[0].data?.crmLeadId === String(rahul._id) &&
      /You haven't followed up with Rahul Sharma for 5 days/.test(nC[0].body ?? '') && !!rahulAfter.followUpNudgedAt &&
      whatsapp.length === waC && aiCalls.length === aiC && s1.leads === 1 && skippedOk,
      `${nC[0]?.body ?? 'none'} · leads ${s1.leads}`);
    const s2 = await sendStaleLeadReminders(new Date());
    check('O2', 'second run → no repeat for the same silent period', s2.leads === 0 && notifications.filter((n) => n.businessId === String(bizC._id)).length === 1);
    // Owner logs a call → new silent period; 6 days later → reminded again.
    ctx = { ok: true, userId: String(new mongoose.Types.ObjectId()), organizationId: String(orgC), businessId: String(bizC._id), business: bizC };
    await activityRoute.POST(req(`/api/crm/leads/${rahul._id}/activity`, 'POST', { type: 'call', content: 'Called; deciding next week' }), params(String(rahul._id)));
    asA();
    const s3 = await sendStaleLeadReminders(new Date(Date.now() + 6 * 86_400_000));
    check('O3', 'after the owner contacts the lead, a NEW silent period triggers a new reminder (several leads → one notification per business)',
      s3.leads >= 1 && notifications.filter((n) => n.businessId === String(bizC._id)).length === 2);
    const platformNudged = (await Lead.findById(platform._id).lean() as any).followUpNudgedAt;
    check('O4', 'workspace isolation: only the business with an overdue lead was notified; Won leads and platform prospects never included (even 6 days later)',
      otherBizOverdue === 0 && !platformNudged && !(await Lead.findById(wonC._id).lean() as any).followUpNudgedAt);


    // ── Overdue reminder: exact lifecycle + exclusions ──────────────────
    const { default: Appointment } = await import('../src/models/Appointment');
    const DAY = 86_400_000;
    const orgD = new mongoose.Types.ObjectId();
    const bizD: any = await Business.create({ name: 'Lifecycle Biz', category: 'Salon', address: 'Pune', organizationId: orgD, userId: new mongoose.Types.ObjectId() });
    const asD = () => { ctx = { ok: true, userId: String(new mongoose.Types.ObjectId()), organizationId: String(orgD), businessId: String(bizD._id), business: bizD }; };
    const forD = (from: number) => notifications.slice(from).filter((n) => n.businessId === String(bizD._id) && n.type === 'crm_follow_up_overdue');
    const pushD = (from: number) => pushes.slice(from).filter((p) => p.businessId === String(bizD._id));
    const setAge = async (id: any, days: number) => Lead.collection.updateOne({ _id: id }, { $set: { createdAt: new Date(Date.now() - days * DAY) } });
    const life: any = (await createOrUpdateCustomerLead({ businessId: String(bizD._id), organizationId: String(orgD), name: 'Priya Patil', phone: '+919800000800', source: 'WhatsApp', skipAutomation: true })).lead;
    let n0 = notifications.length; let p0 = pushes.length;
    await setAge(life._id, 0); await sendStaleLeadReminders(new Date());
    const day0 = forD(n0).length;
    await setAge(life._id, 4.9); await sendStaleLeadReminders(new Date());
    const day49 = forD(n0).length;
    await setAge(life._id, 5.1); await sendStaleLeadReminders(new Date());
    const day51 = forD(n0); const push51 = pushD(p0);
    check('L1', 'Day 0 and day 4.9 → no reminder; after 5 days without contact → exactly one push + one in-app notification for the owner',
      day0 === 0 && day49 === 0 && day51.length === 1 && push51.length === 1 && push51[0].data?.crmLeadId === String(life._id), `${day0}/${day49}/${day51.length}+${push51.length}`);
    n0 = notifications.length;
    await sendStaleLeadReminders(new Date(Date.now() + 1 * DAY));
    await sendStaleLeadReminders(new Date(Date.now() + 2 * DAY));
    check('L2', 'next daily runs (silent lead) → no duplicate', forD(n0).length === 0);
    // Editing is NOT contacting: notes, interest, stage, a note activity.
    asD();
    await leadRoute.PATCH(req(`/api/crm/leads/${life._id}`, 'PATCH', { notes: 'Wants bridal package', interest: 'Bridal' }) as any, params(String(life._id)));
    await leadRoute.PATCH(req(`/api/crm/leads/${life._id}`, 'PATCH', { lifeCycleStage: 'active', subStageId: 'active-interested' }) as any, params(String(life._id)));
    await activityRoute.POST(req(`/api/crm/leads/${life._id}/activity`, 'POST', { type: 'note', content: 'Internal note' }), params(String(life._id)));
    const afterEdits: any = await Lead.findById(life._id).lean();
    n0 = notifications.length;
    await sendStaleLeadReminders(new Date(Date.now() + 1 * DAY));
    check('L3', 'editing the lead (notes / interest / stage) or adding a NOTE is not contact → quiet period not reset, no new reminder',
      afterEdits.lastContactedAt == null && forD(n0).length === 0);
    // Real contact: a logged call → quiet period resets.
    await activityRoute.POST(req(`/api/crm/leads/${life._id}/activity`, 'POST', { type: 'call', content: 'Called, sending quote' }), params(String(life._id)));
    asA();
    const contacted: any = await Lead.findById(life._id).lean();
    n0 = notifications.length; p0 = pushes.length;
    await sendStaleLeadReminders(new Date(Date.now() + 4.9 * DAY));
    const before5 = forD(n0).length;
    await sendStaleLeadReminders(new Date(Date.now() + 5.1 * DAY));
    check('L4', 'owner logs a call → quiet period resets: nothing 4.9 days later, a NEW reminder 5+ days after the new last contact',
      !!contacted.lastContactedAt && before5 === 0 && forD(n0).length === 1 && pushD(p0).some((p) => p.data?.crmLeadId === String(life._id)));
    // Other contact events also reset it: completing a task, a known caller, an inbound WhatsApp.
    check('L5', 'only a logged call/WhatsApp/email/meeting resets contact (a note does not); the lead edit route never sets lastContactedAt',
      /if \(type !== 'note'\) lead\.lastContactedAt/.test(fs.readFileSync(path.resolve('src/app/api/crm/leads/[id]/activity/route.ts'), 'utf8')) &&
      !/lastContactedAt/.test(fs.readFileSync(path.resolve('src/app/api/crm/leads/[id]/route.ts'), 'utf8')));

    // Exclusions: none of these may trigger a reminder for bizF.
    const orgF = new mongoose.Types.ObjectId();
    const bizF: any = await Business.create({ name: 'Exclusions Biz', category: 'Gym', address: 'Pune', organizationId: orgF, userId: new mongoose.Types.ObjectId() });
    const mkF = async (name: string, phone: string, extra: Record<string, unknown> = {}) => {
      const l: any = (await createOrUpdateCustomerLead({ businessId: String(bizF._id), organizationId: String(orgF), name, phone, source: 'Manual', skipAutomation: true })).lead;
      await Lead.collection.updateOne({ _id: l._id }, { $set: { createdAt: new Date(Date.now() - 9 * DAY), ...extra } });
      return l;
    };
    await mkF('Won', '+919800000810', { lifeCycleStage: 'converted', deal: { value: 5000, currency: 'INR' } });
    await mkF('Lost', '+919800000811', { lifeCycleStage: 'closed' });
    const tf = await mkF('Task pending', '+919800000812');
    await FollowUp.create({ tenantId: String(orgF), businessId: bizF._id, leadId: tf._id, kind: 'task', type: 'Call', scheduledFor: new Date(Date.now() + DAY), status: 'pending' });
    const ap = await mkF('Appointment booked', '+919800000813');
    await Appointment.create({ leadId: ap._id, businessId: bizF._id, tenantId: String(orgF), date: '2026-12-01', status: 'Scheduled' });
    await mkF('Inactive', '+919800000814', { status: 'inactive' });
    await Lead.collection.insertOne({ tenantId: 'gmbboost-internal', businessId: bizF._id, leadType: 'Platform Prospect', name: 'Platform lead', phone: '+919800000815', lifeCycleStage: 'initial', status: 'active', createdAt: new Date(Date.now() - 9 * DAY), updatedAt: new Date() });
    // Another workspace with an overdue lead: it gets its OWN reminder; bizF none.
    const orgG = new mongoose.Types.ObjectId();
    const bizG: any = await Business.create({ name: 'Other Workspace', category: 'Gym', address: 'Pune', organizationId: orgG, userId: new mongoose.Types.ObjectId() });
    const g: any = (await createOrUpdateCustomerLead({ businessId: String(bizG._id), organizationId: String(orgG), name: 'G lead', phone: '+919800000816', source: 'Manual', skipAutomation: true })).lead;
    await Lead.collection.updateOne({ _id: g._id }, { $set: { createdAt: new Date(Date.now() - 9 * DAY) } });
    const nF = notifications.length; const pF = pushes.length;
    await sendStaleLeadReminders(new Date());
    const fNotes = notifications.slice(nF).filter((n) => n.businessId === String(bizF._id)).length;
    const gPush = pushes.slice(pF).filter((p) => p.businessId === String(bizG._id));
    check('L6', 'no reminder for Won, Lost, pending-task, booked-appointment, inactive or platform leads; another workspace\'s overdue lead notifies only that workspace',
      fNotes === 0 && pushes.slice(pF).filter((p) => p.businessId === String(bizF._id)).length === 0 && gPush.length === 1 && gPush[0].data?.crmLeadId === String(g._id),
      `bizF ${fNotes} · bizG ${gPush.length}`);

    // Deal value only on Won.
    asA();
    const act: any = (await createOrUpdateCustomerLead({ businessId: String(bizA._id), organizationId: String(orgA), name: 'Active deal try', phone: '+919800000820', source: 'Manual', skipAutomation: true })).lead;
    const dr = await json(await leadRoute.PATCH(req(`/api/crm/leads/${act._id}`, 'PATCH', { deal: { value: 9999, currency: 'INR' } }) as any, params(String(act._id))));
    const actAfter: any = await Lead.findById(act._id).lean();
    check('D14', 'a deal value cannot be recorded on a lead that is not Won (400), so nothing pre-Won can become revenue',
      dr.status === 400 && dr.body.code === 'INVALID_DEAL' && actAfter.deal == null);
    const listed2 = (await json(await leadsRoute.GET(req('/api/crm/leads')))).body.leads;
    check('D15', 'Customer CRM leads API never returns the shared AI-score fields', listed2.length > 0 && listed2.every((l: any) => !('aiLeadScore' in l) && !('aiInsights' in l) && !('qualificationStatus' in l) && !('urgency' in l)));


    // ── Monthly Growth Report ───────────────────────────────────────────
    const growthRoute = await import('../src/app/api/crm/growth-report/route');
    const { resolveReportMonth } = await import('../src/services/crm/growthReport');
    const { computeRoiFigures } = await import('../src/services/crm/roi');
    const { sendGrowthReportReadyNotifications } = await import('../src/services/crm/growthReportData');
    const runNow = new Date();
    const rm = resolveReportMonth(null, runNow, 'Asia/Kolkata')!;
    const inMonth = (dayOffsetHours: number) => new Date(rm.period.from.getTime() + dayOffsetHours * 3_600_000);
    const inPrev = (h: number) => new Date(rm.previous.from.getTime() + h * 3_600_000);
    const orgH = new mongoose.Types.ObjectId();
    const ownerH = new mongoose.Types.ObjectId();
    const bizH: any = await Business.create({ name: 'Growth Biz', category: 'Clinic', address: 'Pune', organizationId: orgH, userId: ownerH, crmInvestment: { monthlyAmount: 10000, currency: 'INR', updatedAt: new Date() } });
    const mkH = async (biz: any, org: any, name: string, phone: string, source: string, createdAt: Date, extra: Record<string, unknown> = {}) => {
      const l: any = (await createOrUpdateCustomerLead({ businessId: String(biz._id), organizationId: String(org), name, phone, source, skipAutomation: true })).lead;
      await Lead.collection.updateOne({ _id: l._id }, { $set: { createdAt, ...extra } });
      return l;
    };
    const hA = await mkH(bizH, orgH, 'GA', '+919800000900', 'WhatsApp', inMonth(30), { lifeCycleStage: 'converted', convertedAt: inMonth(60), deal: { value: 20000, currency: 'INR', closedAt: inMonth(60) } });
    await mkH(bizH, orgH, 'GB', '+919800000901', 'WhatsApp', inMonth(40));
    await mkH(bizH, orgH, 'GC', '+919800000902', 'Phone Call', inMonth(50), { lifeCycleStage: 'converted', convertedAt: inMonth(70), deal: { value: 5000, currency: 'INR', closedAt: inMonth(70) } });
    await mkH(bizH, orgH, 'GPrev', '+919800000903', 'Manual', inPrev(30));
    await FollowUp.create({ tenantId: String(orgH), businessId: bizH._id, leadId: hA._id, kind: 'task', type: 'Call', scheduledFor: inMonth(80), status: 'completed', completedAt: inMonth(81) });
    await FollowUp.create({ tenantId: String(orgH), businessId: bizH._id, leadId: hA._id, kind: 'task', type: 'Call', scheduledFor: inMonth(90), status: 'pending' });
    await CallEvent.create({ businessId: bizH._id, provider: 'twilio', callId: 'CA-gr1', direction: 'inbound', phone: '+919800000902', outcome: 'ended', startedAt: inMonth(45), leadState: 'saved', handledAt: inMonth(46) });
    await CallEvent.create({ businessId: bizH._id, provider: 'twilio', callId: 'CA-gr2', direction: 'inbound', phone: '+919800000900', outcome: 'ended', startedAt: inMonth(55), leadState: 'existing_lead' });
    // Business I: same month, big revenue — must never appear in H's report.
    const orgI = new mongoose.Types.ObjectId();
    const bizI: any = await Business.create({ name: 'Other Biz', category: 'Gym', address: 'Pune', organizationId: orgI, userId: new mongoose.Types.ObjectId() });
    await mkH(bizI, orgI, 'IA', '+919800000910', 'WhatsApp', inMonth(30), { lifeCycleStage: 'converted', convertedAt: inMonth(31), deal: { value: 99999, currency: 'INR', closedAt: inMonth(31) } });
    await FollowUp.create({ tenantId: String(orgI), businessId: bizI._id, leadId: hA._id, kind: 'task', type: 'Call', scheduledFor: inMonth(80), status: 'pending' });
    await CallEvent.create({ businessId: bizI._id, provider: 'twilio', callId: 'CA-gr3', direction: 'inbound', phone: '+919800000911', outcome: 'missed', startedAt: inMonth(45), leadState: 'pending' });

    const asH = () => { ctx = { ok: true, userId: String(ownerH), organizationId: String(orgH), businessId: String(bizH._id), business: bizH }; };
    const asI = () => { ctx = { ok: true, userId: String(new mongoose.Types.ObjectId()), organizationId: String(orgI), businessId: String(bizI._id), business: bizI }; };
    asH();
    const gr = await json(await growthRoute.GET(req(`/api/crm/growth-report?businessId=${bizI._id}`)));
    const R = gr.body.report;
    const expRoi = computeRoiFigures(25000, 10000, rm.period.days);
    check('GR1', 'report (default = latest completed month): leads, Won, conversion, recorded revenue, sources, follow-ups, calls, ROI — all from CRM records',
      gr.status === 200 && R.period.key === rm.period.key && R.period.complete === true &&
      R.metrics.leadsReceived === 3 && R.metrics.won === 2 && R.metrics.revenue === 25000 && R.metrics.conversionRate === 66.7 &&
      JSON.stringify(R.metrics.sources.map((x: any) => [x.source, x.leads, x.won, x.revenue])) === JSON.stringify([['WhatsApp', 2, 1, 20000], ['Phone Call', 1, 1, 5000]]) &&
      R.metrics.followUps.due === 2 && R.metrics.followUps.completed === 1 && R.metrics.followUps.missed === 1 && R.metrics.followUps.completionRate === 50 &&
      R.metrics.calls.measured === true && R.metrics.calls.received === 2 && R.metrics.calls.savedAsLeads === 1 && R.metrics.calls.knownCallers === 1 && R.metrics.calls.revenueFromCalls === 5000 &&
      R.roi.roiPercent === expRoi.roiPercent && R.roi.investment === expRoi.investmentAmount &&
      R.comparison.available === true && R.comparison.leads.percentChange === 200 && R.business.name === 'Growth Biz',
      `${R?.period?.label} · leads ${R?.metrics?.leadsReceived} · won ${R?.metrics?.won} · ${R?.metrics?.revenue} · roi ${R?.roi?.roiPercent}%`);
    check('GR2', 'workspace isolation: a businessId in the URL is ignored; Business B\'s revenue/calls/tasks never appear in A\'s report and vice versa',
      !JSON.stringify(R).includes('99999') && R.metrics.calls.awaitingDecision === 0 && R.business.name === 'Growth Biz' &&
      await (async () => {
        asI();
        const ri = (await json(await growthRoute.GET(req('/api/crm/growth-report')))).body.report;
        asH();
        return ri.business.name === 'Other Biz' && ri.metrics.revenue === 99999 && ri.metrics.leadsReceived === 1 && ri.metrics.followUps.due === 1 && ri.metrics.calls.received === 1 && !JSON.stringify(ri).includes('25000');
      })());
    const bad1 = await growthRoute.GET(req('/api/crm/growth-report?month=2099-01'));
    const bad2 = await growthRoute.GET(req('/api/crm/growth-report?month=nonsense'));
    const mtd = (await json(await growthRoute.GET(req('/api/crm/growth-report?month=current')))).body.report;
    check('GR3', 'future / malformed month → 400; current month = month to date (not presented as complete)',
      bad1.status === 400 && bad2.status === 400 && mtd.period.complete === false && /month to date/.test(mtd.period.label));
    // Mobile: the app's own endpoint module, reading the same route.
    mobileGet = async (url: string, cfg?: any) => {
      const qs = new URLSearchParams(cfg?.params ?? {}).toString();
      return { data: (await json(await growthRoute.GET(req(`${url}${qs ? `?${qs}` : ''}`)))).body };
    };
    const mobileCrm: any = await import('../mobile/src/api/endpoints/crm');
    const mobileReport = await mobileCrm.fetchGrowthReport(null);
    const mobileMonth = await mobileCrm.fetchGrowthReport(rm.previous.key);
    const webPrev = (await json(await growthRoute.GET(req(`/api/crm/growth-report?month=${rm.previous.key}`)))).body.report;
    // Key order differs after the mobile schema parse — compare values, key-sorted.
    const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
    const same = (a: any, b: any) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
    const grDiff = ['metrics', 'roi', 'comparison', 'pipeline', 'attention', 'summary', 'highlights'].filter((k) => !same(mobileReport[k], R[k]));
    check('GR4', 'web and mobile read the SAME endpoint and show identical numbers (mobile parser over the real route, default + selected month)',
      mobileUrls.every((u) => u === '/api/crm/growth-report') && mobileUrls.length === 2 && grDiff.length === 0 &&
      mobileMonth.period.key === rm.previous.key && same(mobileMonth.metrics, webPrev.metrics),
      grDiff.length ? `differs: ${grDiff.join(', ')}` : `${mobileUrls.length} mobile calls, identical`);

    // "Report ready" notification — once per business per month, in-app + push, never WhatsApp.
    const orgQ = new mongoose.Types.ObjectId();
    const bizQ: any = await Business.create({ name: 'Quiet Biz', category: 'Gym', address: 'Pune', organizationId: orgQ, userId: new mongoose.Types.ObjectId() });
    await createOrUpdateCustomerLead({ businessId: String(bizQ._id), organizationId: String(orgQ), name: 'This month only', phone: '+919800000920', source: 'Manual', skipAutomation: true });
    const nG = notifications.length; const pG = pushes.length; const waG = whatsapp.length; const aiG = aiCalls.length;
    const g1 = await sendGrowthReportReadyNotifications(runNow);
    const g2 = await sendGrowthReportReadyNotifications(new Date(runNow.getTime() + 86_400_000));
    const hNotes = notifications.slice(nG).filter((n) => n.businessId === String(bizH._id));
    const hPush = pushes.slice(pG).filter((x) => x.businessId === String(bizH._id));
    const iNotes = notifications.slice(nG).filter((n) => n.businessId === String(bizI._id));
    const monthName = rm.period.label.split(' ')[0];
    check('GR5', `"Your ${monthName} Growth Report is ready": one in-app + one push per business per month (re-run → none), push deep-links the month, no WhatsApp, no AI`,
      hNotes.length === 1 && hNotes[0].type === 'crm_growth_report_ready' && hNotes[0].title === `Your ${monthName} Growth Report is ready` &&
      hNotes[0].link === `/dashboard/crm/growth-report?month=${rm.period.key}` && hPush.length === 1 && hPush[0].data?.growthReportMonth === rm.period.key &&
      iNotes.length === 1 && g2.notified === 0 && whatsapp.length === waG && aiCalls.length === aiG &&
      (await Business.findById(bizH._id).lean() as any).crmGrowthReportNotifiedFor === rm.period.key,
      `run1 ${JSON.stringify(g1)} · run2 ${JSON.stringify(g2)}`);
    const quietNotified = notifications.slice(nG).filter((n) => n.businessId === String(bizQ._id) && n.type === 'crm_growth_report_ready').length;
    check('GR6', 'a business with no CRM activity in that month gets no "report ready" notification', quietNotified === 0);
    asA();

    // ── Global guarantees ───────────────────────────────────────────────
    check('G1', 'no WhatsApp was sent to any lead in the whole run', whatsapp.length === 0, `${whatsapp.length} sends`);
    check('G2', 'no Day 1/3/7 dispatch events were queued', !events.some((e) => e.name === 'crm/dispatch-whatsapp'));
    check('G3', 'super-admin platform prospect untouched', JSON.stringify(await Lead.findById(platform._id).lean()) === platformBefore);
    // Prove the interceptor is live (G4 must not pass vacuously): a deliberate Groq call is counted.
    const callsInRun = aiCalls.length;
    const G: any = await import('groq-sdk' as string);
    await new (G.Groq ?? G.default)({ apiKey: 'test' }).chat.completions.create({ model: 'x', messages: [] });
    const detected = aiCalls.length === callsInRun + 1;
    check('G4', 'ZERO AI calls in the whole Customer CRM run (Groq SDK + LLM hosts intercepted; interceptor verified live)', callsInRun === 0 && detected, `${callsInRun} calls · interceptor ${detected ? 'live' : 'NOT live'}`);
  } finally {
    await mem.stop({ doCleanup: true, force: true }).catch(() => {});
  }
  const failed = results.filter((x) => !x.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.t).join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
