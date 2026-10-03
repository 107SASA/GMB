/**
 * The login phone can't be changed through PATCH /api/user/profile.
 * In-memory MongoDB, real route, auth mocked.   npx tsx scripts/profile-phone-lock-check.ts
 */
import path from 'path';

let auth: any = null;
const esm = (o: Record<string, unknown>) => { const m: any = { __esModule: true, ...o }; m.default = m; return m; };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]auth(\.ts)?$/.test(request)) return esm({ requireClient: async () => auth });
  return origLoad.call(this, request, ...rest);
};
{
  const filename = path.resolve('src/lib/auth.ts');
  const m = new Module(filename);
  m.filename = filename; m.loaded = true; m.exports = Module._load(filename);
  require.cache[filename] = m;
}

const results: Array<{ t: string; pass: boolean }> = [];
const check = (t: string, what: string, pass: boolean, detail = '') => { results.push({ t, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  [${t}] ${what}${detail ? ` — ${detail}` : ''}`); };

(async () => {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = mem.getUri('profile_phone_lock');
  try {
    const dbConnect = (await import('../src/lib/mongodb')).default; await dbConnect();
    const { default: User } = await import('../src/models/User');
    const route = await import('../src/app/api/user/profile/route');
    const patch = async (body: unknown) => {
      const res = await route.PATCH(new Request('http://local.test/api/user/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      return { status: res.status, body: await res.json() as any };
    };
    const u: any = await User.create({ fullName: 'Owner', email: 'owner@example.invalid', phone: '+919800000001', role: 'CLIENT' });
    auth = { ok: true, userId: String(u._id) };

    const change = await patch({ fullName: 'Owner', phone: '+919811111111' });
    const clear = await patch({ phone: '' });
    const after1: any = await User.findById(u._id).lean();
    check('P1', 'a different number is rejected (PHONE_LOCKED) and clearing it is rejected; the stored login phone is untouched',
      change.status === 400 && change.body.code === 'PHONE_LOCKED' && clear.status === 400 && after1.phone === '+919800000001');
    const same = await patch({ fullName: 'Owner Renamed', phone: '+91 98000 00001' });
    const after2: any = await User.findById(u._id).lean();
    check('P2', 'sending the same number back (checkout / old app builds) is accepted; the name still saves', same.status === 200 && after2.fullName === 'Owner Renamed' && after2.phone === '+919800000001');
    const nameOnly = await patch({ fullName: 'Owner Again' });
    check('P3', 'profile saves without a phone field (new web + app)', nameOnly.status === 200 && (await User.findById(u._id).lean() as any).fullName === 'Owner Again');

    const legacy: any = await User.create({ fullName: 'Legacy', email: 'legacy@example.invalid', phone: '+919800000002', role: 'CLIENT' });
    await User.collection.updateOne({ _id: legacy._id }, { $unset: { phone: '' } });
    auth = { ok: true, userId: String(legacy._id) };
    const setOnce = await patch({ phone: '+919800000003' });
    const changeAfter = await patch({ phone: '+919800000004' });
    check('P4', 'an old account with NO phone can set one once (checkout); after that it is locked too',
      setOnce.status === 200 && (await User.findById(legacy._id).lean() as any).phone === '+919800000003' && changeAfter.status === 400);
  } finally {
    await mem.stop({ doCleanup: true, force: true }).catch(() => {});
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.t).join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
