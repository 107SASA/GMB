/**
 * READ-ONLY: which Google-connected customers does Google actually refuse?
 * (Michelle Costar case — signed in, but 403 on every Google request.)
 *
 *   cd /var/www/gmbboost
 *   export MURI=$(grep '^MONGODB_URI=' .env.production | cut -d= -f2- | tr -d "\"'")
 *   NODE_PATH=$PWD/node_modules node scripts/google-access-affected.mjs
 *
 * Prints one line per connected business: recorded access state, whether a
 * sync ever succeeded, what Google said on the profile read, and the work that
 * was created anyway (first report, scheduled / failed posts). Writes nothing.
 * After the release, each business's next sync (≤ 6 h) records its real state
 * automatically; this list is for checking that, and for the earlier cases.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoClient } = require('mongodb');

const uri = process.env.MURI || process.env.MONGODB_URI;
if (!uri) {
  console.error('Set MURI (or MONGODB_URI) first.');
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db();
  const businesses = await db.collection('businesses')
    .find({ googleConnected: true, isDeleted: { $ne: true } }, { projection: { name: 1, googleAccess: 1, subscriptionStatus: 1 } })
    .toArray();

  const rows = [];
  for (const b of businesses) {
    const [token, snap, scheduled, failed, baseline] = await Promise.all([
      db.collection('gbptokens').findOne({ businessId: b._id }, { projection: { lastSyncAt: 1, googleEmail: 1, connectedAt: 1, locationId: 1 } }),
      db.collection('gbplocationsnapshots').findOne({ businessId: b._id }, { projection: { 'sections.location.meta': 1, locationId: 1 } }),
      db.collection('posts').countDocuments({ businessId: b._id, status: 'scheduled' }),
      db.collection('posts').countDocuments({ businessId: b._id, status: 'failed' }),
      db.collection('audits').countDocuments({ businessId: b._id, auditKind: 'connected_baseline' }),
    ]);
    const loc = snap?.sections?.location?.meta;
    const google = loc ? `${loc.status}${loc.error ? ` ${loc.error.httpStatus ?? ''} ${loc.error.category}` : ''}` : 'no snapshot';
    const state = b.googleAccess?.state ?? '(none yet)';
    const suspect = state === 'blocked' || state === 'limited' ||
      (state !== 'verified' && (!token?.lastSyncAt || /AUTHORIZATION|NOT_FOUND/.test(google)));
    rows.push({
      suspect: suspect ? 'YES' : '',
      business: String(b.name || '').slice(0, 28),
      id: String(b._id),
      access: `${state}${b.googleAccess?.reason ? `/${b.googleAccess.reason}` : ''}`,
      lastSync: token?.lastSyncAt ? new Date(token.lastSyncAt).toISOString().slice(0, 10) : 'never',
      google,
      firstReport: baseline ? 'yes' : '',
      scheduled,
      failed,
    });
  }
  rows.sort((a, b) => (b.suspect ? 1 : 0) - (a.suspect ? 1 : 0));
  console.table(rows);
  const n = rows.filter((r) => r.suspect).length;
  console.log(`${businesses.length} connected businesses, ${n} where Google refuses or never confirmed access.`);
} finally {
  await client.close();
}
