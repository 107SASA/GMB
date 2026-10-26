import { inngest } from '@/services/inngest/client';

/**
 * Super Admin "Send WhatsApp" to leads (services/admin/whatsappCampaigns.ts):
 * sends the queued rows in batches of 25, a short pause between batches so a
 * large send does not hit Twilio's rate limit. Each batch is its own durable
 * step — a retry resumes with the rows still queued, never re-sending one.
 */
export const whatsappCampaignSend = inngest.createFunction(
  { id: 'whatsapp-campaign-send', retries: 3, concurrency: { limit: 1 }, triggers: [{ event: 'whatsapp/campaign.send' }] },
  async ({ event, step }) => {
    const { campaignId } = event.data as { campaignId: string };
    // At most 1000 leads per send → 40 batches; the cap is a guard, not a target.
    for (let batch = 0; batch < 60; batch++) {
      const { remaining } = await step.run(`batch-${batch}`, async () => {
        const { sendCampaignBatch } = await import('@/services/admin/whatsappCampaigns');
        return sendCampaignBatch(campaignId);
      });
      if (!remaining) return { success: true, batches: batch + 1 };
      await step.sleep(`pause-${batch}`, '3s');
    }
    return { success: false, reason: 'batch limit reached' };
  }
);
