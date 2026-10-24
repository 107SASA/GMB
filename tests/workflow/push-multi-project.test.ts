/**
 * Expo push across two Expo projects — the Android app (mobile/) and the iOS
 * app (ios/) register tokens from different projects, and Expo rejects a
 * request that mixes them (PUSH_TOO_MANY_EXPERIENCE_IDS). Runs the REAL
 * services/push.ts against an in-memory MongoDB with fetch replaced by a
 * simulated Expo push API: nothing can reach Expo and no notification is sent.
 *
 * Run: npm run test:workflow
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const ANDROID = '@growwmaticsais-team/growwmatics-ai';
const IOS = '@growwmaticsais-team/growwmatics-ios';
const tok = (name: string) => `ExponentPushToken[${name}]`;

// Simulated Expo: which project each token belongs to, and which are dead.
const projectOf = new Map<string, string>();
const deadTokens = new Set<string>();
let failProject: string | null = null; // simulate a 5xx for one project's requests
let omitDetails = false; // simulate a mixed-project error without `details`
type Sent = { to: string; title: string; body: string; data: unknown; sound: string; priority: string };
const requests: Sent[][] = [];

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return originalFetch(input, init);
  assert.ok(url.includes('exp.host'), `unexpected outbound request: ${url}`);
  const messages = JSON.parse(String(init?.body)) as Sent[];
  requests.push(messages);
  const projects = new Set(messages.map((m) => projectOf.get(m.to)));
  if (projects.size > 1) {
    const details: Record<string, string[]> = {};
    for (const m of messages) (details[projectOf.get(m.to)!] ??= []).push(m.to);
    return new Response(
      JSON.stringify({
        errors: [{
          code: 'PUSH_TOO_MANY_EXPERIENCE_IDS',
          message: 'All push notification messages in the same request must be for the same project.',
          ...(omitDetails ? {} : { details }),
        }],
      }),
      { status: 400 }
    );
  }
  if (failProject && projects.has(failProject)) {
    return new Response(JSON.stringify({ errors: [{ code: 'INTERNAL_SERVER_ERROR', message: 'boom' }] }), { status: 500 });
  }
  return new Response(
    JSON.stringify({
      data: messages.map((m) =>
        deadTokens.has(m.to)
          ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok', id: `ticket-${m.to}` }
      ),
    }),
    { status: 200 }
  );
}) as typeof fetch;

process.env.QA_SUPPRESS_PUSH_SENDS = 'false'; // fetch is simulated — exercise the real send path

let memoryServer: any = null;
let skipReason: string | null = null;
let app: any = {};

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_push_projects_${Date.now()}`);
  const dbConnect = (await import('../../src/lib/mongodb')).default;
  await dbConnect();
  app = {
    push: await import('../../src/services/push'),
    User: (await import('../../src/models/User')).default,
    Business: (await import('../../src/models/Business')).default,
    mongoose: (await import('mongoose')).default,
  };
});

after(async () => {
  if (app.mongoose?.connection?.readyState === 1) {
    await app.mongoose.connection.dropDatabase();
    await app.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  requests.length = 0;
  deadTokens.clear();
  failProject = null;
  omitDetails = false;
});

let seq = 0;
async function makeUser(tokens: Array<[string, string]>) {
  for (const [t, project] of tokens) projectOf.set(t, project);
  seq += 1;
  return app.User.create({
    fullName: `Push User ${seq}`,
    email: `push${seq}@example.invalid`,
    phone: `+9190000${String(seq).padStart(5, '0')}`,
    role: 'CLIENT',
    pushTokens: tokens.map(([t]) => t),
  } as any);
}

const MESSAGE = { title: 'New lead', body: 'Asha enquired', data: { crmLeadId: 'lead-1' } };
const delivered = () =>
  requests.filter((r) => new Set(r.map((m) => projectOf.get(m.to))).size === 1).flat().map((m) => m.to).sort();
const storedTokens = async (id: unknown) => ((await app.User.findById(id).lean()) as any).pushTokens.sort();

test('Android-only user: one request, payload unchanged', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a1 = tok('android-1'), a2 = tok('android-2');
  const user = await makeUser([[a1, ANDROID], [a2, ANDROID]]);

  await app.push.sendPushToUser(String(user._id), MESSAGE);

  assert.equal(requests.length, 1, 'single-project users still need exactly one request');
  assert.deepEqual(requests[0], [a1, a2].map((to) => ({
    to, title: 'New lead', body: 'Asha enquired', data: { crmLeadId: 'lead-1' }, sound: 'default', priority: 'high',
  })));
  assert.deepEqual(await storedTokens(user._id), [a1, a2].sort());
});

test('iOS-only user: one request, delivered', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const i1 = tok('ios-1');
  const user = await makeUser([[i1, IOS]]);

  await app.push.sendPushToUser(String(user._id), MESSAGE);

  assert.equal(requests.length, 1);
  assert.deepEqual(delivered(), [i1]);
});

test('user on both platforms: rejected mixed request is re-sent once per project', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a1 = tok('both-android'), i1 = tok('both-ios-1'), i2 = tok('both-ios-2');
  const user = await makeUser([[a1, ANDROID], [i1, IOS], [i2, IOS]]);

  await app.push.sendPushToUser(String(user._id), MESSAGE);

  assert.equal(requests.length, 3, 'one rejected mixed request + one per project');
  assert.deepEqual(delivered(), [a1, i1, i2].sort(), 'every device gets the notification exactly once');
  for (const r of requests.slice(1)) {
    assert.equal(new Set(r.map((m) => projectOf.get(m.to))).size, 1, 'each retry is single-project');
    assert.deepEqual(r[0].data, { crmLeadId: 'lead-1' }, 'payload is unchanged on the retry');
  }
  assert.deepEqual(await storedTokens(user._id), [a1, i1, i2].sort(), 'no live token is pruned');
});

test('both platforms: a dead token in one project is pruned, the rest are kept', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a1 = tok('dead-android'), i1 = tok('dead-ios-live'), i2 = tok('dead-ios-gone');
  const user = await makeUser([[a1, ANDROID], [i1, IOS], [i2, IOS]]);
  deadTokens.add(i2);

  await app.push.sendPushToUser(String(user._id), MESSAGE);

  assert.deepEqual(await storedTokens(user._id), [a1, i1].sort());
});

test('both platforms: one project failing does not stop the other, and prunes nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a1 = tok('partial-android'), i1 = tok('partial-ios');
  const user = await makeUser([[a1, ANDROID], [i1, IOS]]);
  failProject = IOS;

  await app.push.sendPushToUser(String(user._id), MESSAGE);

  const ok = requests.filter((r) => r.length === 1 && projectOf.get(r[0].to) === ANDROID);
  assert.equal(ok.length, 1, 'the Android device is still sent its notification');
  assert.deepEqual(await storedTokens(user._id), [a1, i1].sort(), 'a 5xx is not a dead token');
});

test('mixed error without details: falls back to one token per request', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a1 = tok('nodetail-android'), i1 = tok('nodetail-ios');
  const user = await makeUser([[a1, ANDROID], [i1, IOS]]);
  omitDetails = true;

  await app.push.sendPushToUser(String(user._id), MESSAGE);

  assert.equal(requests.length, 3);
  assert.deepEqual(delivered(), [a1, i1].sort());
});

test('business team on different platforms: each member is notified once', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const owner = await makeUser([[tok('team-owner-android'), ANDROID]]);
  const member = await makeUser([[tok('team-member-ios'), IOS]]);
  const businessId = new app.mongoose.Types.ObjectId();
  // Raw insert: only the ownership fields matter to sendPushToBusinessUsers.
  await app.Business.collection.insertOne({ _id: businessId, name: 'Asha Salon', userId: owner._id });
  await app.User.updateOne({ _id: member._id }, { $set: { businessIds: [businessId] } });

  await app.push.sendPushToBusinessUsers(String(businessId), MESSAGE);

  assert.deepEqual(delivered(), [tok('team-owner-android'), tok('team-member-ios')].sort());
});

test('groupByProject keeps only this chunk\'s tokens and never re-mixes projects', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { groupByProject } = app.push;
  assert.deepEqual(
    groupByProject(['a', 'b', 'c', 'd'], { p1: ['a', 'x', 'a'], p2: ['b', 'c'], junk: 'nope' }),
    [['a'], ['b', 'c'], ['d']]
  );
  assert.deepEqual(groupByProject(['a', 'b'], null), [['a'], ['b']]);
});
