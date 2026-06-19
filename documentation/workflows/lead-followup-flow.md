# Lead Follow-Up Flow

This document details how the CRM automatically schedules and executes follow-up messages for leads that go cold.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Cron as Inngest Cron (0 10 * * *)
    participant DB as MongoDB
    participant Groq as Groq (Llama-3)
    participant Twilio as Twilio API
    participant User as WhatsApp User

    Cron->>DB: Find Leads (status != 'Converted', lastInteraction < 48h ago)
    DB-->>Cron: Returns Cold Leads
    
    loop For Each Lead
        Cron->>Groq: Prompt: "Draft a polite check-in based on this chat history"
        Groq-->>Cron: "Hi! Just checking if you still needed plumbing help?"
        Cron->>Twilio: Send SMS/WhatsApp
        Twilio-->>User: Delivers Message
        Cron->>DB: Append to Conversation, increment retryCount
    end
```

## Description
The follow-up cron runs daily. It isolates users who haven't responded within a specific timeframe (usually 48 hours). Instead of sending a generic "Are you still there?" template, it passes the user's specific `aiSummary` and `Conversation` array to the LLM to draft a highly contextual, personalized check-in.
