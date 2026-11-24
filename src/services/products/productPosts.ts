import dbConnect from '@/lib/mongodb';
import Product from '@/models/Product';
import Business from '@/models/Business';
import { batchSchedule, nextProductToPost, productPostText } from './productText';

/**
 * Products → Google product posts (photo, price, Order / Shop button).
 * Posts go through the normal scheduler: status 'scheduled' + the
 * scheduler/post-scheduled event, held while the workspace has no plan or
 * Google access, published by services/content/publishPost.ts.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** A product posted this recently isn't posted again in a batch. */
const REPOST_GAP_MS = 14 * 24 * 60 * 60 * 1000;

async function createProductPost(product: any, business: any, scheduledDate: Date, source: 'owner' | 'autopilot'): Promise<string> {
  const { default: Post } = await import('@/models/Post');
  const text = productPostText(product, { name: business.name, city: business.city });
  const url = product.buttonUrl || business.website || '';
  const actionType = product.button === 'CALL' ? 'CALL' : /^https:\/\//i.test(url) ? product.button : null;
  const post: any = await Post.create({
    tenantId: business.organizationId,
    businessId: business._id,
    title: text.title,
    content: text.content,
    imageUrl: product.imageUrl || undefined,
    postType: 'product',
    status: 'scheduled',
    platform: 'gmb',
    aiGenerated: product.source === 'photo_ai',
    scheduledDate,
    automationMetadata: { generatedVia: source === 'autopilot' ? 'product-autopilot' : 'products' },
    contentMeta: {
      purpose: 'product',
      productId: String(product._id),
      ...(actionType ? { gbpCta: { actionType, ...(actionType === 'CALL' ? {} : { url }) } } : {}),
    },
  });
  await Product.updateOne({ _id: product._id }, { $set: { scheduledPostAt: scheduledDate, lastPostId: post._id } });
  try {
    const { inngest } = await import('@/services/inngest/client');
    await inngest.send({ name: 'scheduler/post-scheduled', data: { postId: String(post._id), scheduledDate: scheduledDate.toISOString() } });
  } catch (err: any) {
    // The hourly safety-net cron publishes it anyway.
    console.warn('[products] post-scheduled event failed:', err?.message);
  }
  return String(post._id);
}

/** "Post to Google" for chosen products: spaced 2 days apart, skipping ones posted / queued recently. */
export async function scheduleProductPosts(businessId: string, productIds: string[] | 'all'): Promise<{ scheduled: number; skipped: number; first: Date | null }> {
  await dbConnect();
  const business: any = await Business.findById(businessId).select('name city website organizationId').lean();
  if (!business) return { scheduled: 0, skipped: 0, first: null };
  const now = new Date();
  const query: any = { businessId, status: 'active' };
  if (productIds !== 'all') query._id = { $in: productIds };
  const products: any[] = await Product.find(query).sort({ lastPostedAt: 1, createdAt: 1 }).lean();
  const due = products.filter((p) =>
    !(p.scheduledPostAt && new Date(p.scheduledPostAt) > now) &&
    !(p.lastPostedAt && now.getTime() - new Date(p.lastPostedAt).getTime() < REPOST_GAP_MS));
  // Continue after any product post already waiting, never on top of it.
  const lastQueued = products.reduce<number>((m, p) => (p.scheduledPostAt && new Date(p.scheduledPostAt) > now ? Math.max(m, new Date(p.scheduledPostAt).getTime()) : m), 0);
  const startAt = lastQueued ? new Date(lastQueued + 2 * 24 * 60 * 60 * 1000 - 10 * 60 * 1000) : now;
  const dates = batchSchedule(due.length, startAt);
  for (let i = 0; i < due.length; i++) await createProductPost(due[i], business, dates[i], 'owner');
  return { scheduled: due.length, skipped: products.length - due.length, first: dates[0] ?? null };
}

/** A product post that published: remember it on the product (called from publishPost's outcome). */
export async function noteProductPostPublished(post: { _id: unknown; contentMeta?: any; publishedAt?: Date }): Promise<void> {
  const productId = post?.contentMeta?.productId;
  if (!productId) return;
  await dbConnect();
  await Product.updateOne(
    { _id: productId },
    { $set: { lastPostedAt: post.publishedAt || new Date() }, $unset: { scheduledPostAt: 1 }, $inc: { postCount: 1 } },
  );
}

/**
 * Weekly autopilot: for every workspace with product auto-posting on, post
 * the product that has gone longest without one — at most one a week, and
 * never while another product post is still waiting.
 */
export async function runProductAutopilot(now = new Date()): Promise<{ businesses: number; scheduled: number }> {
  await dbConnect();
  const { planAccessWorkspaceFilter } = await import('@/lib/billing/entitlements');
  const { googleAccessReadyFilter } = await import('@/lib/googleAccess');
  const businesses: any[] = await Business.find({
    isDeleted: { $ne: true },
    productAutoPost: true,
    ...googleAccessReadyFilter(),
    $and: [planAccessWorkspaceFilter(now)],
  }).select('_id name city website organizationId').lean();
  let scheduled = 0;
  for (const business of businesses) {
    const products: any[] = await Product.find({ businessId: business._id, status: 'active' })
      .select('name category description price currency imageUrl button buttonUrl source lastPostedAt scheduledPostAt createdAt')
      .lean();
    if (!products.length) continue;
    const latest = products.reduce<number>((m, p) => Math.max(m, p.lastPostedAt ? new Date(p.lastPostedAt).getTime() : 0), 0);
    if (latest && now.getTime() - latest < WEEK_MS) continue;
    const pick = nextProductToPost(products, now);
    if (!pick) continue;
    await createProductPost(pick, business, new Date(now.getTime() + 15 * 60 * 1000), 'autopilot');
    scheduled += 1;
  }
  return { businesses: businesses.length, scheduled };
}
