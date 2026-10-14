import { serve } from "inngest/next";
import { inngest } from "@/services/inngest/client";
import {
  processWhatsappMessage,
  followUpCron,
  processFollowUpJob,
  bufferMonitorWorker,
  weeklyContentReminder,
  weeklyContentAutopilot,
  billingActivationReconcileCron,
  subscriptionExpiryWorker,
  manualContentGenerate,
  processContentJob,
  applyWeeklyOfferJob,
  processReviewCampaign,
  processReviewAutopollJob,
  scheduleSinglePostPublish,
  publishScheduledPostsCron,
  processPublishPostJob,
  publishScheduledMediaCron,
  processScheduledMediaPublishJob,
  reviewSyncWorker,
  processReviewSyncJob,
  processAutoReplyBatchJob,
  criticalAlertWorker,
  reviewReplyDraftedWorker,
  scheduleLeadFollowUpsJob,
  dispatchWhatsappFollowUpJob,
  crmStaleLeadReminderCron,
  crmGrowthReportReadyCron,
  crmFollowUpReminderCron,
  processDemoBooking,
  generateAuditJob,
  sendReportReadyNotification,
  cleanupStalePendingAudits,
  auditAutopilotCron,
  ownerWhatsAppDigestCron,
  seoPlanWeeklySummary,
  performanceDigestCron,
  salesNurtureRequested,
  salesNurtureConsented,
  salesAgentReply,
  bookingAgentReply,
  supportAgentReply,
  reportAgentReply,
  reportCardDeliver,
  gbpNightlySyncScheduler,
  gbpSyncWorker,
  cleanupAbandonedSignups,
  nurtureSchedulerTick,
  proactiveNbaScheduler,
  dataRetentionCleanupCron,
  accountHardPurgeCron
} from "@/services/inngest/functions";
import { nativeFunctionIds } from "@/services/jobs/config";
import { selectServedFunctions } from "@/services/jobs/adapter";
import { patchInngestStepSend } from "@/services/jobs/dispatch";

const allFunctions = [
    processWhatsappMessage,
    followUpCron,
    processFollowUpJob,
    bufferMonitorWorker,
    weeklyContentReminder,
    weeklyContentAutopilot,
    billingActivationReconcileCron,
    subscriptionExpiryWorker,
    manualContentGenerate,
    processContentJob,
    applyWeeklyOfferJob,
    processReviewCampaign,
      processReviewAutopollJob,
    scheduleSinglePostPublish,
    publishScheduledPostsCron,
    processPublishPostJob,
    publishScheduledMediaCron,
    processScheduledMediaPublishJob,
    reviewSyncWorker,
    processReviewSyncJob,
    processAutoReplyBatchJob,
    criticalAlertWorker,
    reviewReplyDraftedWorker,
    scheduleLeadFollowUpsJob,
    dispatchWhatsappFollowUpJob,
    crmStaleLeadReminderCron,
    crmGrowthReportReadyCron,
    crmFollowUpReminderCron,
    processDemoBooking,
    generateAuditJob,
    sendReportReadyNotification,
    cleanupStalePendingAudits,
    auditAutopilotCron,
    ownerWhatsAppDigestCron,
    seoPlanWeeklySummary,
    performanceDigestCron,
    salesNurtureRequested,
    salesNurtureConsented,
    salesAgentReply,
    bookingAgentReply,
    supportAgentReply,
    reportAgentReply,
    reportCardDeliver,
    gbpNightlySyncScheduler,
    gbpSyncWorker,
    cleanupAbandonedSignups,
    nurtureSchedulerTick,
    // With the Lead Engine v2 flag off this cron is a pure no-op that still
    // bills a run every 30 min, so it is only registered when the flag is on.
    ...(process.env.LEAD_ENGINE_V2 === 'true' ? [proactiveNbaScheduler] : []),
    dataRetentionCleanupCron,
    accountHardPurgeCron,
];

// Native job queue (src/services/jobs). With JOBS_NATIVE_ENABLED unset (the
// default) `owned` is empty and this serves EXACTLY the list above, unchanged.
// Functions listed in JOBS_NATIVE_FUNCTIONS are deregistered here (after the
// next `PUT /api/inngest` resync) so Inngest can never run them alongside
// the native worker — one owner per function, always.
// Same rule as dispatch.getRouter and /api/inngest/ownership (selectServedFunctions):
// a function is deregistered from Inngest ONLY when it is natively ownable (known id, no
// unsupported options). A typo, "*", an unsupported option, or an uninspectable function
// stays with Inngest, and nothing here can throw: it must never take the whole app down or
// deregister a function that has no valid native executor. The worker's guard and
// assertOwnable still refuse to start for the same input.
let served: any[] = allFunctions;
let owned = new Set<string>();
try {
  const sel = selectServedFunctions(allFunctions as any[], nativeFunctionIds());
  served = sel.served;
  owned = sel.owned;
  for (const r of sel.rejected) {
    console.error(
      `[inngest] JOBS_NATIVE_FUNCTIONS id "${r.id}" ignored on the web path (${r.reason}); Inngest keeps serving it`
    );
  }
} catch (err: any) {
  console.error(`[inngest] native ownership resolution failed; serving every function: ${String(err?.message || err)}`);
}
if (owned.size) patchInngestStepSend(served);

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: served,
});
