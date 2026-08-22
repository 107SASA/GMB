/**
 * Tests a Content Template send via the Messaging Service (instead of a raw
 * `from` number), AND — unlike the first version of this script — waits and
 * re-fetches the message to check its FINAL async status, not just the
 * synchronous API response. That sync response is what fooled us earlier:
 * it said "queued" with no error while the message was actually failing
 * moments later with 63027. Don't repeat that mistake here.
 *
 * Run:
 *   TWILIO_ACCOUNT_SID="..." TWILIO_AUTH_TOKEN="..." node scripts/debug-content-send.mjs +91XXXXXXXXXX
 */
import twilioLib from 'twilio';

const sid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const to = process.argv[2];
const messagingServiceSid = 'MG0eec997ac6a478600b9b4a91eb17c426';

if (!sid || !authToken || !to) {
  console.error('Usage: TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... node scripts/debug-content-send.mjs +91XXXXXXXXXX');
  process.exit(1);
}

const client = twilioLib(sid, authToken);

try {
  const message = await client.messages.create({
    to: `whatsapp:${to}`,
    messagingServiceSid,
    contentSid: 'HX9473a6f09464e976ac9234e9e3d2df1c',
    contentVariables: JSON.stringify({ '1': 'there', '2': 'Messaging Service test message.' }),
  });
  console.log(`Sent, SID: ${message.sid}, initial status: ${message.status} (this is NOT the final answer — checking again in 5s...)`);

  await new Promise((r) => setTimeout(r, 5000));

  const final = await client.messages(message.sid).fetch();
  console.log('\n=== FINAL STATUS (5s later) ===');
  console.log('status:', final.status);
  console.log('errorCode:', final.errorCode);
  console.log('errorMessage:', final.errorMessage);
  console.log(final.status === 'delivered' || final.status === 'sent' || final.status === 'read'
    ? '\n✅ Actually delivered — Messaging Service fix confirmed working.'
    : '\n❌ Still failing — Messaging Service did not fix it.');
} catch (e) {
  console.log('\n=== FAILED AT CREATE ===');
  console.log('code:', e.code, 'message:', e.message);
}
