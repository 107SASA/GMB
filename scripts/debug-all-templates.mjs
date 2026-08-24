// Tests all 4 GrowwMatics Twilio Content Templates via the Messaging Service,
// waits, then re-checks FINAL async status (sync "queued" response is not
// trustworthy — see scripts/debug-content-send.mjs in the repo).
import twilioLib from 'twilio';
import fs from 'fs';

const envText = fs.readFileSync('d:/GMBNEW/GMBBoost-audit-engine/.env.local', 'utf8');
const get = (key) => (envText.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');

const sid = get('TWILIO_ACCOUNT_SID');
const authToken = get('TWILIO_AUTH_TOKEN');
const messagingServiceSid = get('TWILIO_MESSAGING_SERVICE_SID');
const to = process.argv[2];
if (!to) { console.error('Usage: node debug-all-templates.mjs +91XXXXXXXXXX'); process.exit(1); }

const templates = {
  salesIntro: { sid: get('TWILIO_TEMPLATE_SALES_INTRO'), vars: { '1': 'Test', '2': 'Mulsetu' } },
  reportReady: { sid: get('TWILIO_TEMPLATE_REPORT_READY'), vars: { '1': 'Test', '2': 'Mulsetu', '3': 'abc123' } },
  reviewRequest: { sid: get('TWILIO_TEMPLATE_REVIEW_REQUEST'), vars: { '1': 'Test', '2': 'Mulsetu', '3': 'ChIJ4blskkPD3TsRUq38wbsts6U' } },
  notification: { sid: get('TWILIO_TEMPLATE_NOTIFICATION'), vars: { '1': 'Test', '2': 'Diagnostic message.' } },
};

const client = twilioLib(sid, authToken);

for (const [name, t] of Object.entries(templates)) {
  console.log(`\n=== ${name} (${t.sid}) ===`);
  try {
    const message = await client.messages.create({
      to: `whatsapp:${to}`,
      messagingServiceSid,
      contentSid: t.sid,
      contentVariables: JSON.stringify(t.vars),
    });
    console.log(`create() ok, SID: ${message.sid}, initial status: ${message.status}`);
    await new Promise((r) => setTimeout(r, 5000));
    const final = await client.messages(message.sid).fetch();
    console.log('final status:', final.status, '| errorCode:', final.errorCode, '| errorMessage:', final.errorMessage);
  } catch (e) {
    console.log('FAILED AT CREATE — code:', e.code, 'message:', e.message);
  }
}
