# GMB Boost 🚀
**The Ultimate AI-Powered GMB Optimization & Lead Conversion Platform**

GMB Boost is an enterprise-grade platform designed to automate and hyper-scale Google My Business (GMB) management. By leveraging advanced AI (Groq / Llama-3), background job queues (Inngest), and omnichannel telecom integrations (Twilio/WhatsApp), GMB Boost turns passive business profiles into active lead-generation engines.

---

## 📖 Comprehensive Documentation Suite

This README serves as the master entry point. For high-level summaries perfect for new hires or clients, start with the [Product Overview](./documentation/client-docs/product-overview.md), explore the [Feature Walkthrough](./documentation/client-docs/feature-walkthrough.md), or check out the [Admin Guide](./documentation/client-docs/admin-guide.md).

---

## ⚡ Core Modules & Features

The platform is divided into 9 highly specialized modules. Each module is fully documented with exact UI specifications and backend requirements.

1. **[GMB Audit Engine](./documentation/modules/module-1-gmb-audit.md)**: Instantly scrapes and analyzes a business's live Google Maps presence using SerpApi, generating an AI-driven actionable audit report to improve local SEO.
2. **[AI Content Generator](./documentation/modules/module-2-content-generator.md)**: Automatically generates hyper-local, SEO-optimized promotional posts, offers, and event updates tailored to the specific business niche.
3. **[Smart Scheduler](./documentation/modules/module-3-scheduler.md)**: A robust calendar system that orchestrates when generated content is published to Google servers.
4. **[Review Management](./documentation/modules/module-4-review-management.md)**: Monitors incoming Google reviews and uses sentiment analysis to automatically draft and publish professional, empathetic replies.
5. **[CRM System](./documentation/modules/module-5-crm.md)**: A centralized lead-tracking dashboard to manage customer lifecycles, intent scores, and engagement history.
6. **[WhatsApp AI Agent](./documentation/modules/module-6-whatsapp-ai.md)**: Connects Twilio to our Llama-3 backend to provide real-time, context-aware automated chat support to leads over WhatsApp.
7. **[Automation Layer](./documentation/modules/module-7-automation.md)**: The rules engine that triggers autonomous actions (e.g., "If review < 3 stars, notify owner").
8. **[Analytics Dashboard](./documentation/modules/module-8-dashboard.md)**: The primary command center providing charts, conversion rates, and real-time metrics on campaign performance.
9. **[Review Generation Campaigns](./documentation/modules/module-9-review-generation.md)**: Upload bulk CSVs of historical customers to trigger automated SMS/Email drip campaigns asking for Google reviews.

---

## 🏗️ Technical Architecture & Database

GMB Boost is built as a robust monolithic Next.js application designed for extreme concurrency and low latency.

- **Architecture Dive:** Understand the separation of concerns in our [System Architecture Diagram](./documentation/technical-docs/system-architecture.md), [Frontend Architecture](./documentation/technical-docs/frontend-architecture.md), and [Backend Architecture](./documentation/technical-docs/backend-architecture.md).
- **AI Brain:** Learn how we orchestrate prompts and handle token limits in the [AI System (Groq / Llama-3) Guide](./documentation/technical-docs/ai-system.md).
- **Background Workers:** Explore how long-running tasks are offloaded to [Inngest (Queue & Workers)](./documentation/technical-docs/queue-and-workers.md).
- **Database Schema:** We use MongoDB. Review the [MongoDB Schema Diagrams](./documentation/database/mongodb-schema.md) and understand the [Database Flow Logic](./documentation/database/database-flow.md).

---

## 🔄 System Workflows

Because GMB Boost relies heavily on asynchronous events (like waiting 2 days to send a follow-up text), we have mapped out the exact lifecycle of these events using Mermaid diagrams:

- 📱 [WhatsApp Lead Flow](./documentation/workflows/whatsapp-flow.md): From receiving the Twilio webhook to the AI generating a reply.
- ⭐️ [Review Drip Campaign Flow](./documentation/workflows/review-request-flow.md): The logic behind the automated review request SMS sequence.
- ✍️ [Content Generation Flow](./documentation/workflows/content-generation-flow.md): How bulk posts are generated and approved.
- 🤖 [Review Auto-Reply Flow](./documentation/workflows/review-monitoring-flow.md): How new reviews are detected and responded to.
- 🗓️ [Scheduler & Publish Flow](./documentation/workflows/scheduler-flow.md): The cron job logic for dispatching approved posts.
- 🧊 [Cold Lead Follow-Up Flow](./documentation/workflows/lead-followup-flow.md): Automated re-engagement for stale CRM leads.

---

## 🔌 API & Integrations

GMB Boost exposes a strict set of REST APIs for authentication, webhook receiving, and frontend-to-backend communication.
- **[Full API Reference Docs](./documentation/api-reference/api-docs.md)**

The platform integrates with several critical third-party services:
- **Resend:** For delivering secure Email OTPs during [Authentication](./documentation/api-reference/api-docs.md#1-authentication-apiauth).
- **Groq:** Powers the LLM generation for content and CRM chats.
- **Twilio:** Handles inbound/outbound SMS and WhatsApp messaging.
- **SerpApi:** Live scraping of Google Maps data for audits.

---

## 🚀 Deployment & Security

Ready to take the platform live? Follow our DevOps documentation to ensure a secure, scalable deployment:

- **[Local Dev Setup](./documentation/deployment/local-setup.md)**: Get the app running on your machine in under 5 minutes.
- **[Vercel Production Deployment](./documentation/deployment/production-deployment.md)**: Steps for deploying the Next.js monolith to Vercel.
- **[Scaling Guide](./documentation/deployment/scaling-guide.md)**: How to handle high concurrency during massive review campaigns.
- **[Security Best Practices](./documentation/security/security-best-practices.md)**: Password hashing, rate limiting, and JWT management.
- **[Troubleshooting Guide](./documentation/troubleshooting/troubleshooting-guide.md)**: Solutions for common webhook failures or database connection errors.

---
*Generated based on the live implementation state.*
