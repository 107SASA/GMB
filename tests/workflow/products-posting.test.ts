/**
 * Products → scheduled Google product posts → published with the button →
 * the product remembers it. Real MongoDB (in memory), no Google calls.
 * Run: npx tsx --test tests/workflow/products-posting.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const sent: any[] = [];
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/services[\\/]inngest[\\/]client(\.ts)?$/.test(request)) return { inngest: { send: async (e: any) => { sent.push(e); } } };
  return origLoad.call(this, request, ...rest);
};

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_products_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Product: (await import('../../src/models/Product')).default,
    Post: (await import('../../src/models/Post')).default,
    Business: (await import('../../src/models/Business')).default,
    posts: await import('../../src/services/products/productPosts'),
    publish: await import('../../src/services/content/publishPost'),
  };
});

after(async () => {
  Module._load = origLoad;
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

test('products are posted one at a time with their button, and remembered once live', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const biz = await m.Business.collection.insertOne({ name: 'Shree Sweets', city: 'Nashik', website: 'https://shreesweets.example', organizationId: 'org1' });
  const businessId = biz.insertedId;
  const [kaju, ladoo] = await m.Product.insertMany([
    { businessId, name: 'Kaju Katli', price: 650, currency: 'INR', imageUrl: 'https://cdn.example/kaju.jpg', button: 'ORDER', buttonUrl: 'https://shreesweets.example/order', status: 'active' },
    { businessId, name: 'Motichoor Ladoo', price: 420, currency: 'INR', button: 'CALL', status: 'active' },
  ]);

  const first = await m.posts.scheduleProductPosts(String(businessId), 'all');
  assert.equal(first.scheduled, 2);
  const posts = await m.Post.find({ businessId }).sort({ scheduledDate: 1 }).lean();
  assert.equal(posts.length, 2);
  assert.equal(posts[0].status, 'scheduled');
  assert.equal(posts[0].contentMeta.purpose, 'product');
  assert.ok(posts[1].scheduledDate - posts[0].scheduledDate >= 2 * 86_400_000 - 1000, 'spaced two days apart');

  // Asking again does not queue duplicates.
  const again = await m.posts.scheduleProductPosts(String(businessId), 'all');
  assert.equal(again.scheduled, 0);

  // Publish the Kaju post: the Order button reaches Google, and the product records it.
  const kajuPost = posts.find((p: any) => p.contentMeta?.productId === String(kaju._id));
  const calls: any[] = [];
  const out = await m.publish.publishPost(String(kajuPost._id), {
    deps: { writesEnabled: () => true, createLocalPost: async (_b: string, input: any) => { calls.push(input); return { liveWriteApplied: true, postName: 'accounts/1/locations/2/localPosts/9' }; } },
  });
  assert.equal(out.outcome, 'published');
  assert.deepEqual(calls[0].cta, { actionType: 'ORDER', url: 'https://shreesweets.example/order' });
  assert.equal(calls[0].mediaUrl, 'https://cdn.example/kaju.jpg');
  assert.match(calls[0].summary, /Kaju Katli — ₹650/);
  const k = await m.Product.findById(kaju._id).lean();
  assert.equal(k.postCount, 1);
  assert.ok(k.lastPostedAt);
  assert.equal(k.scheduledPostAt, undefined);

  // The CALL product posts with a Call button and no link.
  const ladooPost = posts.find((p: any) => p.contentMeta?.productId === String(ladoo._id));
  assert.deepEqual(ladooPost.contentMeta.gbpCta, { actionType: 'CALL' });
});
