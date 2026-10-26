/**
 * Conversation context for returning and booked leads, through the REAL
 * Inngest functions (bookingAgentReply, salesAgentReply) against an in-memory
 * MongoDB. The AI is a local fake Groq server (no network), so the prompt the
 * agent sends can be inspected and the AI can be switched off.
 *
 * Run: npx tsx --test tests/workflow/sales-context.test.ts
 */
import { startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runDurably } from '../helpers/inngestReplay';

for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|GROQ|OPENAI|INNGEST|LEAD_ENGINE)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.TWILIO_TEMPLATE_NOTIFICATION = 'HXnotification_test';
process.env.PLATFORM_WHATSAPP_NUMBER = '+919000000000';

const prompts: string[] = [];
let aiUp = true;
let server: http.Server;
let skipReason: string | null = null;
let m: any = {};

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!aiUp) { res.writeHead(503); res.end('{}'); return; }
      try { prompts.push(JSON.stringify(JSON.parse(raw).messages)); } catch { prompts.push(raw); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 0, model: 'fake',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'FAKE-AI ANSWER: the demo walks through your Google profile and reviews.' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as any;
  process.env.GROQ_API_KEY = 'test-key';
  process.env.GROQ_BASE_URL = `http://127.0.0.1:${port}`;
  skipReason = await startMemoryDb('sales_context');
  if (skipReason) return;
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async () => ({ ids: [] });
  m = {
    mongoose: (await import('mongoose')).default,
    fns: await import('../../src/services/inngest/functions'),
    Lead: (await import('../../src/models/Lead')).default,
    DemoBooking: (await import('../../src/models/DemoBooking')).default,
    BookingConversation: (await import('../../src/models/BookingConversation')).default,
    SalesConversation: (await import('../../src/models/SalesConversation')).default,
    SalesAgentConfig: (await import('../../src/models/SalesAgentConfig')).default,
    BookingAgentConfig: (await import('../../src/models/BookingAgentConfig')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
  };
  await m.SalesAgentConfig.create({
    key: 'default', enabled: true, firstMessage: { mode: 'template', template: 'x', aiSystemPrompt: '' }, followUps: [],
    agentSystemPrompt: 'You are the Growwmatics assistant.',
    knowledge: { businessOverview: 'Growwmatics improves Google Business Profiles.' },
  } as any);
  await m.BookingAgentConfig.updateOne({ key: 'default' }, { $set: { enabled: true } }, { upsert: true });
});
after(async () => {
  await stopMemoryDb();
  server?.close();
});

let seq = 0;
const rows = (phone: string) => m.MessageQueue.find({ 'payload.phone': phone }).sort({ createdAt: 1 }).lean();
const textOf = (row: any) => row.payload.body || row.payload.variables?.['2'] || '';

async function bookedLead(over: Record<string, unknown> = {}) {
  const phone = `+9198776${String(++seq).padStart(5, '0')}`;
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: `Asha ${seq}`, phone, currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED', ...over } as any);
  const start = new Date(Date.now() + 2 * 86_400_000);
  const booking = await m.DemoBooking.create({ leadId: lead._id, name: lead.name, phone, date: 'Tue 27 Oct', timeSlot: '11:00 AM', status: 'Confirmed', startUtc: start, endUtc: new Date(start.getTime() + 1_800_000), meetingLink: 'https://meet.example/abc' } as any);
  await m.SalesConversation.create({ businessId: new m.mongoose.Types.ObjectId(), leadPhone: phone, phoneKey: phone.slice(-10), status: 'handed_off', scores: { businessName: 'Asha Bakery', rankText: '#14', missingKeywords: [] }, messages: [{ role: 'lead', text: 'what does it cost?', at: new Date() }] } as any);
  const convo = await m.BookingConversation.create({
    leadPhone: phone, phoneKey: phone.slice(-10), leadId: lead._id, bookingId: booking._id, status: 'booked',
    messages: [{ role: 'lead', text: 'What will you show me in the demo?', at: new Date(), via: 'whatsapp' }],
  } as any);
  return { phone, lead, booking, convo };
}

const bookedReply = (convo: any, body: string) =>
  runDurably(m.fns.bookingAgentReply, { data: { conversationId: String(convo._id), body } });

