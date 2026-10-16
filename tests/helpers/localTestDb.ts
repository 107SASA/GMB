/**
 * Fail-closed guard for tests that WRITE to a MongoDB other than a throwaway
 * in-memory server. Only an explicitly configured, local, single-host test
 * database passes; Atlas, remote hosts and anything ambiguous are refused.
 *
 *   MONGODB_LOCAL_TEST_URI=mongodb://127.0.0.1:27017/growwmatics_local
 *
 * Accepted: scheme `mongodb://` (never `mongodb+srv://`, which always resolves
 * through DNS to a remote cluster), exactly one host that is 127.0.0.1,
 * localhost or [::1], and a database name containing "test" or "local".
 * No imports — runs under plain Node.
 */

export const LOCAL_TEST_DB_ENV = 'MONGODB_LOCAL_TEST_URI';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export type GuardResult = { ok: true; uri: string; dbName: string } | { ok: false; reason: string };

export function checkLocalTestDatabase(raw: string | undefined | null): GuardResult {
  const uri = String(raw ?? '').trim();
  if (!uri) return { ok: false, reason: `${LOCAL_TEST_DB_ENV} is not set — refusing to guess a database` };
  if (/\s/.test(uri)) return { ok: false, reason: 'URI contains whitespace' };
  if (/^mongodb\+srv:/i.test(uri)) return { ok: false, reason: 'mongodb+srv:// is a DNS-resolved remote cluster (Atlas) — refused' };
  if (!uri.startsWith('mongodb://')) return { ok: false, reason: 'only a mongodb:// URI is accepted' };
  if (/mongodb\.net/i.test(uri)) return { ok: false, reason: 'Atlas host (mongodb.net) — refused' };

  const rest = uri.slice('mongodb://'.length);
  const slash = rest.indexOf('/');
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const hostPart = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  if (!hostPart || hostPart.includes(',')) return { ok: false, reason: 'exactly one host is required (replica-set / multi-host URIs are ambiguous)' };

  const host = hostPart.startsWith('[') ? hostPart.slice(0, hostPart.indexOf(']') + 1) : hostPart.split(':')[0];
  const port = hostPart.slice(host.length);
  if (!LOCAL_HOSTS.has(host.toLowerCase())) return { ok: false, reason: `host "${host}" is not local (127.0.0.1, localhost or [::1] only)` };
  if (port && !/^:\d{1,5}$/.test(port)) return { ok: false, reason: 'malformed port' };

  const path = slash === -1 ? '' : rest.slice(slash + 1);
  const dbName = decodeURIComponent(path.split('?')[0]);
  if (!dbName) return { ok: false, reason: 'a database name is required (the default "test" database is ambiguous)' };
  if (!/^[A-Za-z0-9_-]+$/.test(dbName)) return { ok: false, reason: `database name "${dbName}" has unexpected characters` };
  if (!/test|local/i.test(dbName)) return { ok: false, reason: `database "${dbName}" is not named as a test/local database` };

  return { ok: true, uri, dbName };
}

/**
 * Throws unless MONGODB_LOCAL_TEST_URI passes, and — when the app under test
 * reads its own MONGODB_URI (e.g. a running dev server) — unless that is the
 * SAME database, so the server cannot write somewhere else.
 */
export function requireLocalTestDatabase(env: Record<string, string | undefined>, serverUri?: string | null): { uri: string; dbName: string } {
  const r = checkLocalTestDatabase(env[LOCAL_TEST_DB_ENV]);
  if (!r.ok) throw new Error(`[local-test-db] ${r.reason}`);
  if (serverUri !== undefined) {
    const server = checkLocalTestDatabase(serverUri);
    if (!server.ok) throw new Error(`[local-test-db] the app's MONGODB_URI is not a local test database: ${server.reason}`);
    if (server.uri !== r.uri) throw new Error(`[local-test-db] the app's MONGODB_URI differs from ${LOCAL_TEST_DB_ENV} — both must name the same local database`);
  }
  return { uri: r.uri, dbName: r.dbName };
}
