# Platform Architecture

## Executive Summary
The AI SaaS Platform is a Next.js (App Router) monolith backed by MongoDB Atlas and Inngest for background orchestration. It is composed of 9 modular domains (AI Auditing, Scheduling, Reviews, CRM, Sales, Dashboards) unified under a single multi-tenant organization structure.

## Core Stack
- **Framework**: Next.js 14+ (App Router)
- **Database**: MongoDB Atlas (via Mongoose)
- **Async Workers**: Inngest
- **AI Providers**: Groq (LLaMA-3), OpenAI
- **Communication**: Twilio (WhatsApp), Resend/Nodemailer (Email)
- **Authentication**: NextAuth.js (Credentials Provider + JWT)
- **UI/UX**: Tailwind CSS, Radix UI, Recharts, Framer Motion

## Unified Database Model
The platform uses an `Organization` -> `Business` -> `User` hierarchy.
1. **Organization**: Represents the agency or root tenant paying the subscription.
2. **Business**: Represents the local businesses managed by the Organization. Contains API tokens, AI configs, and external IDs (PlaceId, Twilio numbers).
3. **User**: Represents the individuals logging in. Bound to an Organization. Can toggle their `activeBusinessId` via JWT session.

## Worker Architecture
Inngest acts as the central nervous system.
Instead of relying on standard HTTP webhooks which can time out or duplicate, Inngest intercepts events (`crm/lead-created`, `whatsapp/incoming`, `reviews/sync`) and processes them asynchronously with built-in retries, idempotent step functions (`step.run`, `step.sleep`), and rate limiting.
