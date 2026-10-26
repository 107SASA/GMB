/**
 * Conversion Overview, Conversion Analytics, Leads & Pipeline and Lead detail
 * through the REAL routes against an in-memory MongoDB. The core guarantee:
 * every Conversion Overview number equals the total of the Leads & Pipeline
 * list it links to (same segment definitions, same date window).
 *
 * Run: npx tsx --test tests/workflow/admin-conversion.test.ts
 */
import { signInAsSuperAdmin, startMemoryDb, stopMemoryDb, jsonReq } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let skipReason: string | null = null;
let m: any = {};
const DAY = 86_400_000;
const T = 'gmbboost-internal';

before(async () => {
  skipReason = await startMemoryDb('admin_conversion');
  if (skipReason) return;
  m = {
    mongoose: (await import('mongoose')).default,
    ms: await import('../../src/lib/admin/leadMilestones'),
    overview: await import('../../src/app/api/admin/conversion/overview/route'),
    analytics: await import('../../src/app/api/admin/conversion/analytics/route'),
    pipeline: await import('../../src/app/api/admin/conversion/pipeline/route'),
    detail: await import('../../src/app/api/admin/conversion/leads/[id]/route'),
    returnToAi: await import('../../src/app/api/admin/leads/return-to-ai/route'),
    Lead: (await import('../../src/models/Lead')).default,
    LeadEvent: (await import('../../src/models/LeadEvent')).default,
    DemoBooking: (await import('../../src/models/DemoBooking')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    SalesConversation: (await import('../../src/models/SalesConversation')).default,
    BookingConversation: (await import('../../src/models/BookingConversation')).default,
  };
  await signInAsSuperAdmin('conv-admin@example.invalid');
  await seed();
});
after(stopMemoryDb);

let seq = 0;
const phone = () => `+9197000${String(++seq).padStart(5, '0')}`;
const L: Record<string, any> = {};

async function lead(key: string, over: Record<string, unknown> = {}, createdAt?: Date) {
  const doc: any = await m.Lead.create({ tenantId: T, name: `Lead ${key}`, phone: phone(), leadType: 'Platform Prospect', ...over } as any);
  if (createdAt) await m.Lead.collection.updateOne({ _id: doc._id }, { $set: { createdAt } });
  L[key] = doc;
  return doc;
}
const event = (l: any, type: string, payload: any = {}, extra: Record<string, unknown> = {}) =>
  m.LeadEvent.create({ leadId: l._id, phone: l.phone, type, payload, actor: 'test', ...extra });
const booking = (l: any, status: string) =>
  m.DemoBooking.create({ leadId: l._id, name: l.name, phone: l.phone, date: '2026-10-20', timeSlot: '11:00', status } as any);

async function seed() {
  await lead('fresh'); // New
  await lead('scored', { leadScore: 30 }); // qualified by score (≥ 26)
  await lead('lowScore', { leadScore: 20 }); // NOT qualified (old funnel counted ≥ 15)
  await lead('nurturing', { currentAgent: 'SALES', currentStage: 'NURTURING' });
  // Booked a demo, attended, then paid — now a customer. Must still count as demo scheduled/completed.
  const paid = await lead('demoThenPaid', { currentAgent: 'IN_HOUSE', currentStage: 'CUSTOMER' });
  await booking(paid, 'Completed');
  await event(paid, 'DEMO_SCHEDULED');
  await event(paid, 'PAYMENT_SUCCESS');
  // Intent was DEMO_INTEREST, later reset — history keeps the milestone.
  const was = await lead('wasDemoInterest', { intent: 'EXPLORING', currentAgent: 'SALES', currentStage: 'QUALIFYING' });
  await event(was, 'INTENT_CHANGED', { from: 'EXPLORING', to: 'DEMO_INTEREST' });
  await lead('demoNow', { currentStage: 'DEMO_SCHEDULED', currentAgent: 'DEMO' });
  const noShow = await lead('noShow', { currentStage: 'NURTURING', currentAgent: 'SALES' });
  await booking(noShow, 'No Show');
  await lead('buyer', { intent: 'READY_TO_BUY' }); // purchase without any demo
  await lead('pending', { currentStage: 'CONVERSION_PENDING' });
  const human = await lead('human', { currentAgent: 'HUMAN', humanHandoff: { active: true, reason: 'asked for a person', since: new Date() } });
  await event(human, 'HUMAN_HANDOFF');
  await lead('optedOut', { nurtureStatus: 'OPTED_OUT' });
  await lead('lost', { currentStage: 'LOST' });
  await lead('old', { leadScore: 40 }, new Date(Date.now() - 200 * DAY)); // outside 90d
  // A customer TENANT's lead and events on the same phone as 'fresh' — never counted.
  await m.Lead.create({ tenantId: 'some-customer', name: 'Tenant lead', phone: L.fresh.phone, currentStage: 'CUSTOMER' } as any);
  await m.LeadEvent.create({ phone: L.fresh.phone, type: 'PAYMENT_SUCCESS', conversationType: 'tenant', actor: 'tenant' });
}

const getJson = async (route: any, url: string) => (await route.GET(new Request(url))).json();
const overview = (range = 'all') => getJson(m.overview, `https://x.invalid/api/admin/conversion/overview?range=${range}`);
const pipeline = (qs: string) => getJson(m.pipeline, `https://x.invalid/api/admin/conversion/pipeline?${qs}`);

test('pure: milestones are historical and imply only what they logically require', (t) => {
  if (skipReason) return t.skip(skipReason);
  const r = m.ms.reachedMilestones({ currentAgent: 'IN_HOUSE', currentStage: 'CUSTOMER' }, [{ type: 'DEMO_SCHEDULED' }], [{ status: 'Completed' }]);
  for (const k of ['customer', 'paymentVerified', 'purchaseIntent', 'demoCompleted', 'demoScheduled', 'demoInterest', 'qualified']) assert.ok(r.has(k), k);
  const buyer = m.ms.reachedMilestones({ intent: 'READY_TO_BUY' });
  assert.ok(buyer.has('purchaseIntent') && !buyer.has('demoScheduled'), 'buying does not invent a demo');
  assert.ok(!m.ms.reachedMilestones({ leadScore: 25 }).has('qualified'));
  assert.ok(m.ms.reachedMilestones({ leadScore: 26 }).has('qualified'));
  assert.equal(m.ms.currentFunnelStage({ leadScore: 20 }), 'New', 'table and funnel share one threshold');
  assert.equal(m.ms.currentFunnelStage({ leadScore: 26 }), 'Qualified');
  assert.equal(m.ms.phoneSearchDigits('094233 07980'), '9423307980');
  assert.equal(m.ms.phoneSearchDigits('+91 94233 07980'), '9423307980');
  assert.equal(m.ms.phoneSearchDigits('Ravi'), null);
});

test('overview: counts follow history and ignore other tenants', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ov = await overview('all');
  assert.equal(ov.success, true);
  assert.equal(ov.range.label, 'All leads (all time)');
  const k = ov.kpis;
  assert.equal(k.totalLeads, 14, 'platform leads only — the tenant lead on a shared phone is excluded');
  assert.equal(k.demoInterested, 4, 'incl. a lead whose demo intent was later reset');
  assert.equal(k.demoScheduledLeads, 3, 'incl. the lead that went on to pay');
  assert.equal(k.demoCompletedLeads, 1);
  assert.equal(k.purchaseIntent, 3, 'incl. a buyer who never had a demo');
  assert.equal(k.convertedCustomers, 1, "the tenant's PAYMENT_SUCCESS on 'fresh' is not counted");
  assert.equal(k.activeSalesLeads, 3);
  assert.equal(k.withHuman, 1);
  assert.equal(k.optedOutOrLost, 2);
  assert.equal(k.pendingPayments, 1);
  const funnel = Object.fromEntries(ov.funnel.map((f: any) => [f.key, f.count]));
  assert.deepEqual(funnel, { leads: 14, qualified: 9, demoInterest: 4, demoScheduled: 3, demoCompleted: 1, purchaseIntent: 3, paymentVerified: 1, customer: 1 });
  assert.equal(ov.bookings.total, 2, 'bookings counted separately from leads');
  assert.equal(ov.bookings.noShow, 1);
  assert.equal(ov.conversion.noShowRate.value, 50);
  assert.equal(ov.conversion.leadToCustomer.den, 14);
});

