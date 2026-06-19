# Module 5: CRM Automation Flow

## 1. Lead Ingestion & Analysis
- A lead enters the system via the `POST /api/crm/leads` endpoint (either from a webhook, WhatsApp chatbot, or manual UI entry).
- The API fires the `crm/lead-created` event to Inngest.
- `scheduleLeadFollowUpsJob` begins executing. First step: queries Groq/LLaMA with the lead's profile to generate a 0-100 `aiLeadScore` and strategic insights.

## 2. Drip Sequence Scheduling
- Instead of using a fragile `node-cron` setup, the `scheduleLeadFollowUpsJob` uses Inngest's durable sleep feature (`step.sleepUntil`).
- The worker sleeps until exactly 24 hours later. Upon waking, it fires `crm/dispatch-whatsapp` with `templateType: Day 1 Follow-Up`.
- The worker sleeps until Day 3, fires again.
- The worker sleeps until Day 7, fires the final check.

## 3. Execution & Safety Checks
- The `dispatchWhatsappFollowUpJob` catches these events.
- **Safety check**: It re-queries the `Lead` from the DB. If `pipelineStage` is "Converted" or "Not Interested", it gracefully aborts (`skipped: true`).
- If safe to send, it calls the Twilio API, sends the message, and creates an `Activity` log tracking that the system contacted the lead.
