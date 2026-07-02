# System Architecture

This document provides a high-level overview of the entire AI GMB Optimization & Lead Conversion Platform.

## 1. High-Level Architecture Diagram

```mermaid
graph TD
    Client[Browser / Admin Dashboard] --> NextJS[Next.js App Router (Frontend & API)]
    WhatsApp[User via WhatsApp] --> Twilio[Twilio SMS/WhatsApp Webhook]
    
    Twilio -->|POST /api/webhook/twilio| NextJS
    
    NextJS -->|Push Background Job| Inngest[Inngest Cloud / Dev Server]
    
    Inngest -->|Execute Workers| NextJS
    Inngest -.->|Sleep / Delay| Inngest
    
    NextJS <--> MongoDB[(MongoDB Atlas)]
    NextJS <--> Groq[Groq API (Llama-3)]
    NextJS <--> SerpApi[SerpApi (Google Maps)]
```

## 2. Core Components

### 2.1 Next.js App Router
The core monolith serving both the React frontend and the backend REST APIs.
- **Frontend**: Located in `src/app/dashboard`, it uses TailwindCSS, Framer Motion, and `@dnd-kit`.
- **Backend APIs**: Located in `src/app/api`, providing endpoints for the frontend, webhook ingestion for Twilio, and the `/api/inngest` bridge for background workers.

### 2.2 MongoDB Atlas
The primary data store managed via Mongoose. It handles heavily relational documents (`Leads`, `Conversations`, `ReviewRequests`, `Businesses`) and acts as the source of truth for the system's state.

### 2.3 Inngest Orchestration
Because Vercel serverless functions time out after 10-60 seconds, and Twilio webhooks require a response within 15 seconds, synchronous processing of LLM requests is impossible. Inngest acts as the event-driven queue.
- Next.js pushes events to Inngest.
- Inngest invokes the Next.js `src/services/inngest/functions.ts` workers in the background with reliable retries.

### 2.4 Groq & Llama-3
The AI engine used for all text generation, intent scoring, and data extraction. Groq is utilized over OpenAI for its massive speed advantage (vital for WhatsApp chat responsiveness).

### 2.5 Twilio
Handles the bridging between the physical telecom world (SMS, WhatsApp) and our digital ecosystem. 

## 3. Data Flow Example (Lead Capture)
1. User texts Twilio number.
2. Twilio sends a POST to `/api/webhook/twilio`.
3. Next.js instantly returns `200 OK` (empty TwiML) and dispatches `whatsapp/incoming` to Inngest.
4. Inngest triggers the `processWhatsappMessage` function in the background.
5. Function connects to DB, fetches past conversation, builds a prompt, and calls Groq.
6. Groq responds with conversational text AND metadata.
7. Function saves metadata to `Lead` model, saves conversation, and calls Twilio API to text the user back.
