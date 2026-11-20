/**
 * One person, one account per area: the same email / mobile number may have a
 * customer account, a Growth Partner account and a staff account — but never
 * two accounts of the same role. Checked against a REAL MongoDB, because the
 * unique indexes are what actually enforce it.
 *
 * Database: MONGODB_TEST_URI if set, otherwise a throwaway in-memory server
 * (mongodb-memory-server). Never MONGODB_URI. If neither is available the DB
 * tests are SKIPPED (reported as skipped, not passed).
 *
 * Run: node --experimental-strip-types --test tests/integration/account-area-mongo.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../../src/models/User.ts';
import { areaFilter, areaOfRole, areaFromLoginContext } from '../../src/lib/accountArea.ts';

let memoryServer: any = null;
let skipReason: string | null = null;

before(async () => {
  let uri = process.env.MONGODB_TEST_URI;
  if (!uri) {
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri();
    } catch (err: any) {
      skipReason = `no MONGODB_TEST_URI and mongodb-memory-server unavailable (${err?.message})`;
      return;
    }
  }
  await mongoose.connect(uri!, { dbName: `gm_accountarea_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` });
  await User.syncIndexes();
});

after(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

test('areas map from roles and login-page context', () => {
  assert.equal(areaOfRole('CLIENT'), 'customer');
  assert.equal(areaOfRole(undefined), 'customer');
  assert.equal(areaOfRole('GROWTH_PARTNER'), 'partner');
  assert.equal(areaOfRole('SUPER_ADMIN'), 'staff');
  assert.equal(areaOfRole('TEAM_MEMBER'), 'staff');
  assert.equal(areaFromLoginContext('partner'), 'partner');
  assert.equal(areaFromLoginContext('admin'), 'staff');
  assert.equal(areaFromLoginContext(undefined), 'customer');
  assert.equal(areaFromLoginContext({ $ne: 1 }), 'customer');
});

test('same email and phone can exist once per role; lookups pick the right one', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const email = 'owner@example.com';
  const phone = '+919876543210';

  const customer = await User.create({ fullName: 'Asha', email, phone, role: 'CLIENT' });
  const partner = await User.create({ fullName: 'Asha', email, phone: 'partner:GPX1', role: 'GROWTH_PARTNER' });
  const admin = await User.create({ fullName: 'Asha', email, phone, role: 'SUPER_ADMIN' });

  const byArea = async (area: 'customer' | 'partner' | 'staff') =>
    String((await User.findOne({ email, ...areaFilter(area) }).lean<any>())?._id);
  assert.equal(await byArea('customer'), String(customer._id));
  assert.equal(await byArea('partner'), String(partner._id));
  assert.equal(await byArea('staff'), String(admin._id));
  assert.equal(
    String((await User.findOne({ phone, ...areaFilter('customer') }).lean<any>())?._id),
    String(customer._id)
  );

  // A second account of the SAME role is still refused by the database.
  await assert.rejects(
    User.create({ fullName: 'Dup', email, phone: '+919999999999', role: 'CLIENT' }),
    (e: any) => e?.code === 11000
  );
  await assert.rejects(
    User.create({ fullName: 'Dup', email: 'other@example.com', phone, role: 'SUPER_ADMIN' }),
    (e: any) => e?.code === 11000
  );
});
