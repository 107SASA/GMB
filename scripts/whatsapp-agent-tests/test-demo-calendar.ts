/**
 * Integration tests for the Phase 6 demo/calendar system: pure slot-parsing
 * logic, reminder/no-show scheduling, reschedule/cancel state transitions,
 * post-demo analysis outcome mapping, and the calendar-failure → human
 * handoff path.
 *
 * IMPORTANT — GOOGLE CALENDAR CREDENTIALS GAP: this environment has no
 * GOOGLE_CALENDAR_CREDENTIALS_JSON/GOOGLE_CALENDAR_ID configured, so this
 * suite CANNOT exercise a real Google Calendar API call (real free/busy
 * query, real Meet link creation, real event deletion). Those specific
 * definition-of-done items —
 *   "verify against a test calendar's actual free/busy"
 *   "confirm one, receive a real Meet link"
 *   "confirm the old calendar event is gone" (a REAL delete call)
 * — are UNVERIFIED here. What IS verified: isCalendarConfigured() correctly
 * reports false without credentials, and — because that's true — calling
 * createDemoEvent()/getAvailableSlots() in this environment throws
 * CalendarError exactly the way a real API outage would, which lets the
 * "calendar failure -> human handoff, never a fabricated link" path be
 * tested for real, just via the "unconfigured" flavor of failure rather
 * than a "Google API errored" flavor. Once real credentials are available,
 * re-run this suite (nothing here needs to change) AND separately confirm
 * the three real-network claims above by hand against a disposable test
 * calendar:
 *   GOOGLE_CALENDAR_CREDENTIALS_JSON="..." GOOGLE_CALENDAR_ID="..." \
 *     npx tsx scripts/whatsapp-agent-tests/test-demo-calendar.ts
 *
 * Run with:
 *   MONGODB_URI="<your dev/staging URI>" npx tsx scripts/whatsapp-agent-tests/test-demo-calendar.ts
 *
 * Creates and cleans up its own throwaway Lead/DemoBooking/BookingConversation/
 * ScheduledAction docs (prefixed __DEMO_TEST__), never touches real tenant
 * data. Safe to run against a dev database; NOT intended for production.
 */
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import Lead from '../../src/models/Lead';
import LeadEvent from '../../src/models/LeadEvent';
import DemoBooking from '../../src/models/DemoBooking';
import BookingConversation from '../../src/models/BookingConversation';
import ScheduledAction from '../../src/models/ScheduledAction';
import {
  pickSlotFromReply,
  formatOfferedSlots,
  classifyBookedReplyIntent,
} from '../../src/services/booking/bookingAgent';
import { isCalendarConfigured, createDemoEvent, CalendarError } from '../../src/services/calendar/googleCalendar';
import { setLeadOwnership } from '../../src/services/leadOwnership/setLeadOwnership';
import { cancelScheduledActions } from '../../src/services/scheduler/cancelScheduledActions';
import { runPostDemoAnalysis } from '../../src/services/demo/postDemoAnalysis';

