import { Inngest } from "inngest";

// Define the shape of our events for type safety
type Events = {
  "whatsapp/incoming": {
    data: {
      messageSid: string;
      from: string;
      body: string;
      profileName: string;
      numMedia: number;
    };
  };
  "scheduler/generate": {
    data: { businessId: string };
  };
  "scheduler/follow-up": {
    data: { leadId: string; reminderType: string };
  };
  "scheduler/review-autopoll": {
    data: { requestId: string };
  };
  "campaign/start": {
    data: { campaignId: string };
  };
  "campaign/send-review-request": {
    data: { campaignId: string; customerId: string };
  };
  "scheduler/publish-post": {
    data: { postId: string };
  };
  "audit/generate.requested": {
    data: { auditId: string };
  };
  "scheduler/manual-generate": {
    data: { businessId: string; force?: boolean };
  };
  "reviews/sync": {
    data: { businessId: string };
  };
  "reviews/critical-alert": {
    data: { businessId: string };
  };
  "crm/lead-created": {
    data: { leadId: string };
  };
  "crm/dispatch-whatsapp": {
    data: { leadId: string; templateType: string; scheduledDate: string };
  };
};

export const inngest = new Inngest({ 
  id: "gmb-optimization-platform", 
  eventKey: process.env.INNGEST_EVENT_KEY || "local",
  schemas: { events: {} as Events } 
});
