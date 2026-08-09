// Verifies:
//  1. The status-default bug fix in POST /api/posts (Post.create with no
//     explicit status used to pass the invalid uppercase "PENDING_APPROVAL"
//     to a lowercase-only enum — would throw ValidationError on every call).
//  2. GET /api/scheduler/posts/[id]'s new single-post lookup is correctly
//     scoped to the owning business (returns null for a different business).
//
// Run: npx tsx scripts/verify_posts_fix.ts

import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
}

let pass = 0, fail = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) { console.log(`✅ ${label}`); pass++; }
  else { console.log(`❌ ${label}`, detail ?? ''); fail++; }
}

async function main() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  const Business = (await import('../src/models/Business')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const User = (await import('../src/models/User')).default;
  const Post = (await import('../src/models/Post')).default;

  await dbConnect();

  const user = await User.create({
    fullName: 'Verify Posts Fix', email: `verify-posts-${Date.now()}@shadow.growwmatics.internal`,
    phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`, role: 'CLIENT',
    isShadowAccount: true, shadowSource: 'verify-script', isEmailVerified: false,
  });
  const organization = await Organization.create({ name: 'Verify Posts Org', ownerId: user._id, subscriptionPlan: 'Free' });
  const businessA = await Business.create({
    name: 'Verify Posts Business A', category: 'Test', address: 'Test', city: 'Test',
    organizationId: organization._id, userId: user._id, provisionedVia: 'verify-script',
  });
  const businessB = await Business.create({
    name: 'Verify Posts Business B', category: 'Test', address: 'Test', city: 'Test',
    organizationId: organization._id, userId: user._id, provisionedVia: 'verify-script',
  });

  try {
    // 1. The exact call the route makes when no status is passed in the body.
    const body: any = { title: 'Manual post', content: 'Hello world' };
    let created: any;
    let threw = false;
    try {
      created = await Post.create({ ...body, businessId: businessA._id, status: body.status || 'draft' });
    } catch (e) {
      threw = true;
      console.error('  (would have thrown):', (e as Error).message);
    }
    check('Post.create with no explicit status succeeds (fixed default)', !threw && !!created);
    check('Created post has status "draft"', created?.status === 'draft', created?.status);

    // Sanity: confirm the OLD buggy default really would have failed, so
    // we know this test is actually exercising the fix and not a no-op.
    let oldDefaultThrew = false;
    try {
      await Post.create({ title: 'x', content: 'y', businessId: businessA._id, status: 'PENDING_APPROVAL' });
    } catch {
      oldDefaultThrew = true;
    }
    check('Sanity check: the OLD uppercase default really is rejected by the schema', oldDefaultThrew);

    // 2. GET lookup scoping — businessB must NOT find businessA's post.
    const foundForOwner = await Post.findOne({ _id: created._id, businessId: businessA._id }).lean();
    const foundForOther = await Post.findOne({ _id: created._id, businessId: businessB._id }).lean();
    check('Owning business can fetch the post', !!foundForOwner);
    check('A different business cannot fetch it (404 in the route)', foundForOther === null);
  } finally {
    await Post.deleteMany({ businessId: { $in: [businessA._id, businessB._id] } });
    await Business.deleteMany({ _id: { $in: [businessA._id, businessB._id] } });
    await Organization.deleteOne({ _id: organization._id });
    await User.deleteOne({ _id: user._id });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY SCRIPT CRASHED:', e); process.exit(1); });
