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
import { GROQ_MODEL } from "@/lib/aiModel";
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
          model: GROQ_MODEL,
          temperature: 0.5,
          max_tokens: 250,
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
          model: GROQ_MODEL,
          max_tokens: 200,
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

// 3b. Weekly content reminder — Sunday evening in-app nudge.
// Reminds ONLY businesses that don't have a full week of content scheduled for
// the upcoming 7 days, so users who are already stocked up aren't pestered.
// This is an in-app notification (the platform's supported channel), distinct
// from bufferMonitorWorker which auto-generates content.
export const weeklyContentReminder = inngest.createFunction(
  { id: "weekly-content-reminder", triggers: [{ cron: "0 13 * * 0" }] }, // Sundays ~18:30 IST (evening)
  async ({ step }) => {
    const result = await step.run("remind-low-buffer-businesses", async () => {
      const dbConnect = (await import("@/lib/mongodb")).default;
      await dbConnect();
      const { default: Business } = await import("@/models/Business");
      const { default: Post } = await import("@/models/Post");
      const { notifyBusinessUsers } = await import("@/services/notifications");
      const { POSTS_PER_WEEK } = await import("@/lib/contentConfig");

      const now = new Date();
      const weekAhead = new Date(now);
      weekAhead.setDate(now.getDate() + 7);

      // NB: use isDeleted (a real field) — the sibling crons filter on a
      // non-existent `isActive`, which is why they never match anything.
      const businesses = await Business.find({ isDeleted: { $ne: true } }).select('_id').lean();

      let reminded = 0;
      for (const b of businesses as any[]) {
        const scheduled = await Post.countDocuments({
          businessId: b._id,
          status: 'scheduled',
          scheduledDate: { $gte: now, $lte: weekAhead },
        });
        if (scheduled >= POSTS_PER_WEEK) continue; // fully stocked — don't nag

        await notifyBusinessUsers(b._id.toString(), {
          type: 'content_reminder',
          title: "Plan next week's content",
          body: scheduled === 0
            ? 'You have no posts scheduled for the upcoming week. Generate next week’s content to keep your Google profile active.'
            : `Only ${scheduled} of ${POSTS_PER_WEEK} posts are scheduled for the upcoming week — generate a few more to stay active.`,
          link: '/dashboard/content',
        });
        reminded++;
      }
      return { reminded, total: businesses.length };
    });

    return { success: true, ...result };
  }
);