test('every Conversion Overview number equals the total of the list it links to', async (t) => {
  if (skipReason) return t.skip(skipReason);
  for (const range of ['all', '90d']) {
    const ov = await overview(range);
    const pairs: Array<[string, number]> = [
      ...ov.funnel.filter((f: any) => f.key !== 'leads').map((f: any) => [f.key, f.count] as [string, number]),
      ['activeSales', ov.kpis.activeSalesLeads],
      ['withHuman', ov.kpis.withHuman],
      ['optedOutOrLost', ov.kpis.optedOutOrLost],
      ['pendingPayment', ov.kpis.pendingPayments],
    ];
    for (const [segment, count] of pairs) {
      const list = await pipeline(`segment=${segment}&range=${range}`);
      assert.equal(list.pagination.total, count, `${segment} (${range}): overview ${count} vs list ${list.pagination.total}`);
    }
    assert.equal((await pipeline(`range=${range}`)).pagination.total, ov.kpis.totalLeads, `leads (${range})`);
  }
});

test('one date window for the whole page: 90d leaves out the old lead everywhere', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ov = await overview('90d');
  assert.equal(ov.kpis.totalLeads, 13);
  assert.equal(ov.funnel.find((f: any) => f.key === 'qualified').count, 8);
  const an = await getJson(m.analytics, 'https://x.invalid/api/admin/conversion/analytics?range=90d');
  assert.equal(an.success, true);
  assert.equal(an.leads, 13);
  assert.equal(an.conversion.leadToQualified.num, 8);
  assert.equal(an.conversion.leadToQualified.den, 13);
  assert.equal(an.agents.demo.noShow, 1);
  // Default (no range) is all time, on both pages.
  assert.equal((await getJson(m.overview, 'https://x.invalid/api/admin/conversion/overview')).kpis.totalLeads, 14);
  assert.equal((await pipeline('')).pagination.total, 14);
});

