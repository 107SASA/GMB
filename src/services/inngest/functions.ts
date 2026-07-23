import { inngest } from "./client";
import dbConnect from "@/lib/mongodb";
import Lead from "@/models/Lead";
import Conversation from "@/models/Conversation";
import Appointment from "@/models/Appointment";
import FollowUp from "@/models/FollowUp";
import MessageQueue from "@/models/MessageQueue";
import Business from "@/models/Business";
import ReviewRequest from "@/models/ReviewRequest";
import Customer from "@/models/Customer";
import Campaign from "@/models/Campaign";
import AutomationLog from "@/models/AutomationLog";
import { generateSalesResponse } from "@/services/ai";
import { generateAIContent } from "@/services/ai/contentEngine";
import twilio from "twilio";
import mongoose from "mongoose";
import { sendOutboundMessage } from "@/services/whatsapp/send";

const FALLBACK_MESSAGE = "I'm having a little trouble connecting to my brain right now. Please hold on or call our main line!";

// 1. WhatsApp AI Worker
export const processWhatsappMessage = inngest.createFunction(
  { id: "process-whatsapp-message", retries: 3, triggers: [{ event: "whatsapp/incoming" }] },
  async ({ event, step }) => {
    const { messageSid, from, body, numMedia, leadId, threadId, tenantId, businessId, profileName } = event.data;
    
    const dbConnect = (await import("@/lib/mongodb")).default;
    await dbConnect();
    
    const { default: Conversation } = await import("@/models/Conversation");
    const { default: ConversationThread } = await import("@/models/ConversationThread");
    const { default: BusinessAIConfig } = await import("@/models/BusinessAIConfig");
    const { default: Activity } = await import("@/models/Activity");
    const { Groq } = await import("groq-sdk");

    const phone = from.replace('whatsapp:', '');

    // 1. Log inbound message
    await step.run("log-inbound-msg", async () => {
      await Conversation.create({
        tenantId,
        businessId,
        leadId,
        threadId,
        direction: 'inbound',
        messageText: numMedia > 0 ? '[Media Attachment]' : body,
        isAI: false,
        messageStatus: 'received',
        twilioSid: messageSid
      });

      await Activity.create({
        tenantId,
        leadId,
        type: 'WhatsApp',
        content: `Received: ${numMedia > 0 ? '[Media Attachment]' : body}`,
        metadata: { direction: 'inbound' }
      });
    });

    if (numMedia > 0 && !body) return { success: true, reason: 'Media-only message ignored by AI' };

    // 2. Check Thread Config
    const thread = await step.run("fetch-thread", async () => {
      return await ConversationThread.findById(threadId);
    });

    if (!thread || !thread.aiEnabled) {
      // Human is handling this thread — push-notify the business's users so
      // the message isn't missed. Best-effort: never fail the workflow.
      if (thread) {
        await step.run("push-notify-human-inbox", async () => {
          try {
            const { sendPushToBusinessUsers } = await import("@/services/push");
            const { default: LeadModel } = await import("@/models/Lead");
            const lead = await LeadModel.findById(leadId).select('name').lean() as any;
            const name = (lead?.name && lead.name !== phone ? lead.name : profileName) || phone;
            await sendPushToBusinessUsers(businessId, {
              title: 'New WhatsApp message',
              body: `New WhatsApp message from ${name}`,
              data: { leadId: String(leadId) },
            });
          } catch (e) {
            console.error('[push] whatsapp inbox notify failed:', e);
          }
        });
      }
      return { success: true, reason: 'AI disabled for this thread' };
    }

    // 2.5 ADDITIVE — WhatsApp AI Agent: appointment lifecycle + personalized
    // context (Features 1-6, 9, 10). This is entirely opt-in per business:
    // `processAppointmentIntent` returns { handled: false } immediately (no
    // extra Groq calls) unless the business has explicitly configured and
    // enabled `whatsappBookingSettings`. When it does return handled:false,
    // execution falls straight through to the ORIGINAL, UNCHANGED sales-AI
    // flow below — every existing business behaves exactly as before.
    const appointmentOutcome = await step.run("whatsapp-agent-appointment-intent", async () => {
      const { default: BusinessModel } = await import("@/models/Business");
      const { default: LeadModel } = await import("@/models/Lead");
      const { buildCustomerContext, formatContextForPrompt } = await import("@/services/whatsapp-agent/customerContextService");
      const { processAppointmentIntent } = await import("@/services/whatsapp-agent/appointmentAgent");
      const { getRecentChatHistory, formatHistoryForPrompt } = await import("@/services/whatsapp-agent/chatHistoryService");

      const [business, lead] = await Promise.all([
        BusinessModel.findById(businessId).lean(),
        LeadModel.findById(leadId).select('name email').lean(),
      ]);

      if (!business) return { handled: false, contextBlock: '', pendingAction: thread.pendingAction || null };

      let contextBlock = '';
      try {
        const recentHistory = await getRecentChatHistory(leadId, 12);
        const conversationContext = formatHistoryForPrompt(recentHistory);
        const customerContext = await buildCustomerContext({ leadId, businessId, phone });
        contextBlock = formatContextForPrompt(customerContext);

        const threadState = { pendingAction: thread.pendingAction || null };
        const leadName = (lead as any)?.name;
        const customerName = leadName && leadName !== phone ? leadName : (profileName || phone);

        const result = await processAppointmentIntent({
          tenantId,
          businessId,
          leadId,
          business,
          thread: threadState,
          customerName,
          phone,
          email: (lead as any)?.email || null,
          incomingMessage: body,
          conversationContext,
        });

        // Persist any pendingAction change made by the agent via a direct
        // update (NOT thread.save()) since `thread` here is a step-memoized
        // object, not a live Mongoose document.
        if (JSON.stringify(threadState.pendingAction) !== JSON.stringify(thread.pendingAction || null)) {
          await ConversationThread.findByIdAndUpdate(threadId, { pendingAction: threadState.pendingAction });
        }

        return { ...result, contextBlock, pendingAction: threadState.pendingAction };
      } catch (e) {
        console.error('[whatsapp-agent] appointment-intent step error (falling back to generic AI):', e);
        return { handled: false, contextBlock, pendingAction: thread.pendingAction || null };
      }
    });

    if (appointmentOutcome.handled && appointmentOutcome.reply) {
      const aiReply = appointmentOutcome.reply;

      const outboundResult = await step.run("send-outbound-appointment-reply", async () => {
        return await sendOutboundMessage(phone, aiReply, leadId, businessId);
      });

      await step.run("log-outbound-appointment-reply", async () => {
        await Conversation.create({
          tenantId,
          businessId,
          leadId,
          threadId,
          direction: 'outbound',
          messageText: aiReply,
          isAI: true,
          messageStatus: outboundResult.success ? 'sent' : 'failed',
          twilioSid: outboundResult.sid || 'pending'
        });

        await ConversationThread.findByIdAndUpdate(threadId, {
          lastMessage: aiReply,
          lastActivityAt: new Date()
        });

        await Activity.create({
          tenantId,
          leadId,
          type: 'WhatsApp',
          content: aiReply,
          metadata: { isAI: true, whatsappAgent: 'appointment' }
        });
      });

      // Feature 8 — keep the structured conversation summary current.
      // Best-effort: failures here must never affect message delivery.
      await step.run("refresh-conversation-summary", async () => {
        try {
          const { refreshConversationSummary } = await import("@/services/whatsapp-agent/summaryService");
          const { getRecentChatHistory } = await import("@/services/whatsapp-agent/chatHistoryService");
          const history = await getRecentChatHistory(leadId, 20);
          await refreshConversationSummary({ tenantId, businessId, leadId, threadId, history });
        } catch (e) {
          console.error('[whatsapp-agent] summary refresh error:', e);
        }
      });

      return { success: true, handledBy: 'whatsapp-appointment-agent' };
    }

    // 3. Generate AI Reply
    const aiReply = await step.run("generate-ai-reply", async () => {
      // Get AI Config
      let config = await BusinessAIConfig.findOne({ businessId });
      if (!config) {
        config = {
          systemPrompt: "You are an AI WhatsApp sales agent. Qualify leads and help book demos. Keep responses under 60 words.",
          aiTone: "Professional",
          salesRules: "Never discuss competitor pricing."
        };
      }
      if (config.aiEnabled === false) return null; // Global shutoff

      // Get Chat History
      const history = await Conversation.find({ leadId })
        .sort({ timestamp: -1 })
        .limit(10);
      
      const messages = history.reverse().map((msg: any) => ({
        role: msg.direction === 'inbound' ? 'user' : 'assistant',
        content: msg.messageText
      }));

      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const contextBlock = appointmentOutcome?.contextBlock;
      const systemMessage = {
        role: 'system',
        content: `PROMPT: ${config.systemPrompt}\nTONE: ${config.aiTone}\nRULES: ${config.salesRules}${contextBlock ? `\n\nCUSTOMER CONTEXT (use naturally to personalize your reply, don't just repeat it verbatim):\n${contextBlock}` : ''}`
      };

      try {
        const response = await groq.chat.completions.create({
          messages: [systemMessage, ...messages] as any[],
          model: "llama-3.3-70b-versatile",
          temperature: 0.5,
          max_tokens: 150,
        });
        return response.choices[0]?.message?.content?.trim();
      } catch (e) {
        console.error("AI Generation Error", e);
        return null;
      }
    });

    if (!aiReply) {
      // AI handed off (config shutoff or generation failure) — a human needs
      // to pick this up. Best-effort push, never fail the workflow.
      await step.run("push-notify-ai-handoff", async () => {
        try {
          const { sendPushToBusinessUsers } = await import("@/services/push");
          const { default: LeadModel } = await import("@/models/Lead");
          const lead = await LeadModel.findById(leadId).select('name').lean() as any;
          const name = (lead?.name && lead.name !== phone ? lead.name : profileName) || phone;
          await sendPushToBusinessUsers(businessId, {
            title: 'New WhatsApp message',
            body: `New WhatsApp message from ${name}`,
            data: { leadId: String(leadId) },
          });
        } catch (e) {
          console.error('[push] whatsapp handoff notify failed:', e);
        }
      });
      return { success: true, reason: 'AI skipped or failed' };
    }

    // 4. Send Outbound
    const outboundResult = await step.run("send-outbound", async () => {
      return await sendOutboundMessage(phone, aiReply, leadId, businessId);
    });

    // 5. Log outbound message & Update Thread
    await step.run("log-outbound-msg", async () => {
      await Conversation.create({
        tenantId,
        businessId,
        leadId,
        threadId,
        direction: 'outbound',
        messageText: aiReply,
        isAI: true,
        messageStatus: outboundResult.success ? 'sent' : 'failed',
        twilioSid: outboundResult.sid || 'pending'
      });

      await ConversationThread.findByIdAndUpdate(threadId, {
        lastMessage: aiReply,
        lastActivityAt: new Date()
      });

      // Update CRM Timeline
      await Activity.create({
        tenantId,
        leadId,
        type: 'WhatsApp',
        content: aiReply,
        metadata: { isAI: true }
      });
    });

    // 6. Detect booking intent and create Appointment record if confirmed
    await step.run("detect-booking", async () => {
      const { Groq } = await import("groq-sdk");
      const { default: LeadModel } = await import("@/models/Lead");
      const { default: AppointmentModel } = await import("@/models/Appointment");
      const { default: ActivityModel } = await import("@/models/Activity");

      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

      let classifyResult: {
        isBooking: boolean;
        proposedDate: string | null;
        serviceInterest: string | null;
        email: string | null;
      } = { isBooking: false, proposedDate: null, serviceInterest: null, email: null };

      try {
        const resp = await groq.chat.completions.create({
          messages: [{
            role: 'user',
            content: `Given this AI sales reply: "${aiReply}" — does it confirm or propose a specific appointment or demo booking? Extract any details mentioned. Reply with valid JSON only:\n{"isBooking": boolean, "proposedDate": "ISO date string or null", "serviceInterest": "string or null", "email": "email string or null"}`
          }],
          model: "llama-3.3-70b-versatile",
          max_tokens: 100,
          temperature: 0,
          response_format: { type: "json_object" }
        });
        classifyResult = JSON.parse(resp.choices[0]?.message?.content || '{}');
      } catch (e) {
        console.error("Booking classifier error:", e);
        return { booked: false };
      }

      if (!classifyResult.isBooking) return { booked: false };

      const lead = await LeadModel.findById(leadId).select('interest email').lean() as any;

      let parsedDate: Date | null = null;
      if (classifyResult.proposedDate) {
        const d = new Date(classifyResult.proposedDate);
        if (!isNaN(d.getTime())) parsedDate = d;
      }

      await AppointmentModel.create({
        leadId,
        businessId,
        tenantId,
        proposedDate: parsedDate,
        serviceInterest: classifyResult.serviceInterest || lead?.interest || null,
        email: classifyResult.email || lead?.email || null,
        source: 'WhatsApp AI',
        status: 'Pending Confirmation',
      });

      await ActivityModel.create({
        tenantId,
        leadId,
        type: 'meeting',
        content: 'AI booked a demo via WhatsApp — pending confirmation',
      });

      return { booked: true };
    });

    // Feature 8 — keep the structured conversation summary current for the
    // generic sales-chat path too. Best-effort only: any failure here is
    // logged and swallowed so it can never affect message delivery or the
    // rest of the (unmodified) WhatsApp flow above.
    await step.run("refresh-conversation-summary-generic", async () => {
      try {
        const { refreshConversationSummary } = await import("@/services/whatsapp-agent/summaryService");
        const { getRecentChatHistory } = await import("@/services/whatsapp-agent/chatHistoryService");
        const history = await getRecentChatHistory(leadId, 20);
        await refreshConversationSummary({ tenantId, businessId, leadId, threadId, history });
      } catch (e) {
        console.error('[whatsapp-agent] summary refresh error (generic path):', e);
      }
    });

    return { success: true };
  }
);

// 2. Lead Follow Up Workflow (Distributed queue replacement for synchronous cron)
export const followUpCron = inngest.createFunction(
  { id: "follow-up-cron", triggers: [{ cron: "0 * * * *" }] }, // Runs every hour
  async ({ step }) => {
    // Step 1: Find leads, but don't send Twilio messages here. Just dispatch jobs.
    const events = await step.run("fetch-leads-for-followup", async () => {
      await dbConnect();
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const activeLeads = await Lead.find({ status: { $nin: ['Converted', 'Lost'] }, lastInteractionTime: { $lte: oneDayAgo } });

      const eventsToDispatch = [];
      for (const lead of activeLeads) {
        const interactionDelta = now.getTime() - (lead.lastInteractionTime?.getTime() || lead.updatedAt.getTime());
        let reminderType = '';
        if (interactionDelta >= 7 * 24 * 60 * 60 * 1000) reminderType = 'Final Reconnect';
        else if (interactionDelta >= 3 * 24 * 60 * 60 * 1000) reminderType = '3-Day Check-in';
        else reminderType = '24h Reminder';

        const existingFollowUp = await FollowUp.findOne({ leadId: lead._id, reminderType, completed: true });
        if (!existingFollowUp) {
          eventsToDispatch.push({
            name: "scheduler/follow-up",
            data: { leadId: lead._id.toString(), reminderType }
          });
        }
      }
      return eventsToDispatch;
    });

    // Step 2: Dispatch individual, retryable jobs
    if (events.length > 0) {
      await step.sendEvent("dispatch-followup-jobs", events);
    }
    
    return { success: true, dispatched: events.length };
  }
);

export const processFollowUpJob = inngest.createFunction(
  { id: "process-followup-job", retries: 3, triggers: [{ event: "scheduler/follow-up" }] },
  async ({ event, step }) => {
    const { leadId, reminderType } = event.data;

    await dbConnect();
    const lead = await Lead.findById(leadId);
    if (!lead || lead.status === 'Converted' || lead.status === 'Lost') return { skipped: true };

    let messageBody = '';
    if (reminderType === '24h Reminder') messageBody = `Hi ${lead.name !== lead.phone ? lead.name : 'there'}, just checking in to see if you had any questions about our previous chat?`;
    else if (reminderType === '3-Day Check-in') messageBody = `Hi again. Let me know if you still need help sorting out your business needs! We're here when you're ready.`;
    else messageBody = `It's been a while, so I'll close out your request for now. If you ever need help again, just reply to this message!`;

    // Try to send first
    await step.run("send-followup-message", async () => {
      await sendOutboundMessage(lead.phone, messageBody, leadId);
    });

    // Only mark completed AFTER successful send (fixes the previous fatal flaw)
    await step.run("mark-completed", async () => {
      await FollowUp.create({ leadId, scheduledAt: new Date(), completed: true, reminderType });
      if (reminderType === 'Final Reconnect') {
        lead.status = 'Lost';
        await lead.save();
      }
      await Conversation.create({ leadId, sender: 'system', message: messageBody, aiGenerated: true, messageType: 'text' });
    });

    return { success: true };
  }
);

// 3. Content Scheduler Automation Workflow (Module 3)
export const bufferMonitorWorker = inngest.createFunction(
  { id: "buffer-monitor-worker", triggers: [{ cron: "0 8 * * *" }] }, // Daily at 8 AM
  async ({ step }) => {
    const businesses = await step.run("fetch-businesses", async () => {
      await dbConnect();
      return await Business.find({ isActive: true }).select('_id').lean();
    });

    const events = businesses.map(b => ({
      name: "scheduler/generate",
      data: { businessId: b._id.toString() }
    }));

    if (events.length > 0) {
      await step.sendEvent("dispatch-content-jobs", events);
    }
    return { success: true, dispatched: events.length };
  }
);

export const manualContentGenerate = inngest.createFunction(
  { id: "manual-content-generate", triggers: [{ event: "scheduler/manual-generate" }] },
  async ({ event, step }) => {
    // Allows the UI to explicitly request generation
    await step.sendEvent("dispatch-manual-generation", {
      name: "scheduler/generate",
      data: event.data
    });
    return { success: true };
  }
);

export const processContentJob = inngest.createFunction(
  { id: "process-content-job", retries: 3, triggers: [{ event: "scheduler/generate" }] },
  async ({ event, step }) => {
    const { businessId, force } = event.data;
    
    await dbConnect();
    const business = await Business.findById(businessId);
    if (!business) return { skipped: true };

    const MIN_SCHEDULED_POSTS = 7;
    const today = new Date();

    const futurePosts = await step.run("fetch-future-posts", async () => {
      const { default: Post } = await import("@/models/Post");
      return await Post.find({
        businessId: business._id,
        scheduledDate: { $gt: today },
        status: "scheduled"
      }).sort({ scheduledDate: 1 }).lean();
    });

    if (!force && futurePosts.length >= MIN_SCHEDULED_POSTS) {
      return { success: true, message: "Buffer Healthy" };
    }

    // Alert Admin if buffer is low during cron check
    if (!force && futurePosts.length < 4) {
      await step.run("alert-admin-low-buffer", async () => {
        const msg = `⚠️ *Marketing Alert*\nBuffer for ${business.name} is running critically low (${futurePosts.length} posts remaining). Generating new content now.`;
        if (business.phone) await sendOutboundMessage(business.phone, msg);
      });
    }

    try {
      // Guard: a real business created through onboarding always has organizationId.
      // If it's missing, that's a data bug — log and skip rather than using a fake tenant.
      const tenantId = business.organizationId?.toString();
      if (!tenantId) {
        console.error(
          `[processContentJob] Skipping businessId=${business._id} — missing organizationId. ` +
          `This business was not created through the onboarding flow.`
        );
        return { skipped: true, reason: 'missing organizationId' };
      }

      await step.run(`generate-and-save-buffer`, async () => {
        const { default: Post } = await import("@/models/Post");

        const aiResponse = await generateAIContent({
          businessName: business.name || 'Local Business',
          businessType: business.category || 'Local Business',
          location: business.address || 'Local Area',
          keywords: business.keywords || ['services'],
          tone: 'Professional',
          contentTypes: ['GMB Posts']
        });

        if (!aiResponse || !aiResponse.posts) throw new Error("Empty AI content returned");

        let lastScheduledDate = futurePosts.length > 0
          ? new Date(futurePosts[futurePosts.length - 1].scheduledDate || new Date())
          : new Date();

        for (const generatedPost of aiResponse.posts) {
           const nextDate = new Date(lastScheduledDate);
           nextDate.setDate(nextDate.getDate() + 1);
           lastScheduledDate = nextDate;

           await Post.create({
             tenantId,
             title: generatedPost.title,
             content: generatedPost.body,
             postType: generatedPost.postType,
             cta: generatedPost.cta,
             hashtags: generatedPost.hashtags,
             status: "scheduled",
             platform: "gmb",
             aiGenerated: true,
             scheduledDate: nextDate,
             businessId: business._id,
             automationMetadata: {
               generatedVia: force ? 'manual' : 'cron',
             }
           });
        }

        await AutomationLog.create({
          tenantId,
          businessId: business._id.toString(),
          type: 'ai_generation',
          workflow: 'content-scheduler',
          action: 'generate_post_batch',
          status: 'success',
        });
      });
    } catch (error: any) {
      await step.run("alert-admin-generation-failed", async () => {
        const msg = `❌ *Marketing Alert*\nFailed to generate content for ${business.name}. Please check the dashboard.`;
        if (business.phone) await sendOutboundMessage(business.phone, msg);

        const tenantIdForLog = business.organizationId?.toString() ?? business._id.toString();
        await AutomationLog.create({
          tenantId: tenantIdForLog,
          businessId: business._id.toString(),
          type: 'ai_generation',
          workflow: 'content-scheduler',
          action: 'generate_post_batch',
          status: 'failed',
          error: error.message
        });
      });
      throw error;
    }

    return { success: true };
  }
);

// 4. AI Review Campaigns (Module 9) — WhatsApp-only review requests with
// owner-configurable reminder delays, editable message templates, group
// targeting, business-hours sending, and stop-on-review.

const DEFAULT_REMINDER_1 = `Hi {{name}}, just a quick reminder! We'd really appreciate a review of your recent {{service}}: {{link}}\nReply STOP to opt-out.`;
const DEFAULT_REMINDER_2 = `Hi {{name}}, last bother from us! If you have a minute, a review would mean the world to our team at {{business}}: {{link}}\nReply STOP to opt-out.`;

interface TemplateVars { name: string; service: string; business: string; link: string; }

function fillTemplate(tpl: string, vars: TemplateVars): string {
  let msg = tpl
    .replace(/\{\{\s*name\s*\}\}/gi, vars.name)
    .replace(/\{\{\s*service\s*\}\}/gi, vars.service)
    .replace(/\{\{\s*business\s*\}\}/gi, vars.business)
    .replace(/\{\{\s*link\s*\}\}/gi, vars.link);
  // The review link must always reach the customer, even if the owner's
  // template forgot the {{link}} placeholder.
  if (!msg.includes(vars.link)) msg += `\n${vars.link}`;
  return msg;
}

// ISO date of the next moment inside the business-hours window, or null if already inside it.
function nextBizHourDate(startHour: number, endHour: number): string | null {
  const now = new Date();
  const h = now.getHours();
  if (h >= startHour && h < endHour) return null;
  const next = new Date(now);
  if (h >= endHour) next.setDate(next.getDate() + 1);
  next.setHours(startHour, 0, 0, 0);
  return next.toISOString();
}

export const processReviewCampaign = inngest.createFunction(
  { id: "process-review-campaign", retries: 3, triggers: [{ event: "campaigns/review.request.start" }] },
  async ({ event, step }) => {
    const { customerId, businessId, tenantId, campaignId } = event.data;

    await dbConnect();

    // 1. Load the owner's campaign settings (defaults for one-off sends)
    const config = await step.run("load-config", async () => {
      const defaults = {
        initialMessage: '',
        reminder1Enabled: true, reminder1AfterDays: 2, reminder1Message: '',
        reminder2Enabled: true, reminder2AfterDays: 5, reminder2Message: '',
        stopOnReview: true, sendOnlyBizHours: false, bizHoursStart: 9, bizHoursEnd: 20,
      };
      if (!campaignId) return defaults;
      const campaign: any = await Campaign.findById(campaignId).lean();
      if (!campaign) return defaults;
      return {
        initialMessage: campaign.initialMessage || '',
        reminder1Enabled: campaign.reminder1Enabled ?? true,
        reminder1AfterDays: campaign.reminder1AfterDays ?? 2,
        reminder1Message: campaign.reminder1Message || '',
        reminder2Enabled: campaign.reminder2Enabled ?? true,
        reminder2AfterDays: campaign.reminder2AfterDays ?? 5,
        reminder2Message: campaign.reminder2Message || '',
        stopOnReview: campaign.stopOnReview ?? true,
        sendOnlyBizHours: campaign.sendOnlyBizHours ?? false,
        bizHoursStart: campaign.bizHoursStart ?? 9,
        bizHoursEnd: campaign.bizHoursEnd ?? 20,
      };
    });

    // 2. Fetch customer + business name; WhatsApp-only so a phone is required
    const target = await step.run("fetch-customer", async () => {
      const customer: any = await Customer.findById(customerId).lean();
      const business: any = await Business.findById(businessId).select('name').lean();
      return { customer, businessName: business?.name || 'our business' };
    });

    const { customer, businessName } = target as any;
    if (!customer || customer.optedOut) return { skipped: true, reason: 'Customer opted out or not found' };
    if (!customer.phone) return { skipped: true, reason: 'Customer has no phone number (WhatsApp required)' };

    // 3. Create the request log first so the tracking link exists
    const reviewRequest = await step.run("create-request-log", async () => {
      const req = await ReviewRequest.create({
        tenantId,
        businessId,
        customerId,
        channel: 'whatsapp',
        message: 'pending generation',
        status: 'Pending',
        ...(campaignId && { campaignId })
      });
      return req.toObject();
    });

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const trackLink = `${baseUrl}/api/campaigns/track/${reviewRequest._id}`;
    const templateVars: TemplateVars = {
      name: customer.name || 'there',
      service: customer.service || 'visit',
      business: businessName,
      link: trackLink,
    };

    // 4. Build the initial message: the owner's edited template wins;
    //    otherwise fall back to AI generation per customer.
    const initialMessage = await step.run("build-initial-message", async () => {
      let msg = '';
      if (config.initialMessage.trim()) {
        msg = fillTemplate(config.initialMessage, templateVars);
      } else {
        try {
          const { Groq } = await import("groq-sdk");
          const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
          const prompt = `You are a customer success assistant. Write a short, warm, 2-sentence WhatsApp review request for ${templateVars.name} from ${businessName}. Mention they recently got ${templateVars.service}. Ask them to leave a review using this link: ${trackLink}. Include: Reply STOP to opt-out.`;
          const response = await groq.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 150,
          });
          msg = response.choices[0]?.message?.content?.trim() || '';
        } catch (e) {
          msg = '';
        }
        if (!msg) msg = `Hi ${templateVars.name}! We'd love a review of your recent ${templateVars.service}: ${trackLink}\nReply STOP to opt-out.`;
        if (!msg.includes(trackLink)) msg += `\n${trackLink}`;
      }
      await ReviewRequest.findByIdAndUpdate(reviewRequest._id, { message: msg });
      return msg;
    });

    // 5. Respect the owner's business-hours window for the initial send
    if (config.sendOnlyBizHours) {
      const wakeAt = await step.run("compute-initial-send-time", async () =>
        nextBizHourDate(config.bizHoursStart, config.bizHoursEnd));
      if (wakeAt) await step.sleepUntil("wait-biz-hours-initial", wakeAt);
    }

    // 6. Send the initial WhatsApp message. On a Twilio rejection the request
    //    is marked Failed (never "Sent") and the reminder sequence is skipped.
    const initialSend = await step.run("send-initial-message", async () => {
      const result = await sendOutboundMessage(customer.phone, initialMessage, undefined, businessId);

      if (!result.success) {
        await ReviewRequest.findByIdAndUpdate(reviewRequest._id, {
          status: 'Failed',
          automationStatus: 'Stopped',
        });
        await Customer.findByIdAndUpdate(customerId, { reviewStatus: 'Failed' });
        return { sent: false, error: result.error };
      }

      await ReviewRequest.findByIdAndUpdate(reviewRequest._id, { status: 'Sent', sentAt: new Date(), followUpStage: 0 });
      await Customer.findByIdAndUpdate(customerId, {
        reviewStatus: 'Requested',
        lastMessageAt: new Date(),
        $inc: { totalMessagesSent: 1 }
      });
      if (campaignId) {
        await Campaign.findByIdAndUpdate(campaignId, { $inc: { delivered: 1 } });
      }
      return { sent: true, error: undefined as string | undefined };
    });

    if (!initialSend.sent) {
      return { success: false, reason: `WhatsApp send failed: ${initialSend.error}` };
    }

    // Reminder gate: no reminder once the customer opted out, clicked the
    // link, left a review (when stopOnReview), or the campaign was paused.
    const shouldRemind = async () => {
      const req: any = await ReviewRequest.findById(reviewRequest._id).lean();
      const cust: any = await Customer.findById(customerId).lean();
      if (!req || !cust || cust.optedOut || req.clicked) return false;
      if (config.stopOnReview && req.reviewReceived) return false;
      if (campaignId) {
        const camp: any = await Campaign.findById(campaignId).select('status').lean();
        if (camp && camp.status !== 'ACTIVE') return false;
      }
      return true;
    };

    // 7. Reminder 1 — after the owner's configured number of days
    if (config.reminder1Enabled) {
      await step.sleep("wait-reminder-1", `${config.reminder1AfterDays}d`);
      const sendRem1 = await step.run("check-status-1", shouldRemind);
      if (sendRem1) {
        if (config.sendOnlyBizHours) {
          const wakeAt = await step.run("compute-rem1-send-time", async () =>
            nextBizHourDate(config.bizHoursStart, config.bizHoursEnd));
          if (wakeAt) await step.sleepUntil("wait-biz-hours-rem1", wakeAt);
        }
        await step.run("send-reminder-1", async () => {
          // Re-read the template so owner edits made after launch still apply
          let tpl = config.reminder1Message;
          if (campaignId) {
            const camp: any = await Campaign.findById(campaignId).select('reminder1Message').lean();
            if (camp) tpl = camp.reminder1Message || '';
          }
          const msg = fillTemplate(tpl.trim() || DEFAULT_REMINDER_1, templateVars);
          const result = await sendOutboundMessage(customer.phone, msg, undefined, businessId);
          if (!result.success) {
            console.warn(`[reviewCampaign] Reminder 1 failed for request ${reviewRequest._id}: ${result.error}`);
            return;
          }
          await ReviewRequest.findByIdAndUpdate(reviewRequest._id, { followUpStage: 1 });
          await Customer.findByIdAndUpdate(customerId, { lastMessageAt: new Date(), $inc: { totalMessagesSent: 1 } });
        });
      }
    }

    // 8. Reminder 2 (final) — delay counts from reminder 1
    if (config.reminder2Enabled) {
      await step.sleep("wait-reminder-2", `${config.reminder2AfterDays}d`);
      const sendRem2 = await step.run("check-status-2", shouldRemind);
      if (sendRem2) {
        if (config.sendOnlyBizHours) {
          const wakeAt = await step.run("compute-rem2-send-time", async () =>
            nextBizHourDate(config.bizHoursStart, config.bizHoursEnd));
          if (wakeAt) await step.sleepUntil("wait-biz-hours-rem2", wakeAt);
        }
        await step.run("send-reminder-2", async () => {
          // Re-read the template so owner edits made after launch still apply
          let tpl = config.reminder2Message;
          if (campaignId) {
            const camp: any = await Campaign.findById(campaignId).select('reminder2Message').lean();
            if (camp) tpl = camp.reminder2Message || '';
          }
          const msg = fillTemplate(tpl.trim() || DEFAULT_REMINDER_2, templateVars);
          const result = await sendOutboundMessage(customer.phone, msg, undefined, businessId);
          if (!result.success) {
            console.warn(`[reviewCampaign] Final reminder failed for request ${reviewRequest._id}: ${result.error}`);
            return;
          }
          await ReviewRequest.findByIdAndUpdate(reviewRequest._id, { followUpStage: 2 });
          await Customer.findByIdAndUpdate(customerId, { lastMessageAt: new Date(), $inc: { totalMessagesSent: 1 } });
        });
      }
    }

    // 9. Close out this customer's automation
    await step.run("mark-completed", async () => {
      await ReviewRequest.findByIdAndUpdate(reviewRequest._id, { automationStatus: 'Completed' });
    });

    return { success: true };
  }
);