test('a question after booking gets a real, grounded answer — never a new time', async (t) => {
  if (skipReason) return t.skip(skipReason);
  aiUp = true;
  prompts.length = 0;
  const b = await bookedLead();
  await bookedReply(b.convo, 'What will you show me in the demo?');
  const sent = await rows(b.phone);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /FAKE-AI ANSWER/);
  const prompt = prompts.at(-1)!;
  assert.match(prompt, /Tue 27 Oct at 11:00 AM/, 'knows the booked time');
  assert.match(prompt, /meet\.example\/abc/);
  assert.match(prompt, /Asha Bakery/, 'knows their report');
  assert.match(prompt, /Growwmatics improves Google Business Profiles/, 'approved knowledge');
  assert.match(prompt, /what does it cost\?/, 'sees the earlier sales conversation');
  assert.match(prompt, /Never offer, suggest or confirm another time/);
  assert.equal((await m.DemoBooking.findById(b.booking._id).lean()).status, 'Confirmed', 'booking untouched');
});

test('AI unavailable → the fixed "you are booked" reply; a human-owned lead never gets the AI answer', async (t) => {
  if (skipReason) return t.skip(skipReason);
  aiUp = false;
  const b = await bookedLead();
  await bookedReply(b.convo, 'Any prep needed?');
  const sent = await rows(b.phone);
  assert.equal(sent.length, 1);
  assert.doesNotMatch(textOf(sent[0]), /FAKE-AI/);
  assert.match(textOf(sent[0]), /Tue 27 Oct at 11:00 AM/);

  aiUp = true;
  prompts.length = 0;
  const h = await bookedLead({ currentAgent: 'HUMAN', humanHandoff: { active: true } });
  await bookedReply(h.convo, 'Any prep needed?');
  assert.ok(!prompts.some((p) => /They already have this demo booked/.test(p)), 'no AI answer for a human-owned lead');
  for (const row of await rows(h.phone)) assert.doesNotMatch(textOf(row), /FAKE-AI/);
});

test('cancel / reschedule in a booked thread still use the existing flows (no AI)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  aiUp = true;
  prompts.length = 0;
  const b = await bookedLead();
  await bookedReply(b.convo, 'please cancel');
  assert.equal((await m.DemoBooking.findById(b.booking._id).lean()).status, 'Cancelled');
  assert.ok(!prompts.some((p) => /They already have this demo booked/.test(p)), 'cancel is not answered by the AI');
});

test('a returning lead\'s Sales reply sees their demo booking and the demo-booking conversation', async (t) => {
  if (skipReason) return t.skip(skipReason);
  aiUp = true;
  prompts.length = 0;
  const b = await bookedLead({ currentAgent: 'SALES', currentStage: 'NURTURING' });
  await m.DemoBooking.updateOne({ _id: b.booking._id }, { $set: { status: 'Cancelled' } });
  await m.BookingConversation.updateOne({ _id: b.convo._id }, { $set: { status: 'stopped' } });
  const sales: any = await m.SalesConversation.findOne({ phoneKey: b.phone.slice(-10) });
  sales.status = 'active';
  sales.messages.push({ role: 'lead', text: 'Hi again, can we talk?', at: new Date() });
  sales.lastLeadReplyAt = new Date();
  await sales.save();
  await runDurably(m.fns.salesAgentReply, { data: { conversationId: String(sales._id), body: 'Hi again, can we talk?' } });
  const prompt = prompts.find((p) => /DEMO BOOKING/.test(p));
  assert.ok(prompt, 'the sales reply prompt carries the demo context');
  assert.match(prompt!, /status Cancelled/);
  assert.match(prompt!, /What will you show me in the demo\?/, 'earlier demo-booking conversation included');
  assert.match(prompt!, /Hi again, can we talk\?/);
});

test("the Booking Agent's own instructions shape answers to booked leads; empty falls back to the Sales Agent's", async (t) => {
  if (skipReason) return t.skip(skipReason);
  aiUp = true;
  await m.BookingAgentConfig.updateOne({ key: 'default' }, { $set: { agentSystemPrompt: 'BOOKING PERSONA: warm and brief.' } });
  try {
    const b = await bookedLead();
    prompts.length = 0;
    await bookedReply(b.convo, 'Do I need to prepare anything?');
    const prompt = prompts.find((p) => /They already have this demo booked/.test(p))!;
    assert.match(prompt, /BOOKING PERSONA: warm and brief\./);
    assert.doesNotMatch(prompt, /You are the Growwmatics assistant\./, 'not the Sales Agent instructions');

    await m.BookingAgentConfig.updateOne({ key: 'default' }, { $set: { agentSystemPrompt: '' } });
    const c = await bookedLead();
    prompts.length = 0;
    await bookedReply(c.convo, 'Do I need to prepare anything?');
    assert.match(prompts.find((p) => /They already have this demo booked/.test(p))!, /You are the Growwmatics assistant\./);
  } finally {
    await m.BookingAgentConfig.updateOne({ key: 'default' }, { $set: { agentSystemPrompt: '' } });
  }
});