test('pipeline: filters apply before paging, totals are filtered totals', async (t) => {
  if (skipReason) return t.skip(skipReason);
  // 60 more fresh leads, created LATER (newer), so the paid lead sorts beyond page 1 by createdAt.
  const bulk = Array.from({ length: 60 }, (_, i) => ({ tenantId: T, name: `Bulk ${i}`, phone: phone(), createdAt: new Date(Date.now() + (i + 1) * 1000) }));
  await m.Lead.collection.insertMany(bulk);
  const verified = await pipeline('payment=verified');
  assert.equal(verified.pagination.total, 1);
  assert.equal(verified.rows.length, 1, 'found although it would be on page 2 unfiltered');
  assert.equal(verified.rows[0].name, 'Lead demoThenPaid');
  const completed = await pipeline('demo=completed');
  assert.equal(completed.pagination.total, 1);
  const none = await pipeline('demo=none');
  assert.equal(none.pagination.total, 74 - 2, 'every lead without a booking');
  assert.equal(none.pagination.totalPages, 2);
  assert.equal((await pipeline('demo=none&page=2')).rows.length, 22);
  await m.Lead.deleteMany({ name: /^Bulk / });
});

test('pipeline: agent AND ownership, stage label = column, phone search in any format, sort by shown activity', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal((await pipeline('agent=SALES&ownership=human')).pagination.total, 0, 'contradictory filters → nothing, not a silent override');
  assert.equal((await pipeline('agent=HUMAN&ownership=human')).pagination.total, 1);

  const qualified = await pipeline('stage=Qualified');
  assert.ok(qualified.rows.length > 0);
  assert.ok(qualified.rows.every((r: any) => r.funnelStage === 'Qualified'), 'filter matches the label shown');
  assert.ok(!qualified.rows.some((r: any) => r.name === 'Lead lowScore'));

  const national = L.scored.phone.slice(3);
  for (const q of [L.scored.phone, `0${national}`, `${national.slice(0, 5)} ${national.slice(5)}`, `+91 ${national}`]) {
    const res = await pipeline(`q=${encodeURIComponent(q)}`);
    assert.equal(res.pagination.total, 1, `search "${q}"`);
    assert.equal(res.rows[0].name, 'Lead scored');
  }

  const now = Date.now();
  await m.Lead.updateOne({ _id: L.fresh._id }, { $set: { lastActivityAt: new Date(now - 10 * DAY), lastMeaningfulInteractionAt: new Date(now + 60_000) } });
  await m.Lead.updateOne({ _id: L.lowScore._id }, { $set: { lastActivityAt: new Date(now + 120_000) } });
  await m.Lead.updateOne({ _id: L.lowScore._id }, { $unset: { lastMeaningfulInteractionAt: 1 } });
  const sorted = await pipeline('sort=lastActivityAt:desc');
  const shown = sorted.rows.map((r: any) => new Date(r.lastActivityAt ?? 0).getTime());
  assert.deepEqual(shown, [...shown].sort((a, b) => b - a), 'ordered by the value the column displays');
});