// 5. Review Autopoll
export const reviewAutopollCron = inngest.createFunction(
  { id: "review-autopoll-cron", triggers: [{ cron: "0 * * * *" }] },
  async ({ step }) => {
    // Heuristic: a request whose link was clicked >2h ago and never followed
    // up counts as a received review (no GBP API to match against yet).
    const events = await step.run("fetch-clicked-requests", async () => {
      await dbConnect();
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const clicked = await ReviewRequest.find({
        clicked: true,
        reviewReceived: { $ne: true },
        clickedAt: { $lte: twoHoursAgo }
      }).lean();
      return clicked.map(c => ({ name: "scheduler/review-autopoll", data: { requestId: c._id.toString() } }));
    });

    if (events.length > 0) {
      await step.sendEvent("dispatch-autopoll", events);
    }
    return { success: true };
  }
);

export const processReviewAutopollJob = inngest.createFunction(
  { id: "process-review-autopoll-job", retries: 3, triggers: [{ event: "scheduler/review-autopoll" }] },
  async ({ event, step }) => {
    await step.run("mark-reviewed", async () => {
      await dbConnect();
      const req = await ReviewRequest.findById(event.data.requestId);
      if (!req || req.reviewReceived) return;

      req.reviewReceived = true;
      req.reviewedAt = new Date();
      req.automationStatus = 'Completed';
      await req.save();

      await Customer.findByIdAndUpdate(req.customerId, { reviewStatus: 'Completed' });
      if (req.campaignId) {
        await Campaign.findByIdAndUpdate(req.campaignId, { $inc: { reviewsReceived: 1 } });
      }

      const customer: any = await Customer.findById(req.customerId).select('name').lean();
      const { notifyBusinessUsers } = await import("@/services/notifications");
      await notifyBusinessUsers(req.businessId.toString(), {
        type: 'review_received',
        title: 'Review request converted',
        body: `${customer?.name || 'A customer'} followed your review link — a new review is likely in.`,
        link: '/dashboard/reviews',
      });
    });
    return { success: true };
  }
);

