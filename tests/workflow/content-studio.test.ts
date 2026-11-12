/**
 * Content Studio (blog + website pages), run for real against a database:
 *  - blog HTML from the editor is sanitized (no scripts, handlers, bad links,
 *    foreign iframes) and gets heading anchors;
 *  - a team member can write and submit but never publish; nothing reaches the
 *    public site until a Super Admin approves; editing a live post keeps the
 *    approved version live; renamed posts redirect; scheduled posts stay
 *    hidden until their time; taken-down posts disappear;
 *  - two people saving the same post can't silently overwrite each other;
 *  - website-page edits only change the page after approval.
 * Run: npx tsx --test tests/workflow/content-studio.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};

const superAdmin = { userId: '', fullName: 'Owner', email: 'owner@example.invalid', isSuperAdmin: true, permissions: ['blog', 'cms'] as ('blog' | 'cms')[] };
const writer = { userId: '', fullName: 'Writer', email: 'writer@example.invalid', isSuperAdmin: false, permissions: ['blog', 'cms'] as ('blog' | 'cms')[] };

const BODY = (extra = '') =>
  `<h2>Why reviews matter</h2><p>${'Google reviews help local businesses get found. '.repeat(25)}</p>` +
  `<h2>How to ask</h2><p>Ask every happy customer. See <a href="/free-report">your free report</a> and <a href="/book-demo">book a demo</a>.</p>` +
  `<h2>Next steps</h2><p>${'Reply to every review within a day. '.repeat(10)}</p>${extra}`;

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_content_studio_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    BlogPost: (await import('../../src/models/BlogPost')).default,
    wf: await import('../../src/lib/blog/workflow'),
    pub: await import('../../src/lib/blog/public'),
    san: await import('../../src/lib/blog/sanitize'),
    cmsWf: await import('../../src/lib/cms/workflow'),
    cms: await import('../../src/lib/cms/content'),
  };
  superAdmin.userId = String(new m.mongoose.Types.ObjectId());
  writer.userId = String(new m.mongoose.Types.ObjectId());
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

async function newPost(over: Record<string, unknown> = {}) {
  return m.BlogPost.create({
    language: 'en',
    translationKey: String(new m.mongoose.Types.ObjectId()),
    title: 'How to get more Google reviews',
    slug: `get-more-google-reviews-${Math.random().toString(36).slice(2, 7)}`,
    excerpt: 'A simple, practical way for local businesses to collect more five-star Google reviews every week.',
    contentHtml: BODY(),
    createdBy: writer.userId,
    ...over,
  });
}

test('editor HTML is sanitized and gets heading anchors', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const out = m.san.cleanBlogHtml(
    `<h1>Big</h1><p onclick="x()">Hi<script>alert(1)</script></p>` +
      `<a href="javascript:alert(1)">bad</a><a href="https://example.com">ext</a>` +
      `<img src="x" onerror="alert(1)"><img src="https://cdn.example.com/a.webp" alt="ok">` +
      `<iframe src="https://evil.example/x"></iframe>` +
      `<div data-youtube-video=""><iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe></div>` +
      `<h2>Step one</h2><h3>Detail</h3><h2>Step one</h2><p style="color:red">styled</p>`,
    'en'
  );
  assert.ok(!/script|onclick|onerror|javascript:|style=|evil\.example/i.test(out.html), out.html);
  assert.ok(!out.html.includes('<h1'), 'h1 becomes h2');
  assert.ok(out.html.includes('youtube-nocookie.com/embed/abc'), 'YouTube embed kept');
  assert.ok(out.html.includes('href="https://example.com" target="_blank" rel="noopener noreferrer"'), 'external links open safely');
  assert.ok(!/<img src="x"/.test(out.html), 'non-https image dropped');
  assert.deepEqual(out.toc.map((x: any) => x.id), ['s-big', 's-step-one', 's-detail', 's-step-one-2']);
  assert.equal(m.san.cleanText('<b>Hi</b> & <script>x</script>there', 100), 'Hi & there');
  assert.equal(m.san.cleanLink('javascript:alert(1)'), '');
  assert.equal(m.san.cleanLink('//evil.example'), '');
  assert.equal(m.san.cleanLink('/pricing'), '/pricing');
});

test('team member writes and submits, only a Super Admin publishes', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const post = await newPost({ contentHtml: '<p>too short</p>' });
  const id = String(post._id);

  await assert.rejects(m.wf.submitForReview(id, writer), (e: any) => e.status === 422, 'short article is blocked');
  await m.wf.saveWorkingCopy(id, { contentHtml: BODY('<script>alert(1)</script>'), editVersion: post.editVersion }, writer);
  const saved = await m.BlogPost.findById(id).lean();
  assert.ok(!saved.contentHtml.includes('<script'), 'saved HTML is cleaned');

  const submitted = await m.wf.submitForReview(id, writer);
  assert.equal(submitted.status, 'in_review');
  await assert.rejects(m.wf.saveWorkingCopy(id, { title: 'Changed while in review' }, writer), (e: any) => e.status === 409);
  await assert.rejects(m.wf.approve(id, writer, null), (e: any) => e.status === 403, 'team member cannot publish');
  assert.equal((await m.pub.getLivePost('en', saved.slug)).kind, 'none', 'nothing public before approval');

  const live = await m.wf.approve(id, superAdmin, null);
  assert.equal(live.status, 'published');
  const found = await m.pub.getLivePost('en', saved.slug);
  assert.equal(found.kind, 'post');
  assert.equal(found.post.title, 'How to get more Google reviews');
  assert.ok(found.post.toc.length >= 3);

  // Editing the live post: the website keeps the approved version.
  const fresh = await m.BlogPost.findById(id).lean();
  await m.wf.saveWorkingCopy(id, { title: 'A brand new title for reviews', editVersion: fresh.editVersion }, writer);
  assert.equal((await m.BlogPost.findById(id).lean()).status, 'draft');
  assert.equal((await m.pub.getLivePost('en', saved.slug)).post.title, 'How to get more Google reviews');

  // Renaming the address after publishing: the old URL redirects.
  const v = (await m.BlogPost.findById(id).lean()).editVersion;
  await m.wf.saveWorkingCopy(id, { slug: 'new-review-guide', editVersion: v }, writer);
  await m.wf.approve(id, superAdmin, null);
  assert.equal((await m.pub.getLivePost('en', 'new-review-guide')).post.title, 'A brand new title for reviews');
  assert.deepEqual(await m.pub.getLivePost('en', saved.slug), { kind: 'redirect', slug: 'new-review-guide' });

  // Taking it down removes it from the site.
  await m.wf.takeDown(id, superAdmin);
  assert.equal((await m.pub.getLivePost('en', 'new-review-guide')).kind, 'none');
  await m.wf.restoreLive(id, superAdmin);
  assert.equal((await m.pub.getLivePost('en', 'new-review-guide')).kind, 'post');
});

test('scheduled posts stay hidden until their time', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const post = await newPost();
  const when = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const scheduled = await m.wf.approve(String(post._id), superAdmin, when);
  assert.equal(scheduled.status, 'scheduled');
  assert.equal((await m.pub.getLivePost('en', post.slug)).kind, 'none');
  const list = await m.pub.listLivePosts('en');
  assert.ok(!list.posts.some((p: any) => p.slug === post.slug));

  // Time passes → visible, and the cron flips the status.
  await m.BlogPost.updateOne({ _id: post._id }, { $set: { 'live.publishedAt': new Date(Date.now() - 60_000) } });
  assert.equal((await m.pub.getLivePost('en', post.slug)).kind, 'post');
  await m.wf.publishDueScheduled();
  assert.equal((await m.BlogPost.findById(post._id).lean()).status, 'published');
});

test('two people saving the same post cannot overwrite each other', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const post = await newPost();
  const v = post.editVersion;
  await m.wf.saveWorkingCopy(String(post._id), { title: 'First person edit here', editVersion: v }, writer);
  await assert.rejects(
    m.wf.saveWorkingCopy(String(post._id), { title: 'Second person edit here', editVersion: v }, superAdmin),
    (e: any) => e.code === 'STALE'
  );
});

test('web addresses are unique per language', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await newPost({ slug: 'unique-check-post' });
  const b = await newPost();
  await assert.rejects(
    m.wf.saveWorkingCopy(String(b._id), { slug: 'unique-check-post', editVersion: b.editVersion }, writer),
    (e: any) => e.code === 'SLUG_TAKEN'
  );
  // The Hindi version may share the English slug.
  const hi = await newPost({ language: 'hi', translationKey: a.translationKey, slug: '' });
  await m.wf.saveWorkingCopy(String(hi._id), { slug: 'unique-check-post', editVersion: hi.editVersion }, writer);
  assert.equal((await m.BlogPost.findById(hi._id).lean()).slug, 'unique-check-post');
});

test('website page edits change the page only after approval', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const before = await m.cms.cmsMetadata('pricing');
  assert.equal(before.title, 'Pricing — Google Business Profile Management Plan');

  await m.cmsWf.savePageDraft('pricing', { seoTitle: 'Pricing <b>for</b> local businesses', noindex: false }, writer);
  await m.cmsWf.submitPage('pricing', writer);
  assert.equal((await m.cms.cmsMetadata('pricing')).title, before.title, 'draft is not live');
  await assert.rejects(m.cmsWf.approvePage('pricing', writer), (e: any) => e.status === 403);

  await m.cmsWf.approvePage('pricing', superAdmin);
  const after = await m.cms.cmsMetadata('pricing');
  assert.equal(after.title, 'Pricing for local businesses', 'approved, tags stripped');
  assert.equal(after.description, before.description, 'empty field keeps the original text');

  // FAQs: approved list replaces the built-in one; reset brings it back.
  const builtIn = await m.cms.cmsFaqs('home');
  await m.cmsWf.savePageDraft('home', { faqs: [{ question: 'Do you work in Hindi?', answer: 'Yes.' }] }, superAdmin);
  await m.cmsWf.approvePage('home', superAdmin);
  assert.deepEqual(await m.cms.cmsFaqs('home'), [{ question: 'Do you work in Hindi?', answer: 'Yes.' }]);
  await m.cmsWf.resetPage('home', superAdmin);
  assert.equal((await m.cms.cmsFaqs('home')).length, builtIn.length);
});
