/**
 * Fail-closed MongoDB target for the native-job staging/smoke tests.
 *
 * Unlike scripts/lib/localTestEnv.mjs this helper:
 *   - loads NO env files (never touches .env.local / .env.production, so no
 *     production secrets enter the test process);
 *   - requires TEST_MONGODB_URI to be set EXPLICITLY (never falls back to
 *     MONGODB_URI);
 *   - requires every host in that URI to be loopback (127.0.0.1, localhost,
 *     ::1) unless ALLOW_REMOTE_TEST_DB=1 is supplied;
 *   - forces the database name (default: a disposable name) and refuses any
 *     name containing "prod".
 *
 * `uri.path` is rewritten, credentials/query are preserved untouched.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function parseHosts(uri) {
  const m = String(uri || '').match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i);
  if (!m) return null;
  return m[1].split(',').map((h) => h.trim().toLowerCase().replace(/:\d+$/, ''));
}

/**
 * @param {{ dbName: string, env?: Record<string,string|undefined> }} opts
 * @returns {string} a mongodb URI whose database is `dbName`
 */
export function resolveLoopbackTestUri({ dbName, env = process.env }) {
  const raw = env.TEST_MONGODB_URI;
  if (!raw) {
    throw new Error(
      'TEST_MONGODB_URI is not set. These tests never fall back to MONGODB_URI or .env files. ' +
        'Start a local mongod and set TEST_MONGODB_URI=mongodb://127.0.0.1:<port>/x?directConnection=true'
    );
  }
  const hosts = parseHosts(raw);
  if (!hosts || !hosts.length) throw new Error('TEST_MONGODB_URI could not be parsed');
  const remote = hosts.filter((h) => !LOOPBACK.has(h));
  if (remote.length && env.ALLOW_REMOTE_TEST_DB !== '1') {
    throw new Error(
      `Refusing non-loopback test database host(s): ${remote.join(', ')}. ` +
        'Use a local mongod, or set ALLOW_REMOTE_TEST_DB=1 to override deliberately.'
    );
  }
  if (/prod/i.test(dbName)) throw new Error(`Refusing test database name "${dbName}" (looks like production)`);
  const m = raw.match(/^(mongodb(?:\+srv)?:\/\/[^/?]+)(\/[^?]*)?(\?.*)?$/i);
  if (!m) throw new Error('TEST_MONGODB_URI could not be parsed');
  return `${m[1]}/${dbName}${m[3] || ''}`;
}