// 6. Post Publishing Worker
export const publishScheduledPostsCron = inngest.createFunction(
  { id: "publish-scheduled-posts-cron", triggers: [{ cron: "*/15 * * * *" }] }, // Run every 15 minutes
  async ({ step }) => {
    const events = await step.run("fetch-posts-to-publish", async () => {
      await dbConnect();
      const { default: Post } = await import("@/models/Post");
      const now = new Date();
      const readyPosts = await Post.find({
        status: "scheduled",
        scheduledDate: { $lte: now }
      }).lean();

      return readyPosts.map((p: any) => ({
        name: "scheduler/publish-post",
        data: { postId: p._id.toString() }
      }));
    });

    if (events.length > 0) {
      await step.sendEvent("dispatch-publish-jobs", events);
    }
    return { success: true, dispatched: events.length };
  }
);

export const processPublishPostJob = inngest.createFunction(
  { id: "process-publish-post-job", retries: 3, triggers: [{ event: "scheduler/publish-post" }] },
  async ({ event, step }) => {
    const { postId } = event.data;
    
    await step.run("publish-to-gmb", async () => {
      await dbConnect();
      const { default: Post } = await import("@/models/Post");
      const post = await Post.findById(postId);
      if (!post || post.status !== "scheduled") return;

      // SAFETY: pushing a post to a real Google Business Profile is gated behind
      // GBP_LIVE_WRITES_ENABLED (off by default). While disabled we only mark the
      // post published in our own DB — nothing reaches the customer's live profile.
      // Any real Google "localPosts.create" call MUST live inside the enabled branch.
      const { gbpWritesEnabled } = await import("@/lib/gbpSafety");
      if (gbpWritesEnabled()) {
        // TODO: real Google Business Profile localPosts.create call goes here,
        // once verified on a test account.
        throw new Error("Live GBP post publishing is not implemented yet.");
      } else {
        console.log(`[MOCK] GBP live writes disabled — marking post published locally only for business ${post.businessId}: ${post.title}`);
      }

      post.status = "published";
      post.publishedAt = new Date();
      await post.save();
      
      await AutomationLog.create({
        tenantId: post.tenantId?.toString(),
        businessId: post.businessId?.toString(),
        type: 'inngest_job',
        workflow: 'publish-cron',
        action: 'publish_post',
        status: 'success',
      });
    });
    
    return { success: true };
  }
);