// 3c. Subscription expiry — daily enforce-the-cutoff + countdown reminders.
// After a customer cancels, they keep access until the paid period ends (no
// refund). This cron: (a) LOCKS workspaces whose paid period has ended if the
// Razorpay webhook didn't already (safety net), and (b) sends in-app reminders
// at 10 / 5 / 3 / 2 / 1 days before the end.
export const subscriptionExpiryWorker = inngest.createFunction(
  { id: "subscription-expiry-worker", triggers: [{ cron: "0 6 * * *" }] }, // daily ~11:30 IST
  async ({ step }) => {
    const result = await step.run("enforce-and-remind", async () => {
      const dbConnect = (await import("@/lib/mongodb")).default;
      await dbConnect();
      const { default: Business } = await import("@/models/Business");
      const { notifyBusinessUsers } = await import("@/services/notifications");
      const { cancelBusinessPlan } = await import("@/lib/billing/applyEntitlements");

      const now = new Date();
      const DAY = 86_400_000;
      const REMIND_AT = [10, 5, 3, 2, 1];

      const businesses = await Business.find({
        subscriptionCancelAtPeriodEnd: true,
        subscriptionCurrentPeriodEnd: { $exists: true, $ne: null },
      })
        .select("_id name subscriptionCurrentPeriodEnd subscriptionRemindersSent")
        .lean();

      let expired = 0;
      let reminded = 0;

      for (const b of businesses as any[]) {
        const end = new Date(b.subscriptionCurrentPeriodEnd);

        // Period ended → lock the workspace now (in case the webhook missed it).
        if (end.getTime() <= now.getTime()) {
          await cancelBusinessPlan(b._id.toString());
          expired++;
          continue;
        }

        const daysLeft = Math.ceil((end.getTime() - now.getTime()) / DAY);
        const sent: number[] = b.subscriptionRemindersSent || [];
        // Thresholds now crossed but not yet notified.
        const due = REMIND_AT.filter((t) => daysLeft <= t && !sent.includes(t));
        if (due.length === 0) continue;

        await notifyBusinessUsers(b._id.toString(), {
          type: "subscription_expiry",
          title: `Your subscription ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
          body:
            `Access to ${b.name} ends on ` +
            `${end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. ` +
            `Renew to keep everything unlocked — no data is lost.`,
          link: "/dashboard/billing",
        });
        // Mark every crossed threshold sent so a late cancel doesn't backfill spam.
        await Business.updateOne(
          { _id: b._id },
          { $addToSet: { subscriptionRemindersSent: { $each: due } } }
        );
        reminded++;
      }

      return { checked: businesses.length, expired, reminded };
    });

    return { success: true, ...result };
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
            model: GROQ_MODEL,
            temperature: 0.7,
            max_tokens: 250,
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
        // Real Google Business Profile localPosts.create (gated ON). The image is
        // attached only when it's a public http(s) URL — Google fetches it, so a
        // base64 data-URL thumbnail is skipped (post still publishes, text-only).
        const { createLocalPost } = await import("@/lib/gbpClient");
        const summary = [post.title, post.content].filter(Boolean).join('\n\n').slice(0, 1500);
        await createLocalPost(post.businessId.toString(), {
          summary,
          mediaUrl: (post as any).imageUrl || undefined,
        });
        console.log(`[GBP] Published live post for business ${post.businessId}: ${post.title}`);
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

      // Mobile push + in-app bell notification — same best-effort pattern as
      // the critical-review and reply-drafted alerts above. Fires on the
      // same "published" transition the rest of the app already shows,
      // whether or not GBP_LIVE_WRITES_ENABLED is on (see the mock/live
      // branch above) — post.status flips to "published" either way, and
      // that's the one status every other surface in the app already shows
      // the user, so the notification isn't saying anything new relative to
      // what's already displayed elsewhere.
      const businessIdStr = post.businessId.toString();
      try {
        const { sendPushToBusinessUsers } = await import("@/services/push");
        await sendPushToBusinessUsers(businessIdStr, {
          title: 'Post published',
          body: `"${post.title || 'Your post'}" is now live on your Google Business Profile`,
          data: { postId: post._id.toString() },
        });
      } catch (e) {
        console.error('[push] post-published notify failed:', e);
      }
      try {
        const { notifyBusinessUsers } = await import("@/services/notifications");
        await notifyBusinessUsers(businessIdStr, {
          type: 'post_published',
          title: 'Post published',
          body: `"${post.title || 'Your post'}" is now live on your Google Business Profile.`,
          link: '/dashboard/scheduler',
        });
      } catch (e: any) {
        console.error('[notifications] post-published notify failed:', e.message);
      }
    });

    return { success: true };
  }
);

// 6b. Scheduled GBP media publish — same mechanism as the posts cron above
// (publishScheduledPostsCron / processPublishPostJob), but for photos
// (GbpMediaAsset.scheduledFor). Reuses gbpMediaService.publishAsset — which
// already contains the GBP_LIVE_WRITES_ENABLED gate, the LOGO/COVER
// singleton swap-out, and activity logging — instead of duplicating any of
// that here.
export const publishScheduledMediaCron = inngest.createFunction(
  { id: "publish-scheduled-media-cron", triggers: [{ cron: "*/15 * * * *" }] }, // Run every 15 minutes
  async ({ step }) => {
    const events = await step.run("fetch-media-to-publish", async () => {
      await dbConnect();
      const { default: GbpMediaAsset } = await import("@/models/GbpMediaAsset");
      const now = new Date();
      const ready = await GbpMediaAsset.find({
        status: "staged",
        scheduledFor: { $lte: now },
      }).lean();

      return ready.map((a: any) => ({
        name: "gbp-media/publish-scheduled",
        data: { assetId: a._id.toString(), businessId: a.businessId.toString() },
      }));
    });

    if (events.length > 0) {
      await step.sendEvent("dispatch-media-publish-jobs", events);
    }
    return { success: true, dispatched: events.length };
  }
);

export const processScheduledMediaPublishJob = inngest.createFunction(
  { id: "process-scheduled-media-publish-job", retries: 3, triggers: [{ event: "gbp-media/publish-scheduled" }] },
  async ({ event, step }) => {
    const { assetId, businessId } = event.data;

    await step.run("publish-media", async () => {
      await dbConnect();
      const { publishAsset } = await import("@/lib/gbpMediaService");
      const { default: GbpMediaAsset } = await import("@/models/GbpMediaAsset");

      try {
        // "Scheduled publish" — a real, honest label. This is the owner's
        // own pre-set schedule firing, not an autonomous AI decision (see
        // logProfileActivity.ts's doc comment on why that distinction is
        // enforced everywhere in this codebase).
        const { liveWriteApplied } = await publishAsset(businessId, assetId, {
          name: "Scheduled publish",
        });

        if (!liveWriteApplied) {
          // Live writes are platform-wide disabled — publishAsset correctly
          // left the asset 'staged' rather than pretending it went live (see
          // that function's own comment). Clear scheduledFor anyway so this
          // cron doesn't keep reprocessing the exact same asset every 15
          // minutes forever with no forward progress; the owner can publish
          // it manually once live writes are enabled.
          await GbpMediaAsset.updateOne(
            { _id: assetId, businessId, status: "staged" },
            { $unset: { scheduledFor: "" } }
          );
          console.log(`[gbp-media] Scheduled publish for asset ${assetId} skipped — live writes disabled; unscheduled.`);
        }
      } catch (err: any) {
        // publishAsset already marks the asset 'failed' + failureReason
        // internally on a real Google error — nothing further to persist here.
        console.error(`[gbp-media] Scheduled publish failed for asset ${assetId}:`, err.message);
      }
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
    //
    // fastMode (lead-gen entry points — /free-report, WhatsApp report-connect,
    // see src/lib/startAudit.ts) skips this entirely. Without this check, a
    // fastMode audit paid the full cost of a first-time SerpApi sync here
    // (data_id resolve + paginated backfill, ~10 sequential calls) BEFORE
    // process-audit below even got a chance to run its own fastMode-aware
    // skip — silently defeating the "seconds instead of up to a minute"
    // trade-off that fastMode exists for. See processAuditJob's identical
    // `!audit.fastMode` gate in auditService.ts for the fast-mode path this
    // was supposed to match.
    await step.run('pre-sync-reviews', async () => {
      try {
        const dbConnect = (await import('@/lib/mongodb')).default;
        await dbConnect();
        const { default: Audit } = await import('@/models/Audit');
        const audit = await Audit.findById(auditId).select('businessId tenantId fastMode').lean();
        if (!audit) {
          console.warn(`[generate-audit] Audit ${auditId} not found for pre-sync`);
          return;
        }
        if ((audit as any).fastMode) {
          console.log(`[generate-audit] fastMode audit ${auditId} — skipping pre-sync-reviews`);
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

// 7b. Stale PENDING audit cleanup — an Audit sitting in PENDING is a
// background job a user (often a free-report lead) is actively waiting on.
// If dispatch ever silently stalls again (e.g. the Aug 2026 incident where a
// long-running dev server's /api/inngest introspection hung, so queued
// audit/generate.requested events were never picked up), the audit would
// otherwise sit in PENDING forever with the report page showing stale/empty
// data and no error. Runs every minute; deletes (not FAILs — the free-report
// route creates a brand-new audit on retry, so a leftover doc serves no
// purpose) any audit still PENDING more than 5 minutes after creation.
//
// Deleting rather than failing is also why this is safe for freeAuditUsed:
// auditService.ts only flips that flag on COMPLETED, so a business whose
// only audit gets swept here was never charged its free report and can
// resubmit immediately.
export const cleanupStalePendingAudits = inngest.createFunction(
  { id: "cleanup-stale-pending-audits", triggers: [{ cron: "*/1 * * * *" }] },
  async ({ step }) => {
    const result = await step.run("delete-stale-pending", async () => {
      await dbConnect();
      const { default: Audit } = await import("@/models/Audit");
      const cutoff = new Date(Date.now() - 5 * 60 * 1000);
      const stale = await Audit.find({ status: "PENDING", createdAt: { $lte: cutoff } })
        .select("_id businessId createdAt")
        .lean();
      if (stale.length === 0) return { deleted: 0 };

      await Audit.deleteMany({ _id: { $in: stale.map((a: any) => a._id) } });
      for (const a of stale as any[]) {
        console.warn(
          `[cleanup-stale-pending-audits] Deleted audit ${a._id} (businessId=${a.businessId}) — ` +
          `still PENDING ${Math.round((Date.now() - new Date(a.createdAt).getTime()) / 60000)}min after creation.`
        );
      }
      return { deleted: stale.length };
    });

    return { success: true, ...result };
  }
);

/**
 * Follow-up drip shared by salesNurtureRequested (normal path) and
 * salesNurtureConsented (post-opt-in path) — identical logic, factored out
 * so the consent gate below doesn't require a second copy to drift from.
 * `step` is passed in rather than closed over so each caller's own Inngest
 * step-name namespace is used.
 */
async function runSalesFollowUpDrip(step: any, conversationId: string, followUpCount: number) {
  for (let i = 0; i < followUpCount; i++) {
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

      const convo: any = await SalesConversation.findById(conversationId);
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
}

// 7b. WhatsApp Sales Nurture drip (platform → lead, after a free audit).
// Timing (first-message delay + follow-up delays) and content come from the
// super-admin SalesAgentConfig. Durable sleeps survive restarts.
//
// Consent gate: a number sourced from the public /free-report web form has
// never been verified to belong to the person who submitted it — anyone can
// type in a third party's number. If this phone has never messaged the
// platform's WhatsApp line before, the real pitch is withheld and only a
// "reply YES" consent request is sent; the real first message + follow-up
// drip only run once salesNurtureConsented (below) fires from an affirmative
// reply. A phone that HAS messaged before (booking/report-connect/an earlier
// sales reply) skips the gate — it has already engaged with the platform.
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
      const { hasPhoneMessagedPlatformBefore } = await import('@/lib/whatsappConsent');

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
      if (isWorkspaceUnlocked({ subscriptionStatus: business.subscriptionStatus, userSubscriptionPlan: owner?.subscriptionPlan, businessCreatedAt: business.createdAt })) {
        return { skip: 'already subscribed' as const };
      }
      const phone = owner?.phone || business.phone;
      if (!phone) return { skip: 'no phone' as const };

      const { normalizePhoneE164, phoneDedupeKey } = await import('@/lib/phone');
      const phoneKey = phoneDedupeKey(phone);
      const priorContact = await hasPhoneMessagedPlatformBefore(phoneKey);
      const scores = extractScores(audit, business);
      const convo = await SalesConversation.create({
        businessId: business._id,
        auditId: audit._id,
        leadPhone: normalizePhoneE164(phone) || phone,
        phoneKey,
        leadName: owner?.fullName || business.name || '',
        status: 'active',
        consentStatus: priorContact ? 'not_required' : 'pending',
        scores,
      });
      // Send-once guard so re-runs don't double-message.
      await Business.updateOne({ _id: business._id }, { $set: { auditNurtureSentAt: new Date() } });

      return {
        conversationId: convo._id.toString(),
        phone,
        leadName: owner?.fullName || '',
        needsConsent: !priorContact,
        firstDelayMinutes: Math.max(0, config.firstMessage.delayMinutes || 0),
        followUpCount: config.followUps.length,
      };
    });

    if ('skip' in prep) return { skipped: prep.skip };

    if (prep.firstDelayMinutes > 0) {
      await step.sleep('wait-before-first', `${prep.firstDelayMinutes}m`);
    }

    if (prep.needsConsent) {
      // Send the consent request only. No real pitch, no follow-up drip —
      // those run in salesNurtureConsented once (if) an affirmative reply
      // arrives (see the SalesConversation branch in the WhatsApp webhook).
      await step.run('send-consent-request', async () => {
        const dbConnect = (await import('@/lib/mongodb')).default;
        await dbConnect();
        const { default: SalesConversation } = await import('@/models/SalesConversation');
        const { sendOutboundMessage } = await import('@/services/whatsapp/send');
        const { CONSENT_REQUEST_MESSAGE } = await import('@/lib/whatsappConsent');

        const convo: any = await SalesConversation.findById(prep.conversationId);
        if (!convo || convo.status !== 'active' || convo.consentStatus !== 'pending') return;
        const res = await sendOutboundMessage(convo.leadPhone, CONSENT_REQUEST_MESSAGE, undefined, convo.businessId.toString());
        if (res.success) {
          convo.messages.push({ role: 'agent', text: CONSENT_REQUEST_MESSAGE, at: new Date() });
          convo.lastAgentAt = new Date();
          await convo.save();
        }
      });
      return { success: true, conversationId: prep.conversationId, awaitingConsent: true };
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

    await runSalesFollowUpDrip(step, prep.conversationId, prep.followUpCount);

    return { success: true, conversationId: prep.conversationId };
  }
);

// 7b-ii. Fires once a lead who was gated behind the consent request (above)
// replies affirmatively — sends the real pitch immediately (no delay; they
// just actively opted in) and then runs the same follow-up drip.
export const salesNurtureConsented = inngest.createFunction(
  { id: 'sales-nurture-consented', triggers: [{ event: 'sales/nurture.consented' }] },
  async ({ event, step }) => {
    const { conversationId } = event.data;

    const prep = await step.run('prepare-consented-nurture', async () => {
      const dbConnect = (await import('@/lib/mongodb')).default;
      await dbConnect();
      const { default: SalesConversation } = await import('@/models/SalesConversation');
      const { getSalesAgentConfig } = await import('@/services/sales/salesAgent');

      const convo: any = await SalesConversation.findById(conversationId);
      if (!convo || convo.status !== 'active' || convo.consentStatus !== 'granted') {
        return { skip: 'not eligible' as const };
      }
      const config = await getSalesAgentConfig();
      if (!config.enabled) return { skip: 'agent disabled' as const };
      return { followUpCount: config.followUps.length };
    });

    if ('skip' in prep) return { skipped: prep.skip };

    await step.run('send-first-message-after-consent', async () => {
      const dbConnect = (await import('@/lib/mongodb')).default;
      await dbConnect();
      const { default: SalesConversation } = await import('@/models/SalesConversation');
      const { getSalesAgentConfig, composeFirstMessage } = await import('@/services/sales/salesAgent');
      const { sendOutboundMessage } = await import('@/services/whatsapp/send');

      const convo: any = await SalesConversation.findById(conversationId);
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

    await runSalesFollowUpDrip(step, conversationId, prep.followUpCount);

    return { success: true, conversationId };
  }
);

// Shared fallback for salesAgentReply/bookingAgentReply below: a lead who
// just texted an agent that's currently turned off used to get nothing back
// at all — no menu, no acknowledgement. This fires every time a reply would
// otherwise be produced but the config says the agent is disabled.
const AGENT_DISABLED_FALLBACK_MESSAGE = "Thanks for reaching out — a team member will get back to you shortly.";

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
      if (!config.enabled) {
        const res = await sendOutboundMessage(convo.leadPhone, AGENT_DISABLED_FALLBACK_MESSAGE, undefined, convo.businessId.toString());
        if (res.success) {
          convo.messages.push({ role: 'agent', text: AGENT_DISABLED_FALLBACK_MESSAGE, at: new Date() });
          convo.lastAgentAt = new Date();
          await convo.save();
        }
        return;
      }

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

// 7d. Live inbound from a demo prospect → AI BOOKING-agent response.
// GrowwMatics-owned, owner-only line. The agent qualifies the prospect, and
// once it has name + business + a preferred day/time it books the demo
// (DemoBooking 'Confirmed'), files a CRM lead, and fires demo/booked.
export const bookingAgentReply = inngest.createFunction(
  { id: 'booking-agent-reply', retries: 2, triggers: [{ event: 'booking/agent.reply' }] },
  async ({ event, step }) => {
    const { conversationId } = event.data;

    await step.run('reply', async () => {
      const dbConnect = (await import('@/lib/mongodb')).default;
      await dbConnect();
      const { default: BookingConversation } = await import('@/models/BookingConversation');
      const { default: Lead } = await import('@/models/Lead');
      const { default: Activity } = await import('@/models/Activity');
      const { default: DemoBooking } = await import('@/models/DemoBooking');
      const { getBookingAgentConfig, composeAgentReply, renderConfirmation } = await import('@/services/booking/bookingAgent');
      const { sendOutboundMessage } = await import('@/services/whatsapp/send');

      const convo: any = await BookingConversation.findById(conversationId);
      if (!convo || convo.status !== 'active') return;

      const config = await getBookingAgentConfig();
      if (!config.enabled) {
        const res = await sendOutboundMessage(convo.leadPhone, AGENT_DISABLED_FALLBACK_MESSAGE, convo.leadId?.toString());
        if (res.success) {
          convo.messages.push({ role: 'agent', text: AGENT_DISABLED_FALLBACK_MESSAGE, at: new Date() });
          await convo.save();
        }
        return;
      }

      const { reply, ready, details } = await composeAgentReply(config, convo);
      convo.details = { ...convo.details, ...details };

      // File the booking + CRM lead the moment we have everything we need.
      if (ready && convo.status === 'active') {
        const tenantId = 'gmbboost-internal';
        const phone = convo.leadPhone;
        const name = details.name || convo.leadName || phone;

        let lead: any = await Lead.findOne({ phone, tenantId });
        if (!lead) {
          lead = await Lead.create({
            tenantId,
            name,
            email: details.email || undefined,
            phone,
            source: 'Demo Booking',
            leadType: 'Platform Prospect',
            pipelineStage: 'New Request',
            status: 'active',
            businessType: details.businessType || undefined,
            aiLeadScore: 85,
          });
        } else {
          lead.pipelineStage = 'New Request';
          lead.source = 'Demo Booking';
          await lead.save();
        }

        await Activity.create({
          tenantId,
          leadId: lead._id,
          type: 'Demo',
          content: `Booked a demo via WhatsApp for ${details.preferredDate} at ${details.preferredTime}.`,
        });

        const booking = await DemoBooking.create({
          leadId: lead._id,
          name,
          email: details.email || undefined,
          phone,
          company: details.businessName || name,
          businessType: details.businessType || undefined,
          location: details.location || undefined,
          challenges: details.notes || undefined,
          date: details.preferredDate,
          timeSlot: details.preferredTime,
          status: 'Confirmed',
          channel: 'whatsapp',
        });

        convo.status = 'booked';
        convo.bookedAt = new Date();
        convo.leadId = lead._id;
        convo.bookingId = booking._id;

        await inngest.send({ name: 'demo/booked', data: { bookingId: booking._id.toString() } });
      }

      // Send whatever reply the agent produced (a question, or the confirmation).
      const outboundText = ready
        ? (reply || renderConfirmation(config, details))
        : reply;
      const res = await sendOutboundMessage(convo.leadPhone, outboundText, convo.leadId?.toString());
      if (res.success) {
        convo.messages.push({ role: 'agent', text: outboundText, at: new Date() });
      }
      await convo.save();
    });

    return { success: true };
  }
);

// 7e. Live inbound from a WhatsApp report prospect → AI REPORT-agent response
// ("D3"). GrowwMatics-owned, owner-only line. Sends the Google-connect link
// deterministically on the first message; after that, answers questions with
// the AI persona (no structured fields to collect, unlike booking). Once
// connected, replies are simple deterministic status messages — the actual
// report delivery is a separate function (reportCardDeliver) triggered by
// report/deliver.requested from src/lib/reportConnect.ts's finalize step.
export const reportAgentReply = inngest.createFunction(
  { id: 'report-agent-reply', retries: 2, triggers: [{ event: 'report/agent.reply' }] },
  async ({ event, step }) => {
    const { conversationId } = event.data;

    await step.run('reply', async () => {
      const dbConnect = (await import('@/lib/mongodb')).default;
      await dbConnect();
      const { default: ReportConversation } = await import('@/models/ReportConversation');
      const { getReportAgentConfig, composeIntroMessage, composeAgentReply } = await import('@/services/report/reportAgent');
      const { mintReportConnectToken } = await import('@/lib/reportConnect');
      const { sendOutboundMessage } = await import('@/services/whatsapp/send');

      const convo: any = await ReportConversation.findById(conversationId);
      if (!convo || convo.status === 'stopped') return;

      const config = await getReportAgentConfig();
      if (!config.enabled) return;

      // Post-connection chat is intentionally simple/deterministic — the
      // interesting conversational work happens before they connect.
      if (convo.status !== 'awaiting_connection') {
        const reply =
          convo.status === 'connected'
            ? "Your report is generating — I'll send it here as soon as it's ready! 🚀"
            : 'You already have your report above! Let me know if you have questions. 🙂';
        const res = await sendOutboundMessage(convo.leadPhone, reply);
        if (res.success) convo.messages.push({ role: 'agent', text: reply, at: new Date() });
        await convo.save();
        return;
      }

      const connectToken = await mintReportConnectToken({
        reportConversationId: convo._id.toString(),
        phone: convo.leadPhone,
      });
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const connectLink = `${baseUrl}/api/report-connect/${connectToken}`;

      // Just the inbound message pushed by the webhook route means this is
      // the very first turn — send the deterministic intro, no LLM call.
      const isFirstMessage = convo.messages.length === 1;
      const reply = isFirstMessage
        ? composeIntroMessage(config, connectLink)
        : await composeAgentReply(config, convo, connectLink);

      const res = await sendOutboundMessage(convo.leadPhone, reply);
      if (res.success) {
        convo.messages.push({ role: 'agent', text: reply, at: new Date() });
      }
      await convo.save();
    });

    return { success: true };
  }
);

// 7f. Delivers the report-card image + personalized summary once a report
// conversation is connected (see finalizeReportConnection in
// src/lib/reportConnect.ts). Polls the audit rather than hooking into
// processAuditJob, so src/services/audit/auditService.ts stays untouched.
export const reportCardDeliver = inngest.createFunction(
  { id: 'report-card-deliver', retries: 1, triggers: [{ event: 'report/deliver.requested' }] },
  async ({ event, step }) => {
    const { conversationId } = event.data;

    await step.run('deliver', async () => {
      const dbConnect = (await import('@/lib/mongodb')).default;
      await dbConnect();
      const { default: ReportConversation } = await import('@/models/ReportConversation');
      const { default: Audit } = await import('@/models/Audit');
      const { default: Business } = await import('@/models/Business');
      const { default: User } = await import('@/models/User');
      const { default: ReportShare } = await import('@/models/ReportShare');
      const { default: LoginLink } = await import('@/models/LoginLink');
      const { getReportAgentConfig, composeSummaryMessage, extractReportScores } = await import('@/services/report/reportAgent');
      const { sendOutboundMessage } = await import('@/services/whatsapp/send');
      const { launchBrowser } = await import('@/lib/pdf/browser');
      const { uploadPublicObject } = await import('@/lib/storage');
      const crypto = await import('crypto');

      const convo: any = await ReportConversation.findById(conversationId);
      if (!convo || convo.status !== 'connected' || !convo.auditId) return;

      const config = await getReportAgentConfig();
      if (!config.enabled) return;

      // Bounded polling (not durable step.sleep) — audits typically complete
      // in well under this window in practice; if not, apologize and stop
      // rather than tying up the function indefinitely.
      let audit: any = null;
      for (let attempt = 0; attempt < 24; attempt++) {
        audit = await Audit.findById(convo.auditId).lean();
        if (audit?.status === 'COMPLETED' || audit?.status === 'FAILED') break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      if (!audit || audit.status !== 'COMPLETED') {
        await sendOutboundMessage(
          convo.leadPhone,
          "Your report is taking a bit longer than usual — I'll send it here as soon as it's ready. Thanks for your patience! 🙏"
        );
        return;
      }

      const business: any = await Business.findById(convo.businessId).lean();
      const user: any = business?.userId ? await User.findById(business.userId).lean() : null;

      // Same share-token shape as /api/audit/[id]/share/route.ts, reused
      // unmodified by the public /print/report-card/[token] route.
      const shareToken = crypto.randomBytes(24).toString('hex');
      await ReportShare.create({
        auditId: audit._id,
        token: shareToken,
        createdBy: 'report-agent',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const cardUrl = `${baseUrl}/print/report-card/${shareToken}`;

      let imageUrl: string | null = null;
      let browser: any = null;
      try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        await page.setViewport({ width: 600, height: 800 });
        const response = await page.goto(cardUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
        if (!response?.ok()) throw new Error(`Report card page returned ${response?.status()}`);
        await new Promise((resolve) => setTimeout(resolve, 400)); // web-font settle
        const buffer = await page.screenshot({ type: 'png', fullPage: true });
        imageUrl = await uploadPublicObject(buffer as Buffer, 'image/png', 'report-cards');
      } catch (err: any) {
        console.error('[reportCardDeliver] image render failed:', err?.message);
      } finally {
        await browser?.close().catch(() => {});
      }

      const scores = extractReportScores(audit, business);

      if (imageUrl) {
        await sendOutboundMessage(
          convo.leadPhone,
          `Your free report for ${scores.businessName} 📊`,
          undefined,
          convo.businessId?.toString(),
          { url: imageUrl, type: 'image' }
        );
      }

      // Single-use, short-lived login link (NOT a reusable session JWT — see
      // src/models/LoginLink.ts for why: WhatsApp links get forwarded,
      // screenshotted, and cached, so a multi-use 30-day bearer token
      // embedded in a URL sent over that channel is a real takeover risk).
      let dashboardLink = baseUrl;
      if (user) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        await LoginLink.create({
          tokenHash,
          userId: user._id,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
        });
        dashboardLink = `${baseUrl}/api/auth/session-link/${rawToken}`;
      }

      const summary = composeSummaryMessage(config, scores, convo.leadName, dashboardLink);
      const res = await sendOutboundMessage(convo.leadPhone, summary, undefined, convo.businessId?.toString());

      convo.status = 'report_sent';
      convo.reportSentAt = new Date();
      if (res.success) convo.messages.push({ role: 'agent', text: summary, at: new Date() });
      await convo.save();
    });

    return { success: true };
  }
);

// 8. Review Management Automation Workflow (Module 4)
export const reviewSyncWorker = inngest.createFunction(
  { id: "review-sync-worker", triggers: [{ cron: "0 2 * * *" }] }, // Nightly at 2 AM
  async ({ step }) => {
    // Only businesses with a connected GBP token get auto-synced here — for
    // everyone else, syncReviewsForBusiness would silently fall back to
    // SerpApi (a paid API), burning a credit every night for businesses that
    // haven't connected Google yet. Unconnected businesses get reviews via
    // the manual "Sync reviews" button instead (which requires GBP already —
    // see reviews/fetch/route.ts), or as soon as they connect.
    const businesses = await step.run("fetch-gbp-connected-businesses", async () => {
      const dbConnect = (await import("@/lib/mongodb")).default;
      await dbConnect();
      const { default: Business } = await import("@/models/Business");
      const { default: GBPToken } = await import("@/models/GBPToken");
      const tokens = await GBPToken.find({}).select('businessId').lean();
      const connectedIds = tokens.map(t => (t as any).businessId);
      return await Business.find({ isActive: true, _id: { $in: connectedIds } }).select('_id').lean();
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
- Interest: ${lead.interest || 'Not specified'}
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
          model: GROQ_MODEL,
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
          model: GROQ_MODEL,
          temperature: 0.6,
          max_tokens: 200,
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

      // Was a raw fetch() straight to SendGrid with an empty SENDGRID_API_KEY
      // and no status check — the 401 "succeeded" silently. sendTransactionalEmail
      // (services/email.ts) is the same Resend-first, status-checked sender
      // already used for OTP and billing-lifecycle email; every call below is
      // now checked, not fire-and-forget.
      const { sendTransactionalEmail } = await import("@/services/email");

      // Admin Alert
      if (process.env.ADMIN_EMAIL) {
        const result = await sendTransactionalEmail(
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
        if (!result.success) {
          console.error(`[demo-booking] admin alert email to ${process.env.ADMIN_EMAIL} FAILED:`, (result as any).error);
        }
      } else {
        console.warn(`[demo-booking] ADMIN_EMAIL is not set — no one was alerted about booking ${bookingId}. Check /admin/demo-bookings manually.`);
      }

      // Customer Confirmation (WhatsApp bookings may have no email — skip then;
      // the booking agent already sent a WhatsApp confirmation).
      if (booking.email) {
        const result = await sendTransactionalEmail(
          booking.email,
          'Demo Booking Confirmed - GrowwMatics AI',
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
              <p style="color: #64748b; font-size: 14px;">Team GrowwMatics AI</p>
            </div>
          `
        );
        if (!result.success) {
          console.error(`[demo-booking] customer confirmation email to ${booking.email} FAILED:`, (result as any).error);
        }
      }
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

    // Pulls real, reply-capable reviews from the official GBP API now that a
    // connection exists (finalizeGbpConnection already purged any stale
    // SerpApi-sourced reviews for this business — see src/lib/gbpConnect.ts).
    // Runs on every gbp/sync.requested firing (connect + the periodic
    // re-sync dispatcher above), so reviews stay current the same way
    // insights/keywords do. Best-effort: a failure here shouldn't fail the
    // insights/keywords sync that already succeeded above.
    await step.run("sync-gbp-reviews", async () => {
      const { default: BusinessModel } = await import("@/models/Business");
      const { syncReviewsForBusiness } = await import("@/services/reviews/syncReviews");
      const business = await BusinessModel.findById(businessId).select('organizationId').lean() as any;
      const tenantId = business?.organizationId?.toString() ?? businessId;
      try {
        await syncReviewsForBusiness(businessId, tenantId);
      } catch (err: any) {
        console.error(`[GBP Sync] Review sync failed for ${businessId}:`, err.message);
      }
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
