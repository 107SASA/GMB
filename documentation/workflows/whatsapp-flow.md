# WhatsApp AI Flow

This document outlines the asynchronous architecture of handling an incoming WhatsApp message via Twilio, routing it through Groq AI, and responding.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant User as WhatsApp User
    participant Twilio as Twilio Webhook
    participant API as Next.js API (/webhook/twilio)
    participant Inngest as Inngest Queue
    participant Worker as Inngest Worker
    participant DB as MongoDB
    participant Groq as Groq (Llama-3)

    User->>Twilio: Sends Message
    Twilio->>API: POST payload
    API-->>Twilio: 200 OK (Empty TwiML)
    API->>Inngest: inngest.send('whatsapp/incoming')
    
    Inngest->>Worker: Trigger processWhatsappMessage
    Worker->>DB: Fetch/Create Lead & Conversation History
    Worker->>Groq: Generate Reply + JSON Metadata
    Groq-->>Worker: { reply: "...", intent: 85, status: "Interested" }
    
    Worker->>DB: Save updated Lead & Conversation
    Worker->>Twilio: POST /Messages (Send Reply)
    Twilio-->>User: Receives AI Reply
```

## Description
To avoid Twilio's strict 15-second timeout, the system decouples ingestion from processing. The LLM inference (which can take 2-8 seconds depending on context size) runs entirely in the background via Inngest, ensuring robust retries if Groq rate-limits are hit.
