# Module 6: AI Sales Agent - Architecture

## Overview
Module 6 replaces the synchronous MVP WhatsApp AI worker with a fully resilient, event-driven, Inngest-powered backend. This completely solves the Twilio 15-second webhook timeout issue and tightly integrates the inbox directly into the CRM (Module 5).

## Database Models
- **Conversation**: Replaces the old model to support `tenantId`, `isAI`, and `twilioSid`.
- **ConversationThread**: Acts as the "Inbox Header" for a lead. Contains `unreadCount`, `lastMessage`, and `aiEnabled`.
- **BusinessAIConfig**: Stores dynamic prompts, tones, and rules so the AI behaves exactly as the business admin wants.

## Asynchronous Pipeline
1. **Twilio Webhook**: A lightweight endpoint that parses the POST payload, ensures a `Lead` exists, pushes to Inngest (`whatsapp/incoming`), and instantly returns `200 OK`.
2. **Inngest Worker (`processWhatsappMessage`)**: Fetches conversation history, queries `BusinessAIConfig`, generates a LLaMA-3.3 response via Groq SDK, sends it outbound via Twilio, and updates the Module 5 `Activity` timeline.

## Admin Inbox UI
An Intercom-style dashboard (`/dashboard/inbox`) that separates the view into a thread list on the left and an active chat on the right. Agents can monitor AI conversations in real-time, toggle "Human Takeover" mode instantly, and manually chat with leads.
