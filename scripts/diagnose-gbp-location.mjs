// Diagnose why GBPToken.locationId is empty.
// Run: node scripts/diagnose-gbp-location.mjs
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';

// --- Load .env.local manually ---
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1].trim()] = v;
}

// --- Decrypt (mirror of src/lib/crypto.ts) ---
function decrypt(ciphertext) {
  const key = Buffer.from(process.env.GOOGLE_TOKEN_SECRET, 'hex');
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex')).toString('utf8') + decipher.final('utf8');
}

async function getAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token refresh ${res.status}: ${text}`);
  return JSON.parse(text).access_token;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const tokens = await mongoose.connection.db.collection('gbptokens').find({}).toArray();
  console.log(`\nFound ${tokens.length} GBPToken document(s).\n`);

  for (const t of tokens) {
    console.log('════════════════════════════════════════════════════════');
    console.log(`businessId:  ${t.businessId}`);
    console.log(`googleEmail: ${t.googleEmail}`);
    console.log(`accountId:   ${t.accountId || '(empty)'}`);
    console.log(`locationId:  ${t.locationId || '(EMPTY ← this is the problem)'}`);
    console.log(`scopes:      ${(t.scopes || []).join(', ')}`);

    let accessToken;
    try {
      accessToken = await getAccessToken(decrypt(t.refreshToken));
      console.log('✅ token refresh OK');
    } catch (e) {
      console.log('❌ token refresh FAILED:', e.message);
      continue;
    }
    const auth = { headers: { Authorization: `Bearer ${accessToken}` } };

    // 1) List every account this Google user can see
    const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', auth);
    const accText = await accRes.text();
    console.log(`\n[accounts.list] HTTP ${accRes.status}`);
    if (!accRes.ok) { console.log(accText); continue; }
    const accounts = JSON.parse(accText).accounts ?? [];
    console.log(`  ${accounts.length} account(s):`);
    accounts.forEach((a) => console.log(`   - ${a.name}  type=${a.type}  role=${a.role}  "${a.accountName}"`));

    // 2) For EACH account, list its locations
    for (const a of accounts) {
      const locUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,metadata&pageSize=100`;
      const locRes = await fetch(locUrl, auth);
      const locText = await locRes.text();
      console.log(`\n  [locations.list ${a.name}] HTTP ${locRes.status}`);
      if (!locRes.ok) { console.log('    ' + locText.replace(/\n/g, '\n    ')); continue; }
      const locs = JSON.parse(locText).locations ?? [];
      console.log(`    ${locs.length} location(s):`);
      locs.forEach((l) => console.log(`     - ${l.name}  "${l.title}"  placeId=${l.metadata?.placeId ?? '?'}`));
    }
    console.log('');
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
