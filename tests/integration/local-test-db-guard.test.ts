/**
 * The local-test-database guard (tests/helpers/localTestDb.ts) — pure, no
 * database is contacted.
 * Run: node --experimental-strip-types --test tests/integration/local-test-db-guard.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkLocalTestDatabase, requireLocalTestDatabase } from '../helpers/localTestDb.ts';

const LOCAL = 'mongodb://127.0.0.1:27017/growwmatics_local';

test('accepts an explicit local single-host test database', () => {
  for (const uri of [
    LOCAL,
    'mongodb://localhost:27017/gm_test',
    'mongodb://localhost/invite_test',
    'mongodb://[::1]:27017/growwmatics_test',
    'mongodb://user:pass@127.0.0.1:27017/growwmatics_local?authSource=admin',
  ]) {
    const r = checkLocalTestDatabase(uri);
    assert.equal(r.ok, true, `${uri}: ${!r.ok ? r.reason : ''}`);
  }
});

test('refuses Atlas, remote hosts and ambiguous URIs', () => {
  for (const [uri, why] of [
    [undefined, /not set/],
    ['', /not set/],
    ['mongodb+srv://u:p@cluster0.abcde.mongodb.net/growwmatics_dev', /srv/],
    ['mongodb://u:p@ac-x-shard-00-00.abc.mongodb.net:27017/growwmatics_test', /Atlas/],
    ['mongodb://127.0.0.1:27017,127.0.0.1:27018/gm_test', /exactly one host/],
    ['mongodb://10.0.0.5:27017/gm_test', /not local/],
    ['mongodb://db.internal:27017/gm_test', /not local/],
    ['mongodb://localhost.evil.example:27017/gm_test', /not local/],
    ['mongodb://127.0.0.1.nip.io/gm_test', /not local/],
    ['mongodb://127.0.0.1:27017', /database name is required/],
    ['mongodb://127.0.0.1:27017/', /database name is required/],
    ['mongodb://127.0.0.1:27017/growwmatics_dev', /not named as a test\/local/],
    ['mongodb://127.0.0.1:27017/growwmatics', /not named as a test\/local/],
    ['mongodb://127.0.0.1:27017/gm%2Ftest', /unexpected characters/],
    ['mongodb://127.0.0.1:abc/gm_test', /malformed port/],
    [' mongodb://127.0.0.1/gm_test x', /whitespace/],
    ['postgres://127.0.0.1/gm_test', /only a mongodb/],
  ] as const) {
    const r = checkLocalTestDatabase(uri as any);
    assert.equal(r.ok, false, String(uri));
    assert.match((r as any).reason, why, String(uri));
  }
});

test('the app under test must use the same local database', () => {
  const env = { MONGODB_LOCAL_TEST_URI: LOCAL };
  assert.deepEqual(requireLocalTestDatabase(env, LOCAL), { uri: LOCAL, dbName: 'growwmatics_local' });
  assert.throws(() => requireLocalTestDatabase(env, 'mongodb+srv://u:p@cluster0.x.mongodb.net/growwmatics_dev'), /not a local test database/);
  assert.throws(() => requireLocalTestDatabase(env, 'mongodb://127.0.0.1:27017/other_test'), /differs/);
  assert.throws(() => requireLocalTestDatabase({}, LOCAL), /not set/);
});

test('the admin-invite test is guarded and out of the default integration run', () => {
  assert.equal(fs.existsSync('tests/integration/admin-invite-accept.test.ts'), false, 'not under tests/integration');
  const src = fs.readFileSync('tests/local-db/admin-invite-accept.test.ts', 'utf8');
  assert.match(src, /requireLocalTestDatabase\(process\.env, serverMongoUri\(\)\)/);
  // The guard runs before the first connection or write.
  assert.ok(src.indexOf('requireLocalTestDatabase(') < src.indexOf('mongoose.connect('));
  assert.doesNotMatch(src, /loadEnvLocal\(\)/, 'no longer loads every .env.local value into the test process');
});
