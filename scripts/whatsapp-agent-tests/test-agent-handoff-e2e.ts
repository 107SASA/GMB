/**
 * P0 fix (post-implementation-audit) — end-to-end / integration tests that
 * invoke the ACTUAL Inngest agent-reply function objects (salesAgentReply,
 * bookingAgentReply, supportAgentReply, reportAgentReply,
 * processFollowUpJob — all from services/inngest/functions.ts), not
 * reimplementations of their logic and not just checkHandoffTriggers() in
 * isolation (see scripts/whatsapp-agent-tests/test-human-handoff.ts for
 * that unit-level coverage, which this file deliberately does not
 * duplicate).
 *
 * Why this file exists: every one of these Inngest functions is the return
 * value of inngest.createFunction({...}, handler) — `.fn` on that object IS
 * the real `async ({event, step}) => {...}` handler, unchanged. Every
 * `step.run(name, fn)` call inside these handlers is a pure pass-through
 * (`await fn()`) with no retry/memoization semantics that matter for a
 * single synchronous test run, so invoking `.fn({event, step: mockStep})`
 * with a minimal `run` pass-through genuinely executes the real handler
 * body end-to-end — the exact same code path a live webhook triggers —
 * rather than testing a helper function on its own.
 *
 * NO REAL WHATSAPP SENDS: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/
 * TWILIO_WHATSAPP_NUMBER and META_WHATSAPP_ACCESS_TOKEN/
 * META_WHATSAPP_PHONE_NUMBER_ID are deliberately deleted from process.env
 * for this entire run (see the top of run() below) — sendOutboundMessage()
 * still runs for real, but resolveTwilioCredentials()/getMetaConfig() both
 * short-circuit to "not configured" BEFORE any network call is made (see
 * services/twilio/client.ts's resolveTwilioCredentials and
 * services/whatsapp/meta.ts's getMetaConfig), so every send in this file is
 * network-free and deterministic — zero real WhatsApp credentials required,
 * per the task's explicit instruction.
 *
 * NO REAL GROQ REQUIRED for any HUMAN-owned/blocked assertion (TEST 1-3, 5)
 * — the whole point of those tests is that composeAgentReply/
 * composeSupportReply/composeInHouseAgentReply must never even be reached,
 * so nothing calls Groq. The normal-path positive controls (TEST 8-9) DO
 * reach a real composeAgentReply/composeInHouseAgentReply call using the
 * real GROQ_API_KEY already present in .env.local (same precedent as
 * test-lead-intelligence-golden-set.ts in this same directory) — but their
 * pass/fail assertion deliberately does NOT depend on that Groq call
 * succeeding or on the resulting WhatsApp send succeeding (Twilio
 * credentials are stripped for this whole file — see above), only on
 * whether sendOutboundMessage was ATTEMPTED at all (one MessageQueue row vs.
 * zero) — see the assertion-strategy comment on TEST 8 below for why. TEST
 * 10's 'connected'-status branch is deterministic and needs no Groq call at
 * all. Booking's positive path (part of TEST 4) likewise uses a reply that
 * classifies as no booking-intent ('none'), needing no Groq call — see
 * classifyBookedReplyIntent.
 *
 * This suite mutates the shared SalesAgentConfig/ReportAgentConfig/
 * BookingAgentConfig singleton docs (key:'default') for the duration of
 * each relevant test, restoring the original doc afterwards — same
 * accepted tradeoff test-human-handoff.ts already makes for
 * OrchestrationConfig when run against a live dev database. NOT intended
 * for production.
 *
 * Run with:
 *   npx tsx scripts/whatsapp-agent-tests/test-agent-handoff-e2e.ts
 * (.env.local is loaded automatically, same convention as
 * test-lead-intelligence-golden-set.ts)
 */
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) {
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[m[1]] = val;
    }
  });
}

