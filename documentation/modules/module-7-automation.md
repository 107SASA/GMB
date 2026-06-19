# Module 7: Automation Layer (Inngest)

## 1. Module Overview
The Automation Layer acts as the orchestrator for long-running workflows, drip campaigns, and scheduled events outside the scope of Next.js synchronous requests. By decoupling workflow state logic from the Next.js API using **Inngest**, the system achieves massive scalability, reliable retries, and asynchronous background processing.

## 2. Architecture
- **Frontend Structure**: N/A
- **Backend Structure**: 
  - `src/app/api/inngest/route.ts`: Exposes the Inngest API endpoint that the Inngest Cloud / Executor calls to run background functions.
- **Service Layer**: 
  - `src/services/inngest/client.ts`: Initializes the Inngest client.
  - `src/services/inngest/functions.ts`: Contains the definitions of all background jobs, cron tasks, and delayed step functions (e.g., waiting 2 days for review campaigns).
- **Database**: 
  - `AutomationLog` is used to track events triggered by scheduled services.

## 3. APIs Used
- **Internal APIs (Inngest Triggers)**: 
  - `whatsapp/incoming`: Triggered by Twilio webhooks for fast API response.
  - `scheduler/follow-up`: Triggered by cron for CRM follow-ups.
  - `scheduler/generate`: Triggered by cron for AI content creation.
  - `scheduler/publish-post`: Triggered by cron for GMB posting.
  - `campaign/start` & `campaign/send-review-request`: For delayed SMS review campaigns.

## 4. MongoDB/Mongoose Structure
- `AutomationLog`: Logs `type`, `workflow`, `action`, `status` and references object IDs when applicable.

## 5. AI Integrations
- The Inngest functions securely call Next.js Groq services in the background, preventing Vercel function timeout limitations on slow LLM inferences.

## 6. Automation & Workflows
- **Triggers Configured in Inngest**:
  1. **WhatsApp AI Parsing**: Instantly triggered when a message arrives; handles all CRM state updates and Groq processing asynchronously.
  2. **Content Generation**: Cron runs daily, checking schedules and invoking Groq loop if buffer is low.
  3. **Review Campaigns**: Utilizes `step.sleep("2d")` native Inngest step logic to wait for user interaction before sending SMS follow-ups.
  4. **Post Publishing**: Cron runs every 15 minutes to push scheduled posts to live status.

## 7. UI/UX Components
- None native to Next.js. Monitored via the external Inngest dashboard.

## 8. Environment Variables Needed
```env
INNGEST_EVENT_KEY=local
INNGEST_SIGNING_KEY=local
```

## 9. Execution/Setup Guide
1. Run `npx inngest-cli@latest dev` in a separate terminal.
2. The Next.js app will automatically register its functions with the local Inngest dev server.
3. Access the Inngest Dev UI at `http://localhost:8288`.

## 10. Module Dependencies
- **Depends on**: Inngest SDK, Next.js API Routes.
- **Depended upon by**: Almost all asynchronous features in the platform.

## 11. Known Issues / Technical Debt
- **Error Reporting**: Errors are logged natively in Inngest, but an alert integration to Slack/Discord via Inngest webhooks would be beneficial for admin oversight.

## 12. Future Scaling Suggestions
- **Fan-Out Architectures**: For extremely large CSV customer uploads (10,000+), implement Inngest batching and fan-out patterns rather than mapping a single array into `sendEvent` calls.
