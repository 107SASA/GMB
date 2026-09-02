/**
 * Shared helper for the local Lead Engine test scripts.
 *
 * SAFETY MODEL:
 *  - Loads .env.local (then .env.production as fallback ONLY for values not
 *    in .env.local, e.g. Twilio creds), so the same secrets the app uses are
 *    available WITHOUT copying them into a new file.
 *  - Rewrites the Mongo connection string to target a DEDICATED test database
 *    (default: "growwmatics_local_test") regardless of what DB the URI
 *    originally named. This is DB-level isolation on the same cluster — the
 *    same approach the prod split uses.
 *  - HARD REFUSES to proceed if the resolved DB name looks like production
 *    ("prod" substring) unless ALLOW_PROD_DB=iunderstand is explicitly set.
 *  - Prints the target DB name (never the credentials) on every run.
 *
 * Override the test DB name with TEST_DB_NAME. Override the whole URI with
 * TEST_MONGODB_URI (still subject to the prod-name guard).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

function loadEnvFile(absPath) {
  if (!fs.existsSync(absPath)) return;
  for (const rawLine of fs.readFileSync(absPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*export\s+/, '');
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '');
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

export function loadLocalEnv() {
  loadEnvFile(path.join(PROJECT_ROOT, '.env.local'));
  loadEnvFile(path.join(PROJECT_ROOT, '.env.production'));
}

/**
 * Returns a Mongo URI guaranteed to point at a non-prod test database.
 * Throws (with a clear message) rather than ever returning a prod URI.
 */
export function resolveTestMongoUri() {
  loadLocalEnv();
  const testDbName = process.env.TEST_DB_NAME || 'growwmatics_local_test';
  const raw = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI;
  if (!raw) throw new Error('No MONGODB_URI / TEST_MONGODB_URI found in env (.env.local).');

  // Split off any existing "/dbname" and "?query" so we can force our own db.
  // mongodb+srv://user:pass@host/db?opts   OR   mongodb://user:pass@h1,h2/db?opts
  const schemeMatch = raw.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)(\/[^?]*)?(\?.*)?$/i);
  let rewritten;
  if (schemeMatch) {
    const [, base, , query] = schemeMatch;
    rewritten = `${base}/${testDbName}${query || ''}`;
  } else {
    // Unrecognized shape — refuse rather than guess.
    throw new Error('Could not parse MONGODB_URI to force a test database name.');
  }

  const dbInUri = rewritten.match(/\/([^/?]+)(\?|$)/)?.[1] || '(none)';
  if (/prod/i.test(dbInUri) && process.env.ALLOW_PROD_DB !== 'iunderstand') {
    throw new Error(
      `Refusing to run: resolved test DB name "${dbInUri}" looks like production. ` +
      `Set TEST_DB_NAME to something safe, or (only if you REALLY mean it) ALLOW_PROD_DB=iunderstand.`
    );
  }

  console.log(`[local-test] target database: ${dbInUri}  (cluster creds from .env.local, not shown)`);
  return rewritten;
}

export const TEST_TENANT_ID = 'gmbboost-internal';