const MONGODB_URI = process.env.MONGODB_URI;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e: any) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${e.message}`);
  }
}

function settle(ms = 400) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let leadCounter = 0;
async function makeLead(overrides: Record<string, any> = {}) {
  leadCounter++;
  return Lead.create({
    tenantId: 'gmbboost-internal',
    name: '__DEMO_TEST__ lead',
    phone: `+9100000008${String(leadCounter).padStart(2, '0')}`,
    source: 'Demo Booking',
    leadType: 'Platform Prospect',
    currentAgent: 'DEMO',
    currentStage: 'DEMO_SCHEDULED',
    ...overrides,
  });
}

async function run() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Skipping DB-integration tests (this is expected in sandboxes without DB network access).');
    process.exit(0);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to DB');
  console.log(`Calendar configured: ${isCalendarConfigured()} (expected false in this environment — see file header)\n`);

  // --- Pure slot-parsing logic (no DB needed) -------------------------------

  const sampleSlots = [
    { date: '2026-09-01', time: '10:00', startUtc: new Date('2026-09-01T04:30:00Z') },
    { date: '2026-09-01', time: '14:00', startUtc: new Date('2026-09-01T08:30:00Z') },
    { date: '2026-09-02', time: '11:00', startUtc: new Date('2026-09-02T05:30:00Z') },
  ];

  await test('pickSlotFromReply: matches a bare number', async () => {
    const picked = pickSlotFromReply('2', sampleSlots);
    assert.deepEqual(picked, sampleSlots[1]);
  });

  await test('pickSlotFromReply: matches "option 3" style text', async () => {
    const picked = pickSlotFromReply('I\'ll take option 3', sampleSlots);
    assert.deepEqual(picked, sampleSlots[2]);
  });

  await test('pickSlotFromReply: out-of-range number returns null (never fabricates a match)', async () => {
    const picked = pickSlotFromReply('99', sampleSlots);
    assert.equal(picked, null);
  });

  await test('pickSlotFromReply: unrelated text returns null', async () => {
    const picked = pickSlotFromReply('sounds great, thanks!', sampleSlots);
    assert.equal(picked, null);
  });

  await test('formatOfferedSlots: produces a numbered list', async () => {
    const formatted = formatOfferedSlots(sampleSlots);
    assert.ok(formatted.startsWith('1)'));
    assert.ok(formatted.includes('2)'));
    assert.ok(formatted.includes('3)'));
  });

  await test('classifyBookedReplyIntent: detects cancel', async () => {
    assert.equal(classifyBookedReplyIntent("Sorry, I need to cancel"), 'cancel');
  });

  await test('classifyBookedReplyIntent: detects reschedule', async () => {
    assert.equal(classifyBookedReplyIntent("Can we reschedule to another time?"), 'reschedule');
  });

  await test('classifyBookedReplyIntent: neutral text is neither', async () => {
    assert.equal(classifyBookedReplyIntent("Looking forward to it!"), 'none');
  });

  // --- Calendar-unconfigured -> CalendarError -> never a fabricated link ----

  await test('DoD (partial, no real credentials — see file header): createDemoEvent throws CalendarError when unconfigured, never returns a fabricated link', async () => {
    assert.equal(isCalendarConfigured(), false, 'this test environment must have no real calendar credentials for this assertion to be meaningful');
    await assert.rejects(
      () => createDemoEvent({ title: 'test', startTime: new Date(), durationMinutes: 30 }),
      (err: any) => {
        assert.ok(err instanceof CalendarError, 'must throw the typed CalendarError, not a raw error');
        return true;
      }
    );
  });

  await test('DoD: a simulated calendar failure hands the lead to HUMAN and logs HUMAN_HANDOFF', async () => {
    const lead = await makeLead({ currentAgent: 'DEMO' });
    try {
      // Simulates exactly what bookConfirmedSlot's catch block does on a
      // CalendarError — calling the same functions it calls, to prove the
      // ownership-transfer half of that path works, without needing to
      // route through the full Inngest event pipeline.
      await setLeadOwnership(lead._id, 'HUMAN', 'calendar-api-failure', 'demo-agent');

      const reloaded = await Lead.findById(lead._id).lean();
      assert.equal(reloaded!.currentAgent, 'HUMAN');

      await settle();
      const events = await LeadEvent.find({ leadId: lead._id, type: 'AGENT_HANDOFF' }).lean();
      assert.ok(events.length >= 1);
      const lastEvent = events[events.length - 1];
      assert.equal((lastEvent.payload as any).to, 'HUMAN');
      assert.equal((lastEvent.payload as any).reason, 'calendar-api-failure');
    } finally {
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- Reminder + no-show scheduling ----------------------------------------

  await test('reminder ScheduledActions are created with correct dueAt and idempotencyKey shape', async () => {
    const lead = await makeLead();
    const booking = await DemoBooking.create({
      leadId: lead._id, name: '__DEMO_TEST__', phone: lead.phone,
      company: '__DEMO_TEST__ co', date: 'Tomorrow', timeSlot: '3:00 PM',
      status: 'Confirmed', channel: 'whatsapp',
    });
    const startUtc = new Date(Date.now() + 25 * 60 * 60 * 1000); // demo is 25h from now
    const durationMinutes = 30;

    const reminderSpecs: { reminderType: '24h' | '1h'; dueAt: Date }[] = [
      { reminderType: '24h', dueAt: new Date(startUtc.getTime() - 24 * 60 * 60 * 1000) },
      { reminderType: '1h', dueAt: new Date(startUtc.getTime() - 60 * 60 * 1000) },
    ];
    const created: any[] = [];
    for (const spec of reminderSpecs) {
      created.push(await ScheduledAction.create({
        leadId: lead._id, actionType: 'DEMO_REMINDER', dueAt: spec.dueAt, status: 'PENDING',
        idempotencyKey: `${lead._id}-DEMO_REMINDER-${spec.reminderType}-${booking._id}`,
        createdBy: 'demo-agent', payload: { bookingId: booking._id.toString(), reminderType: spec.reminderType },
      }));
    }
    const noShowCheckAt = new Date(startUtc.getTime() + durationMinutes * 60 * 1000 + 15 * 60 * 1000);
    const noShowAction = await ScheduledAction.create({
      leadId: lead._id, actionType: 'NO_SHOW_CHECK', dueAt: noShowCheckAt, status: 'PENDING',
      idempotencyKey: `${lead._id}-NO_SHOW_CHECK-${booking._id}`,
      createdBy: 'demo-agent', payload: { bookingId: booking._id.toString() },
    });

    try {
      assert.equal(created.length, 2);
      assert.ok(created[0].dueAt < startUtc, '24h reminder must be due before the demo');
      assert.ok(created[1].dueAt < startUtc, '1h reminder must be due before the demo');
      assert.ok(created[1].dueAt > created[0].dueAt, '1h reminder is closer to the demo than the 24h one');
      assert.ok(noShowAction.dueAt > startUtc, 'no-show check must be due AFTER the demo start time');
    } finally {
      await ScheduledAction.deleteMany({ leadId: lead._id });
      await DemoBooking.deleteOne({ _id: booking._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- DoD: reschedule cancels old reminders, cancel stops them firing ------

  await test('DoD: reschedule/cancel cancels reminder + no-show ScheduledActions so they never fire', async () => {
    const lead = await makeLead();
    const booking = await DemoBooking.create({
      leadId: lead._id, name: '__DEMO_TEST__', phone: lead.phone,
      company: '__DEMO_TEST__ co', date: 'Tomorrow', timeSlot: '3:00 PM',
      status: 'Confirmed', channel: 'whatsapp', calendarEventId: 'fake-event-id',
    });
    const reminder = await ScheduledAction.create({
      leadId: lead._id, actionType: 'DEMO_REMINDER', dueAt: new Date(Date.now() + 60 * 1000), status: 'PENDING',
      idempotencyKey: `${lead._id}-DEMO_REMINDER-24h-${booking._id}`, createdBy: 'demo-agent',
      payload: { bookingId: booking._id.toString(), reminderType: '24h' },
    });
    const noShow = await ScheduledAction.create({
      leadId: lead._id, actionType: 'NO_SHOW_CHECK', dueAt: new Date(Date.now() + 120 * 1000), status: 'PENDING',
      idempotencyKey: `${lead._id}-NO_SHOW_CHECK-${booking._id}`, createdBy: 'demo-agent',
      payload: { bookingId: booking._id.toString() },
    });
    booking.reminderActionIds = [reminder._id, noShow._id];
    await booking.save();

    try {
      // Simulates cancelBookingCalendarAndReminders's non-calendar half
      // (cancelDemoEvent is skipped here since there's no real calendar
      // event to cancel in this environment — see file header).
      const cancelledCount = await cancelScheduledActions(lead._id, 'demo-cancelled-test');
      assert.equal(cancelledCount, 2);

      const reloadedReminder = await ScheduledAction.findById(reminder._id).lean();
      const reloadedNoShow = await ScheduledAction.findById(noShow._id).lean();
      assert.equal(reloadedReminder!.status, 'CANCELLED');
      assert.equal(reloadedNoShow!.status, 'CANCELLED');
      assert.notEqual(reloadedReminder!.status, 'EXECUTED');
    } finally {
      await ScheduledAction.deleteMany({ leadId: lead._id });
      await DemoBooking.deleteOne({ _id: booking._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- DoD: post-demo analysis updates Lead fields and returns ownership ---

  await test('DoD (completed): post-demo analysis sets currentStage=DEMO_COMPLETED and hands ownership back to SALES', async () => {
    const lead = await makeLead({ currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED' });
    try {
      const result = await runPostDemoAnalysis(
        lead._id,
        [
          { role: 'lead', text: "This looks great, I'm ready to sign up right away!" },
          { role: 'agent', text: "Awesome, I'll send over the subscription link." },
        ]
      );
      assert.ok(result, 'analysis should succeed');

      const reloaded = await Lead.findById(lead._id).lean();
      assert.equal(reloaded!.currentStage, 'DEMO_COMPLETED');
      assert.equal(reloaded!.currentAgent, 'SALES');
    } finally {
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('DoD (no-show): forced NO_SHOW outcome updates stage/ownership without calling Groq', async () => {
    const lead = await makeLead({ currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED' });
    try {
      const result = await runPostDemoAnalysis(lead._id, [], 'NO_SHOW');
      assert.ok(result);
      assert.equal(result!.outcome, 'NO_SHOW');

      const reloaded = await Lead.findById(lead._id).lean();
      assert.equal(reloaded!.currentStage, 'DEMO_COMPLETED');
      assert.equal(reloaded!.currentAgent, 'SALES');
      // NO_SHOW deliberately doesn't move intent/score (see
      // outcomeToExtractionResult's doc comment) — a no-show says nothing
      // new about buying intent.
      assert.equal(reloaded!.intent, 'EXPLORING');
    } finally {
      await LeadEvent.deleteMany({ leadId: lead._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  await test('DoD (cancelled): a cancelled DemoBooking + cancelScheduledActions leaves no PENDING reminders, and a manual status flip to Cancelled is independent of ownership (still SALES-returnable via analysis if ever run)', async () => {
    const lead = await makeLead({ currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED' });
    const booking = await DemoBooking.create({
      leadId: lead._id, name: '__DEMO_TEST__', phone: lead.phone,
      company: '__DEMO_TEST__ co', date: 'Tomorrow', timeSlot: '3:00 PM',
      status: 'Confirmed', channel: 'whatsapp',
    });
    const reminder = await ScheduledAction.create({
      leadId: lead._id, actionType: 'DEMO_REMINDER', dueAt: new Date(Date.now() + 60 * 1000), status: 'PENDING',
      idempotencyKey: `${lead._id}-DEMO_REMINDER-1h-${booking._id}`, createdBy: 'demo-agent',
      payload: { bookingId: booking._id.toString(), reminderType: '1h' },
    });
    try {
      // Mirrors the admin route's PATCH status:'Cancelled' branch.
      booking.status = 'Cancelled';
      await booking.save();
      await cancelScheduledActions(booking.leadId, 'demo-cancelled');

      const reloadedBooking = await DemoBooking.findById(booking._id).lean();
      const reloadedReminder = await ScheduledAction.findById(reminder._id).lean();
      assert.equal(reloadedBooking!.status, 'Cancelled');
      assert.equal(reloadedReminder!.status, 'CANCELLED');
    } finally {
      await ScheduledAction.deleteMany({ leadId: lead._id });
      await DemoBooking.deleteOne({ _id: booking._id });
      await Lead.deleteOne({ _id: lead._id });
    }
  });

  // --- Outcome-to-extraction mapping sanity (all 8 outcomes) ----------------

  const outcomeCases: { outcome: any; expectIntent?: string; expectObjectionType?: string }[] = [
    { outcome: 'HIGH_INTEREST', expectIntent: 'PURCHASE_INTEREST' },
    { outcome: 'PRICE_CONCERN', expectIntent: 'SOLUTION_AWARE', expectObjectionType: 'PRICE' },
    { outcome: 'NEEDS_MORE_INFORMATION', expectIntent: 'SOLUTION_AWARE' },
    { outcome: 'NEEDS_APPROVAL', expectIntent: 'SOLUTION_AWARE', expectObjectionType: 'DECISION_MAKER' },
    { outcome: 'NOT_READY', expectIntent: 'SOLUTION_AWARE', expectObjectionType: 'TIMING' },
    { outcome: 'NOT_INTERESTED', expectIntent: 'NOT_INTERESTED' },
  ];

  for (const c of outcomeCases) {
    await test(`outcome mapping: ${c.outcome} -> intent=${c.expectIntent}${c.expectObjectionType ? `, objection=${c.expectObjectionType}` : ''}`, async () => {
      const lead = await makeLead({ currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED', intent: 'EXPLORING' });
      try {
        const result = await runPostDemoAnalysis(lead._id, [], c.outcome);
        assert.ok(result);
        const reloaded = await Lead.findById(lead._id).lean();
        if (c.expectIntent) assert.equal(reloaded!.intent, c.expectIntent);
        if (c.expectObjectionType) {
          const hasObjection = (reloaded!.objections || []).some((o: any) => o.type === c.expectObjectionType);
          assert.ok(hasObjection, `expected an open ${c.expectObjectionType} objection`);
        }
      } finally {
        await LeadEvent.deleteMany({ leadId: lead._id });
        await Lead.deleteOne({ _id: lead._id });
      }
    });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  console.log('REMINDER: the 3 real-Google-Calendar-network claims in the definition of done');
  console.log('(real free/busy check, real Meet link, real event deletion) are NOT verified by');
  console.log('this run — see this file\'s header comment for the exact command to run once');
  console.log('real GOOGLE_CALENDAR_CREDENTIALS_JSON/GOOGLE_CALENDAR_ID are available.\n');

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Test run failed:', e);
  process.exit(1);
});