// 7. Generate Audit Job
export const generateAuditJob = inngest.createFunction(
  { id: 'generate-audit', triggers: [{ event: 'audit/generate.requested' }] },
  async ({ event, step }) => {
    const { auditId } = event.data;

    // Pull fresh reviews before scoring so the audit sees current data.
    // If the sync fails for any reason, we fall through and use whatever
    // reviews are already in the DB rather than blocking the whole audit.
    await step.run('pre-sync-reviews', async () => {
      try {
        const dbConnect = (await import('@/lib/mongodb')).default;
        await dbConnect();
        const { default: Audit } = await import('@/models/Audit');
        const audit = await Audit.findById(auditId).select('businessId tenantId').lean();
        if (!audit) {
          console.warn(`[generate-audit] Audit ${auditId} not found for pre-sync`);
          return;
        }
        const { syncReviewsForBusiness } = await import('@/services/reviews/syncReviews');
        const tenantId = (audit as any).tenantId ?? (audit as any).businessId.toString();
        await syncReviewsForBusiness((audit as any).businessId.toString(), tenantId);
        console.log(`[generate-audit] Pre-sync complete for businessId=${(audit as any).businessId}`);
      } catch (err: any) {
        console.warn('[generate-audit] Pre-sync failed — proceeding with existing reviews:', err.message);
        // Intentionally not rethrowing: a stale sync is better than a blocked audit
      }
    });

    await step.run('process-audit', async () => {
      const { processAuditJob } = await import('@/services/audit/auditService');
      await processAuditJob(auditId);
    });

    // Kick off the WhatsApp sales nurture drip (delay + follow-ups are handled
    // by the salesNurtureRequested function per the super-admin config).
    await step.sendEvent('start-sales-nurture', {
      name: 'sales/nurture.requested',
      data: { auditId },
    });

    return { success: true, auditId };
  }
);

