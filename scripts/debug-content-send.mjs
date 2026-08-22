/**
 * Isolates whether the Twilio Node SDK itself (not our app's wrapper code)
 * is constructing a different request than the raw REST call that just
 * succeeded — with debug logging on, so we see the EXACT outgoing request.
 *
 * Run:
 *   TWILIO_ACCOUNT_SID="..." TWILIO_AUTH_TOKEN="..." node scripts/debug-content-send.mjs +91XXXXXXXXXX
 */
import twilioLib from 'twilio';

const sid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const to = process.argv[2];

if (!sid || !authToken || !to) {
  console.error('Usage: TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... node scripts/debug-content-send.mjs +91XXXXXXXXXX');
  process.exit(1);
}

const client = twilioLib(sid, authToken, { logLevel: 'debug' });

try {
  const message = await client.messages.create({
    from: 'whatsapp:+919405070323',
    to: `whatsapp:${to}`,
    contentSid: 'HX9473a6f09464e976ac9234e9e3d2df1c',
    contentVariables: JSON.stringify({ '1': 'there', '2': 'SDK debug test message.' }),
  });
  console.log('\n=== SUCCESS ===');
  console.log(JSON.stringify(message, null, 2));
} catch (e) {
  console.log('\n=== FAILED ===');
  console.log('code:', e.code);
  console.log('message:', e.message);
  console.log('moreInfo:', e.moreInfo);
  console.log('status:', e.status);
  console.log('details:', e.details);
}
