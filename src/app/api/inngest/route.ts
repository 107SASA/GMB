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
import { partitionOwnership } from "@/services/jobs/config";
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
const ownership = partitionOwnership(allFunctions.map((f: any) => f?.opts?.id as string));
if (ownership.unknown.length) {
  throw new Error(`JOBS_NATIVE_FUNCTIONS lists unknown function ids: ${ownership.unknown.join(", ")}`);
}
const owned = new Set(ownership.native);
const served = owned.size
  ? allFunctions.filter((f: any) => !owned.has(f?.opts?.id))
  : allFunctions;
if (owned.size) patchInngestStepSend(served);

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: served,
});