// 7b. WhatsApp Sales Nurture drip (platform → lead, after a free audit).
// Timing (first-message delay + follow-up delays) and content come from the
// super-admin SalesAgentConfig. Durable sleeps survive restarts.
export const salesNurtureRequested = inngest.createFunction(
  { id: 'sales-nurture-requested', triggers: [{ event: 'sales/nurture.requested' }] },
  async ({ event, step }) => {
    const { auditId } = event.data;

    const prep = await step.run('prepare-nurture', async () => {
      const dbConnect = (await import('@/lib/mongodb')).default;
      await dbConnect();
      const { getSalesAgentConfig, extractScores, firstName } = await import('@/services/sales/salesAgent');
      const { default: Audit } = await import('@/models/Audit');
      const { default: Business } = await import('@/models/Business');
      const { default: User } = await import('@/models/User');
      const { default: SalesConversation } = await import('@/models/SalesConversation');
      const { isWorkspaceUnlocked } = await import('@/lib/workspaceAccess');

      const config = await getSalesAgentConfig();
      if (!config.enabled) return { skip: 'agent disabled' as const };

      const audit: any = await Audit.findById(auditId).lean();
      if (!audit || audit.status !== 'COMPLETED') return { skip: 'audit not completed' as const };

      const business: any = await Business.findById(audit.businessId).lean();
      if (!business) return { skip: 'no business' as const };
      if (business.auditNurtureSentAt) return { skip: 'already sent' as const };

      const owner: any = business.userId
        ? await User.findById(business.userId).select('fullName phone subscriptionPlan').lean()
        : null;
      if (isWorkspaceUnlocked({ subscriptionStatus: business.subscriptionStatus, userSubscriptionPlan: owner?.subscriptionPlan })) {
        return { skip: 'already subscribed' as const };
      }
      const phone = owner?.phone || business.phone;
      if (!phone) return { skip: 'no phone' as const };

      const { normalizePhoneE164, phoneDedupeKey } = await import('@/lib/phone');
      const scores = extractScores(audit, business);
      const convo = await SalesConversation.create({
        businessId: business._id,
        auditId: audit._id,
        leadPhone: normalizePhoneE164(phone) || phone,
        phoneKey: phoneDedupeKey(phone),
        leadName: owner?.fullName || business.name || '',
        status: 'active',
        scores,
      });
      // Send-once guard so re-runs don't double-message.
      await Business.updateOne({ _id: business._id }, { $set: { auditNurtureSentAt: new Date() } });

      return {
        conversationId: convo._id.toString(),
        phone,
        leadName: owner?.fullName || '',
        firstDelayMinutes: Math.max(0, config.firstMessage.delayMinutes || 0),
        followUpCount: config.followUps.length,
      };
    });

    if ('skip' in prep) return { skipped: prep.skip };

    if (prep.firstDelayMinutes > 0) {
      await step.sleep('wait-before-first', `${prep.firstDelayMinutes}m`);
    }

    // Send first message.
    await step.run('send-first-message', async () => {
      const dbConnect = (await import('@/lib/mongodb')).default;
      await dbConnect();
      const { default: SalesConversation } = await import('@/models/SalesConversation');
      const { getSalesAgentConfig, composeFirstMessage } = await import('@/services/sales/salesAgent');
      const { sendOutboundMessage } = await import('@/services/whatsapp/send');

      const convo: any = await SalesConversation.findById(prep.conversationId);
      if (!convo || convo.status !== 'active') return;
      const config = await getSalesAgentConfig();
      const msg = await composeFirstMessage(config, convo.scores, convo.leadName);
      const res = await sendOutboundMessage(convo.leadPhone, msg, undefined, convo.businessId.toString());
      if (res.success) {
        convo.messages.push({ role: 'agent', text: msg, at: new Date() });
        convo.firstSentAt = new Date();
        convo.lastAgentAt = new Date();
        await convo.save();
      }
    });

    // Follow-up drip.
    for (let i = 0; i < prep.followUpCount; i++) {
      const cfg = await step.run(`load-followup-${i}`, async () => {
        const { getSalesAgentConfig } = await import('@/services/sales/salesAgent');
        const config = await getSalesAgentConfig();
        const f = config.followUps[i];
        return f ? { delayHours: Math.max(0, f.delayHours || 0), onlyIfNoReply: f.onlyIfNoReply } : null;
      });
      if (!cfg) break;

      if (cfg.delayHours > 0) {
        await step.sleep(`wait-followup-${i}`, `${cfg.delayHours}h`);
      }

      const stop = await step.run(`send-followup-${i}`, async () => {
        const dbConnect = (await import('@/lib/mongodb')).default;
        await dbConnect();
        const { default: SalesConversation } = await import('@/models/SalesConversation');
        const { getSalesAgentConfig, composeFollowUp } = await import('@/services/sales/salesAgent');
        const { sendOutboundMessage } = await import('@/services/whatsapp/send');

        const convo: any = await SalesConversation.findById(prep.conversationId);
        if (!convo || convo.status !== 'active') return true; // stop drip
        // If the lead engaged, hand off to the live agent — stop the drip.
        if (cfg.onlyIfNoReply && convo.lastLeadReplyAt && convo.firstSentAt && convo.lastLeadReplyAt > convo.firstSentAt) {
          return true;
        }
        const config = await getSalesAgentConfig();
        const f = config.followUps[i];
        if (!f) return true;
        const msg = await composeFollowUp(f, config, convo.scores, convo.leadName);
        const res = await sendOutboundMessage(convo.leadPhone, msg, undefined, convo.businessId.toString());
        if (res.success) {
          convo.messages.push({ role: 'agent', text: msg, at: new Date() });
          convo.lastAgentAt = new Date();
          convo.followUpsSent = (convo.followUpsSent || 0) + 1;
          await convo.save();
        }
        return false;
      });
      if (stop) break;
    }

    return { success: true, conversationId: prep.conversationId };
  }
);

