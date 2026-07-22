# Growwmatic AI n8n Workflows

Three optional n8n workflow files for clients who prefer managing automations outside of the Inngest engine. These workflows call the same underlying business logic via a dedicated `/api/n8n/*` proxy layer that accepts an API key instead of session cookies.

> **Important:** Inngest (built into Growwmatic AI) already runs all of these automations automatically. Only deploy these n8n workflows if a client explicitly wants to use n8n for external orchestration. **Do not run both simultaneously** — you will generate duplicate posts, send duplicate WhatsApp messages, and double-count review requests.

---

## Environment variables

Set these in n8n under **Settings → Environment Variables** before activating any workflow.

| Variable | Description |
|---|---|
| `GMB_API_URL` | Base URL of your Growwmatic AI instance, e.g. `https://app.yourdomain.com` |
| `GMB_BUSINESS_ID` | MongoDB ObjectId of the business this n8n instance manages |
| `AUTOMATION_API_KEY` | Must match `AUTOMATION_API_KEY` in Growwmatic AI's `.env.local` |
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp sender, e.g. `whatsapp:+14155238886` |
| `ADMIN_WHATSAPP_NUMBER` | Recipient for admin alerts, e.g. `whatsapp:+44...` |

**Multi-tenant:** n8n is inherently single-tenant per instance. For multiple clients, either run one Docker container per client (recommended) or duplicate the workflows inside one n8n instance and set `GMB_BUSINESS_ID` differently in each workflow's expressions.

---

## How to import

1. Open your n8n instance → **Workflows** in the sidebar
2. Click **+ Add Workflow** → **Import from File**
3. Select one of the JSON files from this directory
4. n8n will prompt you to connect credentials — see below
5. Set all required environment variables
6. Activate the workflow with the toggle

---

## Credentials to create in n8n

### GMB API Key (`httpHeaderAuth`)
- Name: `GMB API Key`
- Header name: `x-api-key`
- Header value: your `AUTOMATION_API_KEY`

### Twilio Basic Auth (`basicAuth`)
- Name: `Twilio Basic Auth`
- Username: your Twilio Account SID
- Password: your Twilio Auth Token

### GMB Webhook Secret (`httpHeaderAuth`) — workflow 2 only
- Name: `GMB Webhook Secret`
- Header name: `x-webhook-secret`
- Header value: a shared secret you also store in Growwmatic AI's `.env.local` as `N8N_WEBHOOK_SECRET`
- The Growwmatic AI app must include `x-webhook-secret: <value>` when POSTing to this webhook URL

---

## Workflow summaries

### workflow-1-buffer-monitor.json
Runs daily at 8 AM. Calls `/api/n8n/buffer-check?businessId=GMB_BUSINESS_ID`. If fewer than 7 days of scheduled posts remain, calls `/api/n8n/generate-content` which fires the Inngest `scheduler/manual-generate` event. Sends a Twilio WhatsApp alert to the admin on completion.

### workflow-2-lead-followup.json
Triggered by a webhook POST from Growwmatic AI when a new lead is created. Sends a welcome WhatsApp via Twilio, waits 3 days, checks lead status at `/api/crm/leads/{leadId}`, and sends follow-up messages at day 3 and day 7 if the lead is still active. Requires the webhook `x-webhook-secret` header for security.

### workflow-3-review-automation.json
Runs every 6 hours. Calls `/api/n8n/sync-reviews?businessId=GMB_BUSINESS_ID` to fetch reviews without replies. For each review, calls `/api/n8n/generate-reply` to generate an AI draft, then sends the draft to the admin via Twilio WhatsApp for approval.

---

## Relationship between Inngest and n8n

| | Inngest (built-in) | n8n (optional) |
|---|---|---|
| Where it runs | Inside Growwmatic AI (Next.js) | External Docker container or n8n Cloud |
| Triggers | Cron + event-driven | Cron + webhook |
| Multi-tenant | Yes (loops over all businesses) | No (one instance per business) |
| Requires setup | No (runs automatically) | Yes (env vars + credentials) |
| Use when | Always — primary engine | Client wants external visibility/control |
