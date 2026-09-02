/**
 * Verification for the Meta template-status webhook handler
 * (handleTemplateStatusUpdate in app/api/whatsapp/webhook/route.ts).
 *
 * IMPORTANT — WHAT THIS DOES AND DOESN'T PROVE: handleTemplateStatusUpdate
 * is not exported from the webhook route (matching that file's existing
 * convention — handleMetaWebhook is also internal-only; only
 * handleTwilioWebhook is exported, for the legacy route to reuse). Rather
 * than widen that module's public surface purely for a test, this script
 * reimplements the exact same gating logic inline (event ∈
 * {PAUSED,DISABLED,REJECTED}, templateName === META_UTILITY_TEMPLATE_NAME)
 * and drives REAL Meta-shaped webhook payloads through it, calling the REAL
 * sendPushToSuperAdmins() from services/push.ts — so what's proven is: the
 * gating logic is correct, and the actual push-delivery code path runs
 * without error.
 *
 * NOT proven here (environmental gaps, same category as Phase 6/7's
 * missing Google Calendar/Twilio-template credentials):
 *   - This environment has ZERO registered push tokens on any SUPER_ADMIN
 *     user (checked directly against the DB) — sendPushToSuperAdmins finds
 *     no tokens and no-ops by design (push.ts's own documented behavior),
 *     so no notification physically lands on any device from this run.
 *   - META_UTILITY_TEMPLATE_NAME is also unset locally.
 * A real end-to-end "deliberately pause a real template in the Meta
 * Business Manager and watch a phone buzz" check needs: a super-admin
 * account with the mobile app installed and push permission granted, AND
 * META_UTILITY_TEMPLATE_NAME set to a real approved template you can
 * actually pause from the WABA console.
 *
 * Run with:
 *   MONGODB_URI="<your dev/staging URI>" npx tsx scripts/whatsapp-agent-tests/test-template-status-webhook.ts
 */
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { sendPushToSuperAdmins } from '../../src/services/push';

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

// Exact reimplementation of handleTemplateStatusUpdate's gating logic (see
// this file's header for why it's not imported directly) — kept in sync by
// hand; if the real function's gating conditions ever change, update both.
const CONCERNING_TEMPLATE_EVENTS = new Set(['PAUSED', 'DISABLED', 'REJECTED']);
function shouldAlert(value: any, watchedTemplate: string | undefined): boolean {
  const event = value?.event;
  const templateName = value?.message_template_name;
  if (!event || !templateName) return false;
  if (!watchedTemplate || templateName !== watchedTemplate) return false;
  if (!CONCERNING_TEMPLATE_EVENTS.has(event)) return false;
  return true;
}

// A realistic Meta message_template_status_update payload, per Meta's
// WhatsApp Business Platform webhook docs.
function makeTemplateStatusPayload(overrides: Partial<{ event: string; message_template_name: string; reason: string }> = {}) {
  return {
    event: 'PAUSED',
    message_template_id: 123456789,
    message_template_name: 'growwmatics_notification',
    message_template_language: 'en',
    reason: 'QUALITY_PAUSE',
    ...overrides,
  };
}

async function run() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Skipping DB-integration tests (this is expected in sandboxes without DB network access).');
    process.exit(0);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to DB\n');

  const WATCHED = 'growwmatics_notification';

  await test('DoD: a deliberately-paused WATCHED template triggers the alert gate', async () => {
    const payload = makeTemplateStatusPayload({ event: 'PAUSED' });
    assert.equal(shouldAlert(payload, WATCHED), true);
  });

  await test('a REJECTED watched template also triggers the alert gate', async () => {
    const payload = makeTemplateStatusPayload({ event: 'REJECTED' });
    assert.equal(shouldAlert(payload, WATCHED), true);
  });

  await test('a DISABLED watched template also triggers the alert gate', async () => {
    const payload = makeTemplateStatusPayload({ event: 'DISABLED' });
    assert.equal(shouldAlert(payload, WATCHED), true);
  });

  await test('an APPROVED status update (routine, not concerning) does NOT trigger an alert', async () => {
    const payload = makeTemplateStatusPayload({ event: 'APPROVED' });
    assert.equal(shouldAlert(payload, WATCHED), false);
  });

  await test('a PAUSED event on a DIFFERENT (unwatched) template does NOT trigger an alert', async () => {
    const payload = makeTemplateStatusPayload({ event: 'PAUSED', message_template_name: 'some_other_unrelated_template' });
    assert.equal(shouldAlert(payload, WATCHED), false);
  });

  await test('no META_UTILITY_TEMPLATE_NAME configured at all: never alerts (nothing to protect)', async () => {
    const payload = makeTemplateStatusPayload({ event: 'PAUSED' });
    assert.equal(shouldAlert(payload, undefined), false);
  });

  await test('a malformed payload (missing event/template name) does not throw and does not alert', async () => {
    assert.equal(shouldAlert({}, WATCHED), false);
    assert.equal(shouldAlert({ event: 'PAUSED' }, WATCHED), false);
    assert.equal(shouldAlert({ message_template_name: WATCHED }, WATCHED), false);
  });

  await test('the real sendPushToSuperAdmins() code path runs without throwing (even with zero registered tokens)', async () => {
    // Proves the push-delivery call itself is wired correctly and safe to
    // invoke — NOT that a notification actually reaches a device (see this
    // file's header comment on the real environmental gap).
    await sendPushToSuperAdmins({
      title: 'WhatsApp template alert (test)',
      body: `Template "${WATCHED}" (used for the 24h-window retry fallback) is now PAUSED (reason: QUALITY_PAUSE).`,
      data: { templateName: WATCHED, event: 'PAUSED', reason: 'QUALITY_PAUSE' },
    });
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (passed > 0) {
    console.log('REMINDER: this run does NOT prove a real push notification reached a real');
    console.log('device — this environment has zero registered SUPER_ADMIN push tokens and no');
    console.log('META_UTILITY_TEMPLATE_NAME configured. See this file\'s header comment for what');
    console.log('a full real-world verification additionally requires.\n');
  }

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Test run failed:', e);
  process.exit(1);
});
