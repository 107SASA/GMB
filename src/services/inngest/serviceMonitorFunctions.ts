import { inngest } from './client';

/**
 * Checks every third-party service (lib/serviceMonitor.ts) every 6 hours and
 * emails ADMIN_EMAIL when one gets worse — low balance, near a plan limit, a
 * renewal coming up. Re-sends a critical alert once a day until it is fixed,
 * and sends a "back to normal" line once it recovers.
 */
export const serviceMonitorCron = inngest.createFunction(
  { id: 'service-monitor-check', triggers: [{ cron: '30 */6 * * *' }] },
  async ({ step }) => {
    return step.run('check-services-and-alert', async () => {
      const { runServiceChecks } = await import('@/lib/serviceMonitor');
      const { alertOnServiceChanges } = await import('@/lib/serviceMonitorAlerts');
      const reports = await runServiceChecks();
      return alertOnServiceChanges(reports);
    });
  }
);
