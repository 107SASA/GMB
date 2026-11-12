import { inngest } from './client';

/**
 * Blog scheduled publishing. A post approved "for later" already has its live
 * snapshot saved with a future publish time (public pages hide it until then);
 * every 10 minutes this flips due posts to "published" and rebuilds their
 * pages, so they appear on /blog, the topic pages and the sitemap on time.
 */
export const blogScheduledPublishCron = inngest.createFunction(
  { id: 'blog-scheduled-publish', triggers: [{ cron: '*/10 * * * *' }] },
  async ({ step }) => {
    return step.run('publish-due-posts', async () => {
      const [{ default: dbConnect }, { publishDueScheduled }] = await Promise.all([
        import('@/lib/mongodb'),
        import('@/lib/blog/workflow'),
      ]);
      await dbConnect();
      return { rebuilt: await publishDueScheduled() };
    });
  }
);