// 7c. Live inbound reply from a sales lead → AI sales-agent response.
export const salesAgentReply = inngest.createFunction(
  { id: 'sales-agent-reply', retries: 2, triggers: [{ event: 'sales/agent.reply' }] },
  async ({ event, step }) => {
    const { conversationId } = event.data;
    await step.run('reply', async () => {
      const dbConnect = (await import('@/lib/mongodb')).default;
      await dbConnect();
      const { default: SalesConversation } = await import('@/models/SalesConversation');
      const { getSalesAgentConfig, composeAgentReply } = await import('@/services/sales/salesAgent');
      const { sendOutboundMessage } = await import('@/services/whatsapp/send');

      const convo: any = await SalesConversation.findById(conversationId);
      if (!convo || convo.status !== 'active') return;
      const config = await getSalesAgentConfig();
      if (!config.enabled) return;

      const reply = await composeAgentReply(config, convo);
      const res = await sendOutboundMessage(convo.leadPhone, reply, undefined, convo.businessId.toString());
      if (res.success) {
        convo.messages.push({ role: 'agent', text: reply, at: new Date() });
        convo.lastAgentAt = new Date();
        await convo.save();
      }
    });
    return { success: true };
  }
);

// 8. Review Management Automation Workflow (Module 4)
export const reviewSyncWorker = inngest.createFunction(
  { id: "review-sync-worker", triggers: [{ cron: "0 2 * * *" }] }, // Nightly at 2 AM
  async ({ step }) => {
    const businesses = await step.run("fetch-active-businesses", async () => {
      const dbConnect = (await import("@/lib/mongodb")).default;
      await dbConnect();
      const { default: Business } = await import("@/models/Business");
      return await Business.find({ isActive: true }).select('_id').lean();
    });

    const events = businesses.map(b => ({
      name: "reviews/sync",
      data: { businessId: b._id.toString() }
    }));

    if (events.length > 0) {
      await step.sendEvent("dispatch-review-syncs", events);
    }
    return { success: true, dispatched: events.length };
  }
);

export const processReviewSyncJob = inngest.createFunction(
  { id: "process-review-sync-job", retries: 3, triggers: [{ event: "reviews/sync" }] },
  async ({ event, step }) => {
    const { businessId } = event.data;
    await step.run("sync-reviews-from-provider", async () => {
      const dbConnect = (await import('@/lib/mongodb')).default;
      await dbConnect();
      const { default: Business } = await import('@/models/Business');
      const business = await Business.findById(businessId).select('organizationId').lean();
      const tenantId = (business as any)?.organizationId?.toString() ?? businessId;
      const { syncReviewsForBusiness } = await import('@/services/reviews/syncReviews');
      await syncReviewsForBusiness(businessId, tenantId);
    });
    return { success: true };
  }
);

export const criticalAlertWorker = inngest.createFunction(
  { id: "critical-review-alert-worker", triggers: [{ event: "reviews/critical-alert" }] },
  async ({ event, step }) => {
    // rating/reviewId are additive fields on the event (older events may omit them)
    const { businessId, rating, reviewId } = event.data;

    const dbConnect = (await import("@/lib/mongodb")).default;
    await dbConnect();
    const { default: Business } = await import("@/models/Business");
    const business = await Business.findById(businessId);
    if (!business) return { skipped: true, reason: "Business not found" };

    // Mobile push to every user of this business — best-effort.
    await step.run("send-push-alert", async () => {
      try {
        const { sendPushToBusinessUsers } = await import("@/services/push");
        await sendPushToBusinessUsers(businessId, {
          title: 'Reputation alert',
          body:
            typeof rating === 'number'
              ? `New ${rating}★ review needs your attention`
              : 'New critical review needs your attention',
          data: reviewId ? { reviewId: String(reviewId) } : {},
        });
      } catch (e) {
        console.error('[push] critical review notify failed:', e);
      }
    });

    // In-app dashboard notification (bell icon) — best-effort.
    await step.run("create-dashboard-notification", async () => {
      const { notifyBusinessUsers } = await import("@/services/notifications");
      await notifyBusinessUsers(businessId, {
        type: 'critical_review',
        title: 'Critical review received',
        body:
          typeof rating === 'number'
            ? `${business.name} received a ${rating}★ review — respond quickly to protect your rating.`
            : `${business.name} received a critical review — respond quickly to protect your rating.`,
        link: '/dashboard/reviews',
      });
    });

    if (!business.phone) return { success: true, reason: "No phone for WhatsApp alert" };

    await step.run("send-twilio-alert", async () => {
      const msg = `🚨 *Reputation Alert*\n${business.name} just received a critical/1-star review. Please check your Reputation Dashboard immediately to generate an AI response.`;
      await sendOutboundMessage(business.phone, msg, undefined, business._id.toString());
    });

    return { success: true };
  }
);

