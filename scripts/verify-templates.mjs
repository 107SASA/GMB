/**
 * Sends ONE real WhatsApp message per configured Twilio Content Template to a
 * test number, then re-fetches each after a delay to check its FINAL async
 * status (the synchronous "queued" response lies — it said queued while
 * messages were actually failing 63027; see debug-content-send.mjs).
 *
 * Auto-loads the project env files so it tests exactly what the app would
 * send. Order of precedence for this verification script: .env.production
 * wins (that's the config we're verifying), then .env.local fills any gaps,
 * then anything already exported in the shell. No dotenv dependency — same
 * tiny manual loader style as scripts/notifyIncompleteIntake.mjs.
 *
 * Sends a REAL message to the number you pass. Use a number you control.
 * No app-DB writes (talks to Twilio directly). Does not touch application
 * code, the database, or LEAD_ENGINE_V2.
 *
 * Run (Windows PowerShell, cmd, or bash — all the same):
 *   node scripts/verify-templates.mjs +91XXXXXXXXXX
 *
 * Optional 2nd arg tests only one template:
 *   node scripts/verify-templates.mjs +91XXXXXXXXXX notification
 *
 * Optional: force .env.local instead of .env.production:
 *   node scripts/verify-templates.mjs +91XXXXXXXXXX --local
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import twilioLib from 'twilio';

// Project root = one level up from this script's dir, so it works no matter
// what the current working directory is (PowerShell included).
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

const forceLocal = process.argv.includes('--local');

/**
 * Minimal .env reader. Handles CRLF, quotes, and a trailing " # comment"
 * (only when the # is preceded by whitespace, the dotenv convention — a #
 * inside a value like a URL fragment is kept). First file to set a key wins,
 * so call the preferred file first.
 */
function loadEnv(absPath) {
  if (!fs.existsSync(absPath)) return false;
  let loaded = 0;
  for (const rawLine of fs.readFileSync(absPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*export\s+/, '');
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    // strip a trailing whitespace-preceded comment on unquoted values
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '');
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) { process.env[m[1]] = v; loaded++; }
  }
  return loaded >= 0;
}

const prodPath = path.join(PROJECT_ROOT, '.env.production');
const localPath = path.join(PROJECT_ROOT, '.env.local');
const primary = forceLocal ? localPath : prodPath;
const secondary = forceLocal ? prodPath : localPath;

const primaryOk = loadEnv(primary);
const secondaryOk = loadEnv(secondary);
console.log(
  `env loaded: ${primaryOk ? path.basename(primary) : `(${path.basename(primary)} not found)`}` +
  (secondaryOk ? ` + ${path.basename(secondary)} (fallback)` : '')
);

const sid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

// positional args, ignoring any --flags
const positionals = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const to = positionals[0];
const only = positionals[1];

if (!to) {
  console.error('Usage: node scripts/verify-templates.mjs +91XXXXXXXXXX [templateKey] [--local]');
  process.exit(1);
}
const missing = [];
if (!sid) missing.push('TWILIO_ACCOUNT_SID');
if (!authToken) missing.push('TWILIO_AUTH_TOKEN');
if (!messagingServiceSid) missing.push('TWILIO_MESSAGING_SERVICE_SID');
if (missing.length) {
  console.error(`Missing from the loaded env file(s): ${missing.join(', ')}`);
  console.error('Check that .env.production (or .env.local with --local) exists at the project root and defines them.');
  process.exit(1);
}

// key -> { env var, sample contentVariables matching the approved var order
// documented in src/lib/whatsappTemplates.ts }
const TEMPLATES = {
  salesIntro:      { env: 'TWILIO_TEMPLATE_SALES_INTRO',      vars: { '1': 'Test Lead', '2': 'Test Business' } },
  reportReady:     { env: 'TWILIO_TEMPLATE_REPORT_READY',     vars: { '1': 'Test Lead', '2': 'Test Business', '3': '000000000000000000000000' } },
  reviewRequest:   { env: 'TWILIO_TEMPLATE_REVIEW_REQUEST',   vars: { '1': 'Test Customer', '2': 'Test Business', '3': 'ChIJTESTPLACEID' } },
  notification:    { env: 'TWILIO_TEMPLATE_NOTIFICATION',     vars: { '1': 'there', '2': 'This is a template-verification test. No action needed.' } },
  invoiceReady:    { env: 'TWILIO_TEMPLATE_INVOICE_READY',    vars: { '1': 'Test Customer' } },
  welcomeCustomer: { env: 'TWILIO_TEMPLATE_WELCOME_CUSTOMER', vars: { '1': 'Test Customer' } },
};

const client = twilioLib(sid, authToken);
const keys = only ? [only] : Object.keys(TEMPLATES);
const sent = [];

for (const key of keys) {
  const spec = TEMPLATES[key];
  if (!spec) { console.log(`? unknown template key "${key}" — skipping`); continue; }
  const contentSid = process.env[spec.env];
  if (!contentSid) { console.log(`- ${key.padEnd(16)} ${spec.env} not set — skipping`); continue; }

  try {
    const msg = await client.messages.create({
      to: `whatsapp:${to}`,
      messagingServiceSid,
      contentSid,
      contentVariables: JSON.stringify(spec.vars),
    });
    console.log(`→ ${key.padEnd(16)} ${contentSid}  created: ${msg.status}  sid=${msg.sid}`);
    sent.push({ key, contentSid, sid: msg.sid });
  } catch (e) {
    console.log(`✗ ${key.padEnd(16)} ${contentSid}  CREATE FAILED  code=${e.code}  ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1500)); // gentle pacing
}

if (!sent.length) {
  console.log('\nNothing was sent.');
  process.exit(0);
}

console.log(`\nWaiting 12s for async delivery status on ${sent.length} message(s)...`);
await new Promise((r) => setTimeout(r, 12000));

console.log('\n=== FINAL STATUS ===');
let allGood = true;
for (const s of sent) {
  const f = await client.messages(s.sid).fetch();
  const ok = ['delivered', 'sent', 'read'].includes(f.status);
  if (!ok) allGood = false;
  console.log(
    `${ok ? '✅' : '❌'} ${s.key.padEnd(16)} status=${f.status}` +
    (f.errorCode ? `  errorCode=${f.errorCode}  ${f.errorMessage}` : '')
  );
}
console.log(allGood
  ? '\n✅ All tested templates delivered — safe to proceed.'
  : '\n❌ At least one template failed — do NOT rely on that send path yet. 63027 = wrong-WABA / not approved.');
