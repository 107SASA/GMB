/**
 * Leads & Pipeline table: the "Last conversation / call" column, through the
 * REAL list route against an in-memory MongoDB. Each row carries the newest
 * of: the last WhatsApp message in any agent conversation, the last logged
 * call, the last team note.
 *
 * Run: npx tsx --test tests/workflow/admin-leads-last-touch.test.ts
 */
import { signInAsSuperAdmin, startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let skipReason: string | null = null;
let m: any = {};
let admin: any;
const MIN = 60_000;
const ago = (min: number) => new Date(Date.now() - min * MIN);
let BIZ: any;

before(async () => {
  skipReason = await startMemoryDb('admin_last_touch');
  if (skipReason) return;
  m = {
    pipeline: await import('../../src/app/api/admin/conversion/pipeline/route'),
    Lead: (await import('../../src/models/Lead')).default,
    LeadEvent: (await import('../../src/models/LeadEvent')).default,
    SalesConversation: (await import('../../src/models/SalesConversation')).default,
    BookingConversation: (await import('../../src/models/BookingConversation')).default,
  };
  BIZ = new (await import('mongoose')).default.Types.ObjectId();
  admin = await signInAsSuperAdmin('last-touch-admin@example.invalid');
});
after(stopMemoryDb);

const lead = (name: string, phone: string) => m.Lead.create({ tenantId: 'gmbboost-internal', name, phone, leadType: 'Platform Prospect' } as any);
const rows = async () => {
  const res = await m.pipeline.GET(new Request('https://x.invalid/api/admin/conversion/pipeline?pageSize=100'));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return new Map<string, any>(body.rows.map((r: any) => [r.name, r]));
};

test('each row shows the newest message, call or note — whichever came last', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Lead replied on WhatsApp most recently (older AI message in the booking chat).
  const a = await lead('Asha Message', '+919811100001');
  await m.SalesConversation.create({ businessId: BIZ, leadPhone: a.phone, phoneKey: a.phone.slice(-10), status: 'active', messages: [
    { role: 'agent', text: 'Hi Asha, want a demo?', at: ago(60) },
    { role: 'lead', text: 'Yes please, tomorrow evening works', at: ago(10) },
  ] } as any);
  await m.BookingConversation.create({ leadPhone: a.phone, phoneKey: a.phone.slice(-10), status: 'active', messages: [{ role: 'agent', text: 'Pick a time', at: ago(30) }] } as any);

  // A call logged after the last message wins.
  const b = await lead('Ravi Call', '+919811100002');
  await m.SalesConversation.create({ businessId: BIZ, leadPhone: b.phone, phoneKey: b.phone.slice(-10), status: 'active', messages: [{ role: 'agent', text: 'Following up', at: ago(120) }] } as any);
  await m.LeadEvent.create({ leadId: b._id, phone: b.phone, type: 'CALL_LOGGED', actor: String(admin._id), payload: { direction: 'outbound', outcome: 'connected', outcomeLabel: 'Connected', notes: 'Wants demo today 11 am', at: ago(5) } });

  // Team note only.
  const c = await lead('Neha Note', '+919811100003');
  await m.LeadEvent.create({ leadId: c._id, phone: c.phone, type: 'NOTE_ADDED', actor: String(admin._id), payload: { text: 'Budget approved next month' } });

  // Team reply from the Inbox.
  const d = await lead('Kiran Team', '+919811100004');
  await m.SalesConversation.create({ businessId: BIZ, leadPhone: d.phone, phoneKey: d.phone.slice(-10), status: 'active', messages: [{ role: 'agent', sender: 'human', text: 'Sending the pricing now', at: ago(3) }] } as any);

  await lead('Silent Lead', '+919811100005');

  const r = await rows();
  assert.deepEqual(
    { kind: r.get('Asha Message').lastTouch.kind, by: r.get('Asha Message').lastTouch.by, text: r.get('Asha Message').lastTouch.text },
    { kind: 'message', by: 'lead', text: 'Yes please, tomorrow evening works' },
    'newest message across all conversations'
  );
  const call = r.get('Ravi Call').lastTouch;
  assert.equal(call.kind, 'call');
  assert.equal(call.outcome, 'Connected');
  assert.equal(call.text, 'Wants demo today 11 am');
  assert.equal(call.by, 'Root Admin');
  assert.deepEqual({ kind: r.get('Neha Note').lastTouch.kind, text: r.get('Neha Note').lastTouch.text }, { kind: 'note', text: 'Budget approved next month' });
  assert.equal(r.get('Kiran Team').lastTouch.by, 'team');
  assert.equal(r.get('Silent Lead').lastTouch, null);
});

test('long messages are shortened for the table', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const l = await lead('Long Talker', '+919811100006');
  await m.SalesConversation.create({ businessId: BIZ, leadPhone: l.phone, phoneKey: l.phone.slice(-10), status: 'active', messages: [{ role: 'lead', text: 'word '.repeat(100), at: ago(1) }] } as any);
  const touch = (await rows()).get('Long Talker').lastTouch;
  assert.ok(touch.text.length <= 140);
  assert.ok(touch.text.endsWith('…'));
});
