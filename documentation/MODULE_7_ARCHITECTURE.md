# Module 7: AI Automation Engine Architecture

## Strategic Positioning of n8n
In this architecture, **n8n** is strictly an orchestration and visual automation layer. It does **not** replace the core async background worker system (Inngest).

### Why both Inngest and n8n?
- **Inngest** handles core, high-throughput, code-heavy background jobs (like the AI WhatsApp Sales Agent polling, webhooks, and core logic). It is version-controlled, testable, and deeply integrated into the Next.js runtime.
- **n8n** handles visual orchestration, external third-party integrations (CRM syncs, email alerts), and macro-level administrative automation (e.g., daily buffer checks, review digests). It provides observability and a no-code interface for non-technical admins to tweak "business logic" workflows without touching the codebase.

## Integration Pattern
The n8n workflows communicate with the core system entirely via internal API endpoints (e.g., `GET /api/scheduler/buffer` or `POST /api/content/generate`). 
- **Trigger**: n8n uses Cron (Schedule) nodes or catches Webhooks fired by the core app.
- **Action**: n8n uses HTTP Request nodes authenticated via `x-api-key` to instruct the core app to perform actions.
- **Alerting**: n8n uses its visual branching to send Twilio alerts natively.
