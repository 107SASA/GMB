import { inngest } from "./client";
import dbConnect from "@/lib/mongodb";
import Lead from "@/models/Lead";
import Conversation from "@/models/Conversation";
import Appointment from "@/models/Appointment";
import FollowUp from "@/models/FollowUp";
import MessageQueue from "@/models/MessageQueue";
import Business from "@/models/Business";
import ReviewRequest from "@/models/ReviewRequest";
import Review from "@/models/Review";
import Customer from "@/models/Customer";
import Campaign from "@/models/Campaign";
import AutomationLog from "@/models/AutomationLog";
import { generateSalesResponse } from "@/services/ai";
import { generateAIContent } from "@/services/ai/contentEngine";
import twilio from "twilio";
import mongoose from "mongoose";
import { sendOutboundMessage } from "@/services/twilio/client";

const FALLBACK_MESSAGE = "I'm having a little trouble connecting to my brain right now. Please hold on or call our main line!";

// 1. WhatsApp AI Worker
export const processWhatsappMessage = inngest.createFunction(
  { id: "process-whatsapp-message", retries: 3, triggers: [{ event: "whatsapp/incoming" }] },
  async ({ event, step }) => {
    const { messageSid, from, body, numMedia, leadId, threadId, tenantId, businessId } = event.data;
    
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
      return { success: true, reason: 'AI disabled for this thread' };
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
      const systemMessage = {
        role: 'system',
        content: `PROMPT: ${config.systemPrompt}\nTONE: ${config.aiTone}\nRULES: ${config.salesRules}`
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

    if (!aiReply) return { success: true, reason: 'AI skipped or failed' };

    // 4. Send Outbound
    const outboundSid = await step.run("send-outbound", async () => {
      return await sendOutboundMessage(phone, aiReply, leadId, businessId); // returns message sid
    });

    // 5. Log outbound message & Update Thread
    await step.run("log-outbound-msg", async () => {
      await Conversation.create({
        tenantId,
        businessId,
        leadId,
        direction: 'outbound',
        messageText: aiReply,
        isAI: true,
        messageStatus: 'sent',
        twilioSid: outboundSid || 'pending'
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

// 4. AI Review Campaigns (Module 9)
export const processReviewCampaign = inngest.createFunction(
  { id: "process-review-campaign", retries: 3, triggers: [{ event: "campaigns/review.request.start" }] },
  async ({ event, step }) => {
    const { customerId, businessId, tenantId, channel, campaignId } = event.data;

    const dbConnect = (await import("@/lib/mongodb")).default;
    await dbConnect();

    // 1. Fetch Customer & Validate
    const customer = await step.run("fetch-customer", async () => {
      const { default: Customer } = await import("@/models/Customer");
      return await Customer.findById(customerId).lean();
    });

    if (!customer || customer.optedOut) return { skipped: true, reason: 'Customer opted out or not found' };

    // 2. Generate AI Message
    const aiMessage = await step.run("generate-ai-message", async () => {
      const { Groq } = await import("groq-sdk");
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
      const prompt = `You are a customer success assistant. Write a short, warm, 2-sentence WhatsApp review request for ${customer.name}. Mention they recently got ${customer.service || 'our service'}. Ask them to leave a review using this link: ${baseUrl}/api/campaigns/track/{{REQUEST_ID}}. Include: Reply STOP to opt-out.`;

      try {
        const response = await groq.chat.completions.create({
          messages: [{ role: 'system', content: prompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.7,
          max_tokens: 150,
        });
        return response.choices[0]?.message?.content?.trim() || `Hi! We'd love a review: ${baseUrl}/api/campaigns/track/{{REQUEST_ID}}`;
      } catch (e) {
        return `Hi! We'd love a review: ${baseUrl}/api/campaigns/track/{{REQUEST_ID}} (Reply STOP to opt-out)`;
      }
    });

    // 3. Create Request Log
    const reviewRequest = await step.run("create-request-log", async () => {
      const { default: ReviewRequest } = await import("@/models/ReviewRequest");
      const req = await ReviewRequest.create({
        tenantId,
        businessId,
        customerId,
        channel,
        message: 'pending generation',
        status: 'Pending',
        ...(campaignId && { campaignId })
      });
      req.message = aiMessage.replace('{{REQUEST_ID}}', req._id.toString());
      await req.save();
      return req.toObject();
    });

    // 4. Send Initial Message
    await step.run("send-initial-message", async () => {
      const { default: ReviewRequest } = await import("@/models/ReviewRequest");
      if (channel === 'whatsapp' && customer.phone) {
        await sendOutboundMessage(customer.phone, reviewRequest.message, undefined, businessId);
      }
      await ReviewRequest.findByIdAndUpdate(reviewRequest._id, { status: 'Sent', sentAt: new Date(), followUpStage: 0 });
    });

    // 5. Wait 2 Days
    await step.sleep("wait-2-days", "2d");

    // 6. Check Status for Reminder 1
    const shouldSendRem1 = await step.run("check-status-1", async () => {
      const { default: ReviewRequest } = await import("@/models/ReviewRequest");
      const { default: Customer } = await import("@/models/Customer");
      const req = await ReviewRequest.findById(reviewRequest._id);
      const cust = await Customer.findById(customerId);
      return !cust?.optedOut && !req?.clicked;
    });

    if (shouldSendRem1) {
      await step.run("send-reminder-1", async () => {
        const { default: ReviewRequest } = await import("@/models/ReviewRequest");
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const msg = `Hi ${customer.name}, just a quick reminder! We'd really appreciate a review of your recent ${customer.service || 'visit'}: ${baseUrl}/api/campaigns/track/${reviewRequest._id}\nReply STOP to opt-out.`;
        if (channel === 'whatsapp' && customer.phone) await sendOutboundMessage(customer.phone, msg, undefined, businessId);
        await ReviewRequest.findByIdAndUpdate(reviewRequest._id, { followUpStage: 1 });
      });
    }

    // 7. Wait 5 Days
    await step.sleep("wait-5-days", "5d");

    // 8. Check Status for Final Reminder
    const shouldSendRem2 = await step.run("check-status-2", async () => {
      const { default: ReviewRequest } = await import("@/models/ReviewRequest");
      const { default: Customer } = await import("@/models/Customer");
      const req = await ReviewRequest.findById(reviewRequest._id);
      const cust = await Customer.findById(customerId);
      return !cust?.optedOut && !req?.clicked;
    });

    if (shouldSendRem2) {
      await step.run("send-final-reminder", async () => {
        const { default: ReviewRequest } = await import("@/models/ReviewRequest");
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const msg = `Hi ${customer.name}, last bother from us! If you have a minute, a review would mean the world to our team: ${baseUrl}/api/campaigns/track/${reviewRequest._id}\nReply STOP to opt-out.`;
        if (channel === 'whatsapp' && customer.phone) await sendOutboundMessage(customer.phone, msg, undefined, businessId);
        await ReviewRequest.findByIdAndUpdate(reviewRequest._id, { followUpStage: 2, automationStatus: 'Completed' });
      });
    } else {
      await step.run("mark-completed", async () => {
        const { default: ReviewRequest } = await import("@/models/ReviewRequest");
        await ReviewRequest.findByIdAndUpdate(reviewRequest._id, { automationStatus: 'Completed' });
      });
    }

    if (campaignId) {
      await step.run("increment-campaign-delivered", async () => {
        const { default: Campaign } = await import("@/models/Campaign");
        await Campaign.findByIdAndUpdate(campaignId, { $inc: { delivered: 1 } });
      });
    }

    return { success: true };
  }
);

// 5. Review Autopoll
export const reviewAutopollCron = inngest.createFunction(
  { id: "review-autopoll-cron", triggers: [{ cron: "0 * * * *" }] },
  async ({ step }) => {
    // Simplified: Find clicked > 2h ago, dispatch event per review
    const events = await step.run("fetch-clicked-requests", async () => {
      await dbConnect();
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const clicked = await ReviewRequest.find({ status: 'CLICKED', clickedAt: { $lte: twoHoursAgo } }).lean();
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
      const req = await ReviewRequest.findById(event.data.requestId).populate('customerId');
      if (req) {
        req.status = 'REVIEWED';
        req.reviewedAt = new Date();
        await req.save();
        
        await Review.findOneAndUpdate(
          { requestId: req._id },
          { $setOnInsert: { rating: 5, reviewText: 'Auto-tracked review', reviewer: req.customerId?.firstName || 'Customer', createdAt: new Date() } },
          { upsert: true }
        );
      }
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

      // Mock publishing to Google Business Profile API
      console.log(`[MOCK] Publishing post to GMB for business ${post.businessId}: ${post.title}`);
      
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

    return { success: true, auditId };
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
    const { businessId } = event.data;
    
    const dbConnect = (await import("@/lib/mongodb")).default;
    await dbConnect();
    const { default: Business } = await import("@/models/Business");
    const business = await Business.findById(businessId);
    if (!business || !business.phone) return { skipped: true, reason: "No phone" };

    await step.run("send-twilio-alert", async () => {
      const msg = `🚨 *Reputation Alert*\n${business.name} just received a critical/1-star review. Please check your Reputation Dashboard immediately to generate an AI response.`;
      await sendOutboundMessage(business.phone, msg, undefined, business._id.toString());
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
              from: { email: process.env.EMAIL_FROM!, name: 'GMBBoost' },
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
        'Demo Booking Confirmed - GMBBoost',
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
            <p style="color: #64748b; font-size: 14px;">Team GMBBoost</p>
          </div>
        `
      );
    });

    return { success: true };
  }
);