test('pipeline + detail: business name from the lead or its signed-up workspace; payment shows trial', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.Lead.updateOne({ _id: L.buyer._id }, { $set: { businessType: 'Sunrise Bakery' } });
  const owner: any = await m.User.create({ fullName: 'Pending Owner', email: 'pending-owner@example.invalid', phone: L.pending.phone, role: 'CLIENT' } as any);
  await m.Business.collection.insertOne({ name: 'Glow Salon', userId: owner._id, subscriptionStatus: 'trial_active' });

  const rows = (await pipeline('')).rows;
  assert.equal(rows.find((r: any) => r.name === 'Lead buyer').business, 'Sunrise Bakery');
  const pendingRow = rows.find((r: any) => r.name === 'Lead pending');
  assert.equal(pendingRow.business, 'Glow Salon');
  assert.equal(pendingRow.paymentStatus, 'trial');
  assert.equal((await pipeline('payment=trial')).pagination.total, 1);

  const d = await (await m.detail.GET(new Request('https://x.invalid'), { params: Promise.resolve({ id: String(L.pending._id) }) })).json();
  assert.equal(d.lead.businessName, 'Glow Salon');
  assert.equal(d.lead.business.subscriptionStatus, 'trial_active');
});

test('detail: newest timeline events, no tenant events, every agent conversation', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const l = L.nurturing;
  const base = Date.now() - 1000 * DAY / 1000;
  const docs = Array.from({ length: 450 }, (_, i) => ({ leadId: l._id, phone: l.phone, type: 'MESSAGE_RECEIVED', payload: { n: i }, actor: 'test', createdAt: new Date(base + i * 1000) }));
  await m.LeadEvent.collection.insertMany(docs);
  await m.LeadEvent.create({ phone: l.phone, type: 'OPT_OUT', conversationType: 'tenant', actor: 'tenant' });
  await m.SalesConversation.create({ businessId: new m.mongoose.Types.ObjectId(), leadPhone: l.phone, status: 'active', messages: [{ role: 'agent', text: 'Hello from sales', at: new Date() }] } as any);
  await m.BookingConversation.create({ leadPhone: l.phone, leadId: l._id, status: 'active', messages: [{ role: 'agent', text: 'Pick a demo slot', at: new Date() }] } as any);

  const d = await (await m.detail.GET(new Request('https://x.invalid'), { params: Promise.resolve({ id: String(l._id) }) })).json();
  assert.equal(d.timelineTruncated, true);
  assert.equal(d.timeline.length, 400);
  assert.equal(d.timeline[d.timeline.length - 1].payload.n, 449, 'the newest event is included');
  assert.ok(!d.timeline.some((e: any) => e.type === 'OPT_OUT'), "a customer tenant's event on the same phone is not shown");
  assert.deepEqual(d.conversations.map((c: any) => c.type).sort(), ['booking', 'sales']);
  assert.equal(d.conversations.find((c: any) => c.type === 'booking').messages[0].text, 'Pick a demo slot');
});

test('return to AI: platform leads only, clear errors, and it really releases the lead', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const post = async (body: any) => {
    const res = await m.returnToAi.POST(jsonReq('https://x.invalid/api/admin/leads/return-to-ai', 'POST', body));
    return { status: res.status, body: await res.json() };
  };
  const notHuman = await post({ leadId: String(L.fresh._id), targetAgent: 'SALES' });
  assert.equal(notHuman.status, 409);
  assert.match(notHuman.body.error, /not HUMAN-owned/);

  const tenantLead: any = await m.Lead.create({ tenantId: 'some-customer', name: 'Tenant human', phone: phone(), currentAgent: 'HUMAN', humanHandoff: { active: true } } as any);
  assert.equal((await post({ leadId: String(tenantLead._id), targetAgent: 'SALES' })).status, 404, "a customer's own lead is never released from here");

  const ok = await post({ leadId: String(L.human._id), targetAgent: 'SALES' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const after: any = await m.Lead.findById(L.human._id).lean();
  assert.equal(after.currentAgent, 'SALES');
  assert.notEqual(after.humanHandoff?.active, true);
});