// 8b. Push alert when AI drafts a review reply that awaits human approval.
// Emitted by services/reviews.ts processNewReviews (same service→event
// pattern as reviews/critical-alert above).
export const reviewReplyDraftedWorker = inngest.createFunction(
  { id: "review-reply-drafted-worker", triggers: [{ event: "reviews/reply-drafted" }] },
  async ({ event, step }) => {
    const { businessId, reviewId, count } = event.data;

    await step.run("send-push-reply-drafted", async () => {
      try {
        const { sendPushToBusinessUsers } = await import("@/services/push");
        await sendPushToBusinessUsers(businessId, {
          title: 'Review reply ready',
          body:
            typeof count === 'number' && count > 1
              ? `${count} review replies are ready for approval`
              : 'Review reply ready for approval',
          data: reviewId ? { reviewId: String(reviewId) } : {},
        });
      } catch (e) {
        console.error('[push] reply-drafted notify failed:', e);
      }
    });

    await step.run("create-dashboard-notification", async () => {
      const { notifyBusinessUsers } = await import("@/services/notifications");
      await notifyBusinessUsers(businessId, {
        type: 'reply_drafted',
        title: 'Review reply ready for approval',
        body:
          typeof count === 'number' && count > 1
            ? `${count} AI-drafted review replies are waiting for your approval.`
            : 'An AI-drafted review reply is waiting for your approval.',
        link: '/dashboard/reviews',
      });
    });

    return { success: true };
  }
);

// 9. AI Lead Manager Automation Workflow (Module 5)
export const scheduleLeadFollowUpsJob = inngest.createFunction(
  { id: "schedule-lead-follow-ups", triggers: [{ event: "crm/lead-created" }] },
  async ({ event, step }) => {
    const { leadId } = event.data;

    await step.run("ai-lead-scoring", async () => {
      const dbConnect = (await import("@/lib/mongodb")).default;
      await dbConnect();
      const { default: Lead } = await import("@/models/Lead");
      const { Groq } = await import("groq-sdk");

      const lead = await Lead.findById(leadId);
      if (!lead) return;

      const scoringPrompt = `You are an AI lead qualification specialist for an education and training business.
Analyze this lead and return a JSON object with your assessment.

Lead details:
- Name: ${lead.name}
- Source: ${lead.source}
- Interest/Course: ${lead.interest || 'Not specified'}
- Notes: ${lead.notes || 'None'}
- Business Type: ${lead.businessType || 'Not specified'}

Return ONLY valid JSON in this exact shape:
{
  "score": <integer 0-100>,
  "insights": "<1-2 sentences explaining the lead's intent and recommended next action>",
  "urgency": "<High|Medium|Low>",
  "qualificationStatus": "<Hot|Warm|Cold>"
}`;

      try {
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const response = await groq.chat.completions.create({
          messages: [{ role: "user", content: scoringPrompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.3,
          max_tokens: 200,
          response_format: { type: "json_object" },
        });

        const raw = response.choices[0]?.message?.content?.trim() || "{}";
        const result = JSON.parse(raw);

        lead.aiLeadScore = typeof result.score === "number" ? Math.min(100, Math.max(0, result.score)) : 60;
        lead.aiInsights = result.insights || null;
        lead.urgency = result.urgency || null;
        lead.qualificationStatus = result.qualificationStatus || null;
      } catch (e) {
        // Fallback to rule-based score so the follow-up chain isn't blocked
        const fallbackScores: Record<string, number> = { WhatsApp: 75, Website: 65, Manual: 50 };
        lead.aiLeadScore = fallbackScores[lead.source] ?? 55;
        lead.aiInsights = null;
      }

      await lead.save();
    });

    const now = new Date();
    
    // Day 1
    const day1 = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await step.sleepUntil("wait-day-1", day1);
    await step.sendEvent("dispatch-day-1", {
      name: "crm/dispatch-whatsapp",
      data: { leadId, templateType: "Day 1 Follow-Up", scheduledDate: day1.toISOString() }
    });

    // Day 3
    const day3 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    await step.sleepUntil("wait-day-3", day3);
    await step.sendEvent("dispatch-day-3", {
      name: "crm/dispatch-whatsapp",
      data: { leadId, templateType: "Day 3 Follow-Up", scheduledDate: day3.toISOString() }
    });

    // Day 7
    const day7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await step.sleepUntil("wait-day-7", day7);
    await step.sendEvent("dispatch-day-7", {
      name: "crm/dispatch-whatsapp",
      data: { leadId, templateType: "Day 7 Final Check", scheduledDate: day7.toISOString() }
    });

    return { success: true, followUpsScheduled: 3 };
  }
);

export const dispatchWhatsappFollowUpJob = inngest.createFunction(
  { id: "dispatch-crm-whatsapp", triggers: [{ event: "crm/dispatch-whatsapp" }] },
  async ({ event, step }) => {
    const { leadId, templateType } = event.data;

    const dbConnect = (await import("@/lib/mongodb")).default;
    await dbConnect();
    const { default: Lead } = await import("@/models/Lead");
    const { default: Activity } = await import("@/models/Activity");
    const { default: FollowUp } = await import("@/models/FollowUp");

    const lead = await Lead.findById(leadId);
    if (!lead || !lead.phone) return { skipped: true, reason: "No phone or lead deleted" };

    if (lead.pipelineStage === 'Converted' || lead.pipelineStage === 'Not Interested') {
      return { skipped: true, reason: `Lead is ${lead.pipelineStage}` };
    }

    const msg = await step.run("generate-personalized-message", async () => {
      const fallbacks: Record<string, string> = {
        "Day 1 Follow-Up": `Hi ${lead.name}, thanks for your interest! We'd love to help you get started. What questions can we answer for you?`,
        "Day 3 Follow-Up": `Hi ${lead.name}, just checking in — we're still here to help you take the next step. Would you like to book a quick call?`,
        "Day 7 Final Check": `Hi ${lead.name}, this is our final check-in. If you're ready to move forward, just reply and we'll set everything up for you!`,
      };

      if (!lead.interest && !lead.notes) {
        return fallbacks[templateType] ?? fallbacks["Day 1 Follow-Up"];
      }

      try {
        const { Groq } = await import("groq-sdk");
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const prompt = `You are a friendly sales assistant for an education and training business.
Write a single short WhatsApp follow-up message (1-2 sentences, max 30 words) for:
- Lead name: ${lead.name}
- Their interest: ${lead.interest || lead.notes || 'our courses'}
- Follow-up type: ${templateType}

Output only the message text, no quotes, no formatting.`;

        const response = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.6,
          max_tokens: 80,
        });
        return response.choices[0]?.message?.content?.trim() || fallbacks[templateType];
      } catch {
        return fallbacks[templateType] ?? fallbacks["Day 1 Follow-Up"];
      }
    });

    await step.run("send-twilio-message", async () => {
      await sendOutboundMessage(lead.phone, msg);
    });

    await step.run("log-followup-and-activity", async () => {
      await FollowUp.create({
        tenantId: lead.tenantId,
        leadId: lead._id,
        scheduledFor: new Date(),
        status: 'completed',
        messageTemplate: templateType,
        completedAt: new Date(),
      });

      await Activity.create({
        tenantId: lead.tenantId,
        leadId: lead._id,
        type: "WhatsApp",
        content: `Sent ${templateType}: ${msg}`,
      });
    });

    return { success: true };
  }
);

// 10. Demo Booking Notifications Worker
export const processDemoBooking = inngest.createFunction(
  { id: "process-demo-booking", retries: 3, triggers: [{ event: "demo/booked" }] },
  async ({ event, step }) => {
    const { bookingId } = event.data;

    await step.run("send-demo-emails", async () => {
      const dbConnect = (await import("@/lib/mongodb")).default;
      await dbConnect();
      
      const { default: DemoBooking } = await import("@/models/DemoBooking");
      const booking = await DemoBooking.findById(bookingId).lean();
      
      if (!booking) return;

      // Ensure SendGrid logic can be placed here or use a helper
      const sendEmail = async (to: string, subject: string, html: string) => {
        try {
          await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: to }] }],
              from: { email: process.env.EMAIL_FROM!, name: 'Growwmatic AI' },
              subject,
              content: [{ type: 'text/html', value: html }],
            }),
          });
        } catch (error) {
          console.error('Email send error:', error);
        }
      };

      // Admin Alert
      if (process.env.ADMIN_EMAIL) {
        await sendEmail(
          process.env.ADMIN_EMAIL,
          `New Demo Booking - ${booking.name} from ${booking.company}`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">New Demo Booking!</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><b>Name</b></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${booking.name}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><b>Email</b></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${booking.email}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><b>Phone</b></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${booking.phone}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><b>Company</b></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${booking.company}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><b>Date</b></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${booking.date}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><b>Time</b></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${booking.timeSlot}</td></tr>
              </table>
            </div>
          `
        );
      }

      // Customer Confirmation
      await sendEmail(
        booking.email,
        'Demo Booking Confirmed - Growwmatic AI',
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Demo Confirmed!</h2>
            <p>Hi <b>${booking.name}</b>,</p>
            <p>Your free demo has been successfully booked!</p>
            <div style="background: #f0f7ff; border-radius: 12px; padding: 20px; margin: 20px 0;">
              <p style="margin: 0;"><b>Date:</b> ${booking.date}</p>
              <p style="margin: 8px 0 0;"><b>Time:</b> ${booking.timeSlot}</p>
            </div>
            <p>Our team will contact you shortly to confirm the meeting link.</p>
            <p style="color: #64748b; font-size: 14px;">Team Growwmatic AI</p>
          </div>
        `
      );
    });

    return { success: true };
  }
);