// Force both WhatsApp providers to "not configured" for this entire process
// BEFORE any module that reads them at call-time runs — see file header.
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_WHATSAPP_NUMBER;
delete process.env.TWILIO_MESSAGING_SERVICE_SID;
delete process.env.META_WHATSAPP_ACCESS_TOKEN;
delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;

async function main() {
  const mongoose = (await import('mongoose')).default;

  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Skipping DB-integration tests (expected in sandboxes without DB network access).');
    process.exit(0);
  }

  const { default: Lead } = await import('../../src/models/Lead');
  const { default: LeadEvent } = await import('../../src/models/LeadEvent');
  const { default: SalesConversation } = await import('../../src/models/SalesConversation');
  const { default: SupportConversation } = await import('../../src/models/SupportConversation');
  const { default: ReportConversation } = await import('../../src/models/ReportConversation');
  const { default: BookingConversation } = await import('../../src/models/BookingConversation');
  const { default: SalesAgentConfig } = await import('../../src/models/SalesAgentConfig');
  const { default: ReportAgentConfig } = await import('../../src/models/ReportAgentConfig');
  const { default: BookingAgentConfig } = await import('../../src/models/BookingAgentConfig');
  const { default: MessageQueue } = await import('../../src/models/MessageQueue');
  const {
    salesAgentReply,
    supportAgentReply,
    reportAgentReply,
    bookingAgentReply,
    processFollowUpJob,
    salesNurtureConsented,
  } = await import('../../src/services/inngest/functions');

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
      console.error(`         ${e.stack || e.message}`);
    }
  }

  // Minimal step mock — every step.run(name, fn) call site in
  // services/inngest/functions.ts uses it as a pure `await fn()` wrapper
  // with no retry/memoization semantics relevant to a single test
  // invocation. step.sendEvent is a no-op stub — none of the 5 functions
  // under test here call it (only followUpCron does, which is not invoked
  // directly by any test below — its output is just a list of events, and
  // processFollowUpJob, the function that actually sends, is tested
  // directly instead).
  function makeStep() {
    return {
      run: async (_name: string, fn: () => Promise<any>) => fn(),
      sendEvent: async () => {},
      sleep: async () => {},
      waitForEvent: async () => null,
    };
  }

  /** Invokes the REAL Inngest function handler — see file header comment. */
  async function invoke(fnObj: any, eventData: Record<string, any>) {
    return fnObj.fn({ event: { data: eventData }, step: makeStep() });
  }

  // Seeded from Date.now() (not a plain per-process counter) so a phone
  // number, and therefore its MessageQueue rows, can never collide with a
  // PRIOR run of this same script — a bare 1/2/3… counter restarts at 1
  // every invocation and previously caused exactly this collision (a
  // leftover FAILED MessageQueue row from an earlier run made a later
  // run's "exactly one send attempt" assertion see two rows and fail).
  const runSeed = Date.now() % 100000;
  let counter = 0;
  function uniquePhone() {
    counter++;
    return `+91${String(runSeed).padStart(6, '0')}${String(counter).padStart(2, '0')}`;
  }

  async function makeLead(overrides: Record<string, any> = {}) {
    return Lead.create({
      tenantId: 'gmbboost-internal',
      name: '__E2E_HANDOFF_TEST__ lead',
      phone: uniquePhone(),
      source: 'WhatsApp',
      leadType: 'Platform Prospect',
      currentAgent: 'SALES',
      currentStage: 'NURTURING',
      ...overrides,
    });
  }

  async function cleanupLead(leadId: any, phone?: string) {
    await LeadEvent.deleteMany({ leadId });
    if (phone) await MessageQueue.deleteMany({ 'payload.phone': phone });
    await Lead.deleteOne({ _id: leadId });
  }

  /** Force a config singleton's `enabled` field for the duration of a test, restoring the prior document state afterwards. */
  async function withConfigEnabled<T>(Model: any, enabled: boolean, fn: () => Promise<T>): Promise<T> {
    const before = await Model.findOne({ key: 'default' }).lean();
    await Model.updateOne({ key: 'default' }, { $set: { enabled } }, { upsert: true });
    try {
      return await fn();
    } finally {
      if (before) {
        await Model.updateOne({ key: 'default' }, { $set: { enabled: (before as any).enabled } });
      } else {
        await Model.deleteOne({ key: 'default' });
      }
    }
  }

  async function run() {
    await mongoose.connect(MONGODB_URI!);
    console.log('Connected to DB\n');

    // ================================================================
    // TEST 1 — Sales conversation + HUMAN-owned Lead → invoke the REAL
    // salesAgentReply.fn → assert no AI reply is composed/sent.
    // ================================================================
    await test('TEST 1: salesAgentReply — HUMAN-owned lead gets NO AI reply', async () => {
      const lead = await makeLead({ currentAgent: 'HUMAN', humanHandoff: { active: true, reason: 'explicit-request', since: new Date() } });
      const convo = await SalesConversation.create({
        businessId: new mongoose.Types.ObjectId(),
        leadPhone: lead.phone,
        phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
        leadName: '__E2E_HANDOFF_TEST__',
        status: 'active',
        scores: { businessName: 'test', rank: null, profile: null, seo: null, review: null, competitor: null, missingKeywords: [] },
        messages: [{ role: 'lead', text: 'are you still there?', at: new Date() }],
      });
      try {
        await withConfigEnabled(SalesAgentConfig, true, async () => {
          await invoke(salesAgentReply, { conversationId: convo._id.toString(), body: 'are you still there?' });
        });

        const reloadedConvo = await SalesConversation.findById(convo._id).lean() as any;
        assert.equal(reloadedConvo!.messages.length, 1, 'no agent message must have been appended — the function must have exited before composing/sending a reply');
        assert.equal(reloadedConvo!.messages[0].role, 'lead');

        const sentMsgs = await MessageQueue.find({ 'payload.phone': lead.phone }).lean();
        assert.equal(sentMsgs.length, 0, 'no MessageQueue entry must have been created — sendOutboundMessage must never have been called at all (see TEST 8-10 for the contrasting "attempt exists" positive-control signal)');

        const reloadedLead = await Lead.findById(lead._id).lean();
        assert.equal(reloadedLead!.currentAgent, 'HUMAN', 'ownership must remain HUMAN');
      } finally {
        await SalesConversation.deleteOne({ _id: convo._id });
        await cleanupLead(lead._id, lead.phone);
      }
    });

    // ================================================================
    // TEST 2 — Support conversation + HUMAN-owned Lead (as an existing
    // IN_HOUSE customer) → invoke the REAL supportAgentReply.fn → assert no
    // AI reply is composed/sent, for BOTH the isCustomer and non-customer
    // shapes (the exact branch-ordering bug this P0 fix addressed).
    // ================================================================
    await test('TEST 2a: supportAgentReply — HUMAN-owned EXISTING CUSTOMER gets NO AI reply', async () => {
      const lead = await makeLead({ currentAgent: 'HUMAN', currentStage: 'CUSTOMER', humanHandoff: { active: true, reason: 'explicit-request', since: new Date() } });
      const convo = await SupportConversation.create({
        leadPhone: lead.phone,
        phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
        leadName: '__E2E_HANDOFF_TEST__',
        status: 'active',
        aiEnabled: true,
        messages: [{ role: 'lead', text: 'my dashboard is broken', at: new Date() }],
      });
      try {
        await invoke(supportAgentReply, { conversationId: convo._id.toString(), body: 'my dashboard is broken' });

        const reloadedConvo = await SupportConversation.findById(convo._id).lean() as any;
        assert.equal(reloadedConvo!.messages.length, 1, 'no agent message must have been appended');

        const sentMsgs = await MessageQueue.find({ 'payload.phone': lead.phone }).lean();
        assert.equal(sentMsgs.length, 0, 'no send must have happened');
      } finally {
        await SupportConversation.deleteOne({ _id: convo._id });
        await cleanupLead(lead._id, lead.phone);
      }
    });

    await test('TEST 2b: supportAgentReply — HUMAN-owned NON-customer (currentAgent HUMAN, not IN_HOUSE) gets NO AI reply — the exact branch-order bug this fix addresses', async () => {
      // Before the fix, this exact shape (currentAgent==='HUMAN', which is
      // NOT 'IN_HOUSE') fell into the `!isCustomer` branch and got a real
      // Groq-composed acknowledgment with ZERO handoff check at all.
      const lead = await makeLead({ currentAgent: 'HUMAN', currentStage: 'NURTURING', humanHandoff: { active: true, reason: 'explicit-request', since: new Date() } });
      const convo = await SupportConversation.create({
        leadPhone: lead.phone,
        phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
        leadName: '__E2E_HANDOFF_TEST__',
        status: 'active',
        aiEnabled: true,
        messages: [{ role: 'lead', text: 'hello, need help', at: new Date() }],
      });
      try {
        await invoke(supportAgentReply, { conversationId: convo._id.toString(), body: 'hello, need help' });

        const reloadedConvo = await SupportConversation.findById(convo._id).lean() as any;
        assert.equal(reloadedConvo!.messages.length, 1, 'no agent message must have been appended for a HUMAN-owned non-customer either');

        const sentMsgs = await MessageQueue.find({ 'payload.phone': lead.phone }).lean();
        assert.equal(sentMsgs.length, 0, 'no send must have happened');
      } finally {
        await SupportConversation.deleteOne({ _id: convo._id });
        await cleanupLead(lead._id, lead.phone);
      }
    });

    // ================================================================
    // TEST 3 — Report conversation + HUMAN-owned Lead → invoke the REAL
    // reportAgentReply.fn → assert no AI reply is composed/sent.
    // ================================================================
    await test('TEST 3: reportAgentReply — HUMAN-owned lead gets NO AI reply', async () => {
      const lead = await makeLead({ currentAgent: 'HUMAN', humanHandoff: { active: true, reason: 'explicit-request', since: new Date() } });
      const convo = await ReportConversation.create({
        leadPhone: lead.phone,
        phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
        leadName: '__E2E_HANDOFF_TEST__',
        status: 'connected',
        messages: [
          { role: 'agent', text: 'link sent', at: new Date() },
          { role: 'lead', text: 'any update?', at: new Date() },
        ],
      });
      try {
        await withConfigEnabled(ReportAgentConfig, true, async () => {
          await invoke(reportAgentReply, { conversationId: convo._id.toString(), body: 'any update?' });
        });

        const reloadedConvo = await ReportConversation.findById(convo._id).lean() as any;
        assert.equal(reloadedConvo!.messages.length, 2, 'no agent message must have been appended beyond the pre-seeded ones');

        const sentMsgs = await MessageQueue.find({ 'payload.phone': lead.phone }).lean();
        assert.equal(sentMsgs.length, 0, 'no send must have happened');
      } finally {
        await ReportConversation.deleteOne({ _id: convo._id });
        await cleanupLead(lead._id, lead.phone);
      }
    });

    // ================================================================
    // TEST 4 — Booking/Demo conversation + HUMAN-owned Lead → verify the
    // EXISTING handoff protection still works (unmodified this session,
    // re-verified end-to-end here for the first time).
    // ================================================================
    await test('TEST 4: bookingAgentReply — HUMAN-owned lead gets NO AI reply (pre-existing protection, re-verified end-to-end)', async () => {
      const lead = await makeLead({ currentAgent: 'HUMAN', humanHandoff: { active: true, reason: 'explicit-request', since: new Date() } });
      const convo = await BookingConversation.create({
        leadPhone: lead.phone,
        phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
        leadName: '__E2E_HANDOFF_TEST__',
        status: 'active',
        leadId: lead._id,
        messages: [{ role: 'lead', text: 'still want to book', at: new Date() }],
      });
      try {
        await withConfigEnabled(BookingAgentConfig, true, async () => {
          await invoke(bookingAgentReply, { conversationId: convo._id.toString(), body: 'still want to book' });
        });

        const reloadedConvo = await BookingConversation.findById(convo._id).lean() as any;
        assert.equal(reloadedConvo!.messages.length, 1, 'no agent message must have been appended');

        const sentMsgs = await MessageQueue.find({ 'payload.phone': lead.phone }).lean();
        assert.equal(sentMsgs.length, 0, 'no send must have happened');
      } finally {
        await BookingConversation.deleteOne({ _id: convo._id });
        await cleanupLead(lead._id, lead.phone);
      }
    });

    // ================================================================
    // TEST 5 — HUMAN-owned Lead + legacy follow-up cron job → invoke the
    // REAL processFollowUpJob.fn → assert no AI message is sent.
    // ================================================================
    await test('TEST 5: processFollowUpJob (legacy cron) — HUMAN-owned lead gets NO message sent', async () => {
      const lead = await makeLead({ currentAgent: 'HUMAN', humanHandoff: { active: true, reason: 'stuck-hot-lead', since: new Date() }, status: 'active' });
      try {
        const result: any = await invoke(processFollowUpJob, { leadId: lead._id.toString(), reminderType: '24h Reminder' });

        assert.equal(result?.skipped, true, 'must report skipped:true');
        assert.equal(result?.reason, 'human-owned-or-opted-out');

        const sentMsgs = await MessageQueue.find({ 'payload.phone': lead.phone }).lean();
        assert.equal(sentMsgs.length, 0, 'no send must have happened for a HUMAN-owned lead');
      } finally {
        await cleanupLead(lead._id, lead.phone);
      }
    });

    await test('TEST 5b: processFollowUpJob (legacy cron) — OPTED_OUT lead gets NO message sent', async () => {
      const lead = await makeLead({ currentAgent: 'SALES', nurtureStatus: 'OPTED_OUT', status: 'active' });
      try {
        const result: any = await invoke(processFollowUpJob, { leadId: lead._id.toString(), reminderType: '24h Reminder' });

        assert.equal(result?.skipped, true);
        assert.equal(result?.reason, 'human-owned-or-opted-out');

        const sentMsgs = await MessageQueue.find({ 'payload.phone': lead.phone }).lean();
        assert.equal(sentMsgs.length, 0);
      } finally {
        await cleanupLead(lead._id, lead.phone);
      }
    });

    // ================================================================
    // TEST 5c — HUMAN-owned Lead + the Sales follow-up DRIP (a separate
    // send path from salesAgentReply's own inline reply, invoked from
    // salesNurtureConsented/salesNurtureRequested on a delay/schedule, not
    // as a reply to an inbound message) → invoke the REAL
    // salesNurtureConsented.fn end-to-end → assert no drip message is sent.
    // Found during this session's fresh path re-search — this drip loop
    // previously had ZERO human-handoff awareness at all (only an inert
    // LEAD_ENGINE_V2 cohort check), unlike salesAgentReply itself.
    // ================================================================
    await test('TEST 5c: sales follow-up drip (salesNurtureConsented → runSalesFollowUpDrip) — HUMAN-owned lead gets NO drip message sent', async () => {
      const lead = await makeLead({ currentAgent: 'HUMAN', humanHandoff: { active: true, reason: 'explicit-request', since: new Date() } });
      const convo = await SalesConversation.create({
        businessId: new mongoose.Types.ObjectId(),
        leadPhone: lead.phone,
        phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
        leadName: '__E2E_HANDOFF_TEST__',
        status: 'active',
        consentStatus: 'granted',
        scores: { businessName: 'test', rank: null, profile: null, seo: null, review: null, competitor: null, missingKeywords: [] },
      });
      try {
        await withConfigEnabled(SalesAgentConfig, true, async () => {
          await invoke(salesNurtureConsented, { conversationId: convo._id.toString() });
        });

        const reloadedConvo = await SalesConversation.findById(convo._id).lean() as any;
        assert.equal(reloadedConvo!.messages.length, 0, 'no drip message (first-message-after-consent or any follow-up) must have been appended for a HUMAN-owned lead');
        assert.equal(reloadedConvo!.followUpsSent, 0, 'followUpsSent must not have incremented');

        const sentMsgs = await MessageQueue.find({ 'payload.phone': lead.phone }).lean();
        assert.equal(sentMsgs.length, 0, 'no send must have happened at any point in the drip');
      } finally {
        await SalesConversation.deleteOne({ _id: convo._id });
        await cleanupLead(lead._id, lead.phone);
      }
    });

    // ================================================================
    // TEST 6 — Release a low-confidence-streak handoff, then send a NEW
    // message → verify the same stale confidence streak does NOT
    // immediately cause another handoff (releaseFromHuman must have
    // cleared recentExtractionConfidences).
    // ================================================================
    await test('TEST 6: releasing a low-confidence-streak handoff does not immediately re-trigger from stale confidences', async () => {
      const { releaseFromHuman } = await import('../../src/services/leadOwnership/releaseFromHuman');
      const { checkHandoffTriggers } = await import('../../src/services/agentHandoff/checkHandoffTriggers');

      const lead = await makeLead({
        currentAgent: 'HUMAN',
        currentStage: 'HUMAN_HANDOFF',
        humanHandoff: { active: true, reason: 'low-confidence-streak', since: new Date() },
        recentExtractionConfidences: [0.1, 0.15], // the exact stale state that caused the original handoff
      });
      try {
        await releaseFromHuman(lead._id, 'SALES', 'human-released', 'test-admin', 'NURTURING');

        const released = await Lead.findById(lead._id).lean();
        assert.equal(released!.currentAgent, 'SALES');
        assert.equal(released!.humanHandoff!.active, false);
        assert.deepEqual(released!.recentExtractionConfidences, [], 'stale low-confidence streak must be cleared on release');

        // A brand-new, unrelated normal message must NOT immediately re-trigger.
        const result = await checkHandoffTriggers(lead._id, 'hi, just checking pricing again', 'sales-agent');
        assert.equal(result.handedOff, false, 'must not immediately re-hand-off from the same stale confidence streak');
      } finally {
        await cleanupLead(lead._id, lead.phone);
      }
    });

    // ================================================================
    // TEST 7 — Release a stuck-hot-lead handoff, then send a NEW message →
    // verify it does not immediately re-trigger solely from stale
    // followUpsSent state (followUpsSentAtRelease baseline must be honored).
    // ================================================================
    await test('TEST 7: releasing a stuck-hot-lead handoff does not immediately re-trigger from stale followUpsSent', async () => {
      const { releaseFromHuman } = await import('../../src/services/leadOwnership/releaseFromHuman');
      const { checkHandoffTriggers } = await import('../../src/services/agentHandoff/checkHandoffTriggers');

      const lead = await makeLead({
        currentAgent: 'HUMAN',
        currentStage: 'HUMAN_HANDOFF',
        humanHandoff: { active: true, reason: 'stuck-hot-lead', since: new Date() },
        leadScore: 85, // above the default 76 threshold
      });
      const convo = await SalesConversation.create({
        businessId: new mongoose.Types.ObjectId(),
        leadPhone: lead.phone,
        phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
        leadName: '__E2E_HANDOFF_TEST__',
        status: 'active',
        scores: { businessName: 'test', rank: null, profile: null, seo: null, review: null, competitor: null, missingKeywords: [] },
        followUpsSent: 5, // >= the default cyclesThreshold of 3 — the exact stale count that caused the original handoff
      });
      try {
        await releaseFromHuman(lead._id, 'SALES', 'human-released', 'test-admin', 'NURTURING');

        const released = await Lead.findById(lead._id).lean();
        assert.equal(released!.currentAgent, 'SALES');
        assert.equal(released!.currentStage, 'NURTURING', 'resumes into NURTURING — the stage this trigger requires, proving this is a genuine test of the re-trigger guard, not an accidental avoidance of it');
        assert.equal(released!.followUpsSentAtRelease, 5, 'must snapshot the followUpsSent count AT release time as the new baseline');
        assert.equal(released!.leadScore, 85, 'leadScore itself must NOT be reset — real lead history is preserved');

        // Same stale followUpsSent count (5), same NURTURING stage, same
        // high leadScore — must NOT immediately re-trigger, because the
        // delta against the release-time baseline is now 0.
        const result = await checkHandoffTriggers(lead._id, 'hi again', 'sales-agent');
        assert.equal(result.handedOff, false, 'must not immediately re-hand-off from the same stale followUpsSent count');

        // Sanity: if 3 MORE follow-ups genuinely happen after release, the
        // trigger must still be able to fire again — proving this is a
        // baseline, not a permanent disable of the trigger.
        await SalesConversation.updateOne({ _id: convo._id }, { $set: { followUpsSent: 8 } });
        const resultAfterMore = await checkHandoffTriggers(lead._id, 'hi again', 'sales-agent');
        assert.equal(resultAfterMore.handedOff, true, 'must be able to re-trigger once genuinely NEW follow-up cycles happen after release');
      } finally {
        await SalesConversation.deleteOne({ _id: convo._id });
        await cleanupLead(lead._id, lead.phone);
      }
    });

    // ================================================================
    // TEST 8 — Normal SALES lead (not HUMAN-owned) → verify the REAL
    // salesAgentReply.fn still reaches composeAgentReply + attempts a real
    // send, exactly as before this session's changes.
    //
    // Note on assertion strategy: TWILIO_ACCOUNT_SID/etc are deliberately
    // stripped for this whole file (see header) so sendOutboundMessage()
    // can never succeed — resolveTwilioCredentials() returns null and the
    // send fails BEFORE any network call, but a MessageQueue row IS still
    // written recording the (network-free) attempt (see
    // services/twilio/client.ts). Since every one of these functions only
    // appends to convo.messages `if (res.success)`, message-count can't be
    // the positive-control signal here without a real credential — so this
    // asserts on the MessageQueue attempt instead: a HUMAN-blocked lead
    // (TEST 1-5 above) never calls sendOutboundMessage at all (zero rows);
    // a normal lead reaches it and gets exactly one FAILED-status attempt
    // row. That difference — zero attempts vs. one attempt — is precisely
    // the "did the code path get this far" signal these positive controls
    // need, with no real WhatsApp credentials required.
    // ================================================================
    await test('TEST 8: salesAgentReply — normal SALES lead still reaches the send path (composeAgentReply + sendOutboundMessage both attempted)', async () => {
      const lead = await makeLead({ currentAgent: 'SALES', currentStage: 'NURTURING' });
      const convo = await SalesConversation.create({
        businessId: new mongoose.Types.ObjectId(),
        leadPhone: lead.phone,
        phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
        leadName: '__E2E_HANDOFF_TEST__',
        status: 'active',
        scores: { businessName: 'test', rank: 3, profile: 70, seo: 60, review: 80, competitor: null, missingKeywords: [] },
        messages: [{ role: 'lead', text: 'sounds good, tell me more', at: new Date() }],
      });
      try {
        await withConfigEnabled(SalesAgentConfig, true, async () => {
          await invoke(salesAgentReply, { conversationId: convo._id.toString(), body: 'sounds good, tell me more' });
        });

        const attempts = await MessageQueue.find({ 'payload.phone': lead.phone }).lean();
        assert.equal(attempts.length, 1, 'exactly one send attempt must have been made — proving composeAgentReply + sendOutboundMessage were both reached, unlike the HUMAN-blocked tests above');
        assert.equal((attempts[0] as any).status, 'FAILED', 'expected to fail only because Twilio credentials are deliberately stripped for this test run, not because the code path was blocked');

        const reloadedLead = await Lead.findById(lead._id).lean();
        assert.equal(reloadedLead!.currentAgent, 'SALES', 'ownership must be unaffected for a normal lead');
      } finally {
        await SalesConversation.deleteOne({ _id: convo._id });
        await cleanupLead(lead._id, lead.phone);
      }
    });

    // ================================================================
    // TEST 9 — Normal IN_HOUSE customer → verify the REAL supportAgentReply
    // still reaches composeInHouseAgentReply + attempts a real send. Same
    // MessageQueue-attempt assertion strategy as TEST 8 above.
    // ================================================================
    await test('TEST 9: supportAgentReply — normal IN_HOUSE customer still reaches the send path (composeInHouseAgentReply + sendOutboundMessage both attempted)', async () => {
      const lead = await makeLead({ currentAgent: 'IN_HOUSE', currentStage: 'CUSTOMER' });
      const convo = await SupportConversation.create({
        leadPhone: lead.phone,
        phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
        leadName: '__E2E_HANDOFF_TEST__',
        status: 'active',
        aiEnabled: true,
        messages: [{ role: 'lead', text: 'how do I update my billing?', at: new Date() }],
      });
      try {
        await invoke(supportAgentReply, { conversationId: convo._id.toString(), body: 'how do I update my billing?' });

        const attempts = await MessageQueue.find({ 'payload.phone': lead.phone }).lean();
        assert.equal(attempts.length, 1, 'exactly one send attempt must have been made for a normal IN_HOUSE customer');
        assert.equal((attempts[0] as any).status, 'FAILED', 'expected to fail only because Twilio credentials are deliberately stripped for this test run');
      } finally {
        await SupportConversation.deleteOne({ _id: convo._id });
        await cleanupLead(lead._id, lead.phone);
      }
    });

    // ================================================================
    // TEST 10 — Normal Report lead → verify the REAL reportAgentReply still
    // reaches sendOutboundMessage (deterministic 'connected' status reply —
    // no Groq call needed for this branch, see file header). Same
    // MessageQueue-attempt assertion strategy as TEST 8/9 above.
    // ================================================================
    await test('TEST 10: reportAgentReply — normal (non-human-owned) lead still reaches the send path', async () => {
      const lead = await makeLead({ currentAgent: 'DEMO', currentStage: 'DEMO_REQUESTED' });
      const convo = await ReportConversation.create({
        leadPhone: lead.phone,
        phoneKey: lead.phone.replace(/\D/g, '').slice(-10),
        leadName: '__E2E_HANDOFF_TEST__',
        status: 'connected',
        messages: [
          { role: 'agent', text: 'connected!', at: new Date() },
          { role: 'lead', text: 'any update?', at: new Date() },
        ],
      });
      try {
        await withConfigEnabled(ReportAgentConfig, true, async () => {
          await invoke(reportAgentReply, { conversationId: convo._id.toString(), body: 'any update?' });
        });

        const attempts = await MessageQueue.find({ 'payload.phone': lead.phone }).lean();
        assert.equal(attempts.length, 1, 'exactly one send attempt must have been made for a normal, non-human-owned report lead');
        assert.equal((attempts[0] as any).status, 'FAILED', 'expected to fail only because Twilio credentials are deliberately stripped for this test run');
      } finally {
        await ReportConversation.deleteOne({ _id: convo._id });
        await cleanupLead(lead._id, lead.phone);
      }
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }

  await run();
}

main().catch((e) => {
  console.error('Test run failed:', e);
  process.exit(1);
});