// ── GBP nightly sync cron ─────────────────────────────────────────────────────

export const gbpNightlySyncScheduler = inngest.createFunction(
  { id: "gbp-nightly-sync-scheduler", triggers: [{ cron: "0 3 * * *" }] },
  async ({ step }) => {
    const { default: dbConnect } = await import("@/lib/mongodb");
    const { default: BusinessModel } = await import("@/models/Business");
    await dbConnect();

    const connectedBusinesses = await BusinessModel.find(
      { googleConnected: true, isDeleted: { $ne: true } },
      { _id: 1 }
    ).lean();

    await Promise.all(
      connectedBusinesses.map((b: any) =>
        step.sendEvent(`gbp-sync-${b._id}`, {
          name: "gbp/sync.requested",
          data: { businessId: b._id.toString() },
        })
      )
    );

    return { dispatched: connectedBusinesses.length };
  }
);

export const gbpSyncWorker = inngest.createFunction(
  { id: "gbp-sync-worker", triggers: [{ event: "gbp/sync.requested" }], retries: 2 },
  async ({ event, step }) => {
    const { businessId } = event.data;

    await step.run("sync-gbp-data", async () => {
      const { default: dbConnect } = await import("@/lib/mongodb");
      const { default: GBPTokenModel } = await import("@/models/GBPToken");
      const { default: GBPInsightsModel } = await import("@/models/GBPInsights");
      const { default: GBPKeywordModel } = await import("@/models/GBPKeyword");
      const { fetchDailyMetrics, fetchSearchKeywords, GBPAuthError } =
        await import("@/lib/gbpClient");
      const { default: BusinessModel } = await import("@/models/Business");

      await dbConnect();

      const tokenDoc = await GBPTokenModel.findOne({ businessId });
      if (!tokenDoc) return { skipped: true, reason: "No token" };

      const now = new Date();
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() - 1);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 27);

      let dailyData: any[] = [];
      try {
        dailyData = await fetchDailyMetrics(businessId, startDate, endDate);
      } catch (err: any) {
        if (err instanceof GBPAuthError) {
          await BusinessModel.findByIdAndUpdate(businessId, { googleConnected: false });
          console.error(`[GBP Sync] Token revoked for ${businessId}`, err.message);
          return { skipped: true, reason: "Token revoked" };
        }
        throw err;
      }

      await Promise.all(
        dailyData.map((d: any) =>
          GBPInsightsModel.findOneAndUpdate(
            { businessId, date: new Date(d.date) },
            {
              $set: {
                businessId,
                organizationId: tokenDoc.organizationId,
                date: new Date(d.date),
                views: d.views,
                viewsMaps: d.viewsMaps,
                viewsSearch: d.viewsSearch,
                callClicks: d.callClicks,
                websiteClicks: d.websiteClicks,
                directionRequests: d.directionRequests,
                conversations: d.conversations,
                syncedAt: now,
              },
            },
            { upsert: true }
          )
        )
      );

      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

      const [currentKeywords, prevKeywords] = await Promise.all([
        fetchSearchKeywords(businessId, currentYear, currentMonth).catch(() => []),
        fetchSearchKeywords(businessId, prevYear, prevMonth).catch(() => []),
      ]);

      const allKeywords = [
        ...currentKeywords.map((k: any) => ({ ...k, year: currentYear, month: currentMonth })),
        ...prevKeywords.map((k: any) => ({ ...k, year: prevYear, month: prevMonth })),
      ];

      await Promise.all(
        allKeywords.map((k: any) =>
          GBPKeywordModel.findOneAndUpdate(
            { businessId, keyword: k.keyword, month: k.month, year: k.year },
            {
              $set: {
                businessId,
                organizationId: tokenDoc.organizationId,
                keyword: k.keyword,
                impressions: k.impressions,
                month: k.month,
                year: k.year,
                type: k.type,
                syncedAt: now,
              },
            },
            { upsert: true }
          )
        )
      );

      await GBPTokenModel.findOneAndUpdate({ businessId }, { $set: { lastSyncAt: now } });
      return { daysProcessed: dailyData.length, keywordsProcessed: allKeywords.length };
    });
  }
);

/**
 * Deletes signups that were started but never actually used, so the database
 * does not slowly fill with dead accounts from abandoned or bot signups.
 *
 * Two rules, both deliberately conservative:
 *   1. Never confirmed their email after 7 days  -> nothing of value was created.
 *   2. Confirmed, but never ran their one free audit after 30 days -> they
 *      signed up and walked away before receiving any value.
 *
 * A user who DID run their free report is never touched, paid or not — they had
 * real value from us and are a live lead worth keeping.
 *
 * Hard safety rails (a bug here deletes paying customers):
 *   - SUPER_ADMIN accounts are excluded outright.
 *   - Only accounts carrying `freemiumAuditGate.active` are eligible, which is
 *     set exclusively on brand-new signups — every pre-existing account
 *     predates that field and is therefore invisible to this job.
 *   - Anyone with a paid/active subscription is excluded.
 */
export const cleanupAbandonedSignups = inngest.createFunction(
  { id: "cleanup-abandoned-signups", triggers: [{ cron: "0 4 * * *" }] }, // daily 04:00
  async ({ step }) => {
    const { default: dbConnect } = await import("@/lib/mongodb");
    const { default: User } = await import("@/models/User");
    const { default: Organization } = await import("@/models/Organization");
    const { default: BusinessModel } = await import("@/models/Business");
    const { default: Subscription } = await import("@/models/Subscription");
    const { default: Audit } = await import("@/models/Audit");
    await dbConnect();

    const now = Date.now();
    const UNVERIFIED_AFTER = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const NO_AUDIT_AFTER = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const candidates = await step.run("find-abandoned", async () => {
      const base = {
        role: { $ne: "SUPER_ADMIN" },
        "freemiumAuditGate.active": true,
      };

      const unverified = await User.find(
        { ...base, isEmailVerified: false, createdAt: { $lt: UNVERIFIED_AFTER } },
        { _id: 1, email: 1 }
      ).lean();

      const neverAudited = await User.find(
        {
          ...base,
          isEmailVerified: true,
          "freemiumAuditGate.auditUsed": { $ne: true },
          createdAt: { $lt: NO_AUDIT_AFTER },
        },
        { _id: 1, email: 1 }
      ).lean();

      return [...unverified, ...neverAudited].map((u: any) => ({
        id: u._id.toString(),
        email: u.email,
      }));
    });

    if (candidates.length === 0) return { deleted: 0 };

    const deleted = await step.run("delete-abandoned", async () => {
      const removed: string[] = [];

      for (const c of candidates) {
        // Last-line guard: never remove anyone who has paid, and never anyone
        // who somehow has an audit on record despite the flag.
        const paid = await Subscription.findOne({
          userId: c.id,
          billingStatus: "Active",
          planType: { $ne: "Free" },
        }).lean();
        if (paid) continue;

        const hasAudit = await Audit.findOne({ userId: c.id }).select("_id").lean();
        if (hasAudit) continue;

        await BusinessModel.deleteMany({ userId: c.id });
        await Organization.deleteMany({ ownerId: c.id });
        await Subscription.deleteMany({ userId: c.id });
        await User.deleteOne({ _id: c.id });
        removed.push(c.email);
      }

      return removed;
    });

    console.log(`[cleanup-abandoned-signups] removed ${deleted.length} account(s)`);
    return { deleted: deleted.length, emails: deleted };
  }
);
