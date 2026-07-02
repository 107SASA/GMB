# Content Generation Flow

This document details how the infinite content calendar sustains a 7-day buffer of unique GMB posts.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Cron as Inngest (generateContentCron)
    participant DB as MongoDB (Posts)
    participant Groq as Groq (Llama-3)

    Cron->>DB: Check scheduled posts count
    DB-->>Cron: "Only 4 posts scheduled"
    
    Note over Cron: Needs 3 more to reach 7-day buffer
    
    loop 3 Times
        Cron->>DB: Fetch last 5 generated posts
        DB-->>Cron: Returns Post content array
        Cron->>Groq: Generate Post (Provide last 5 for deduplication)
        Groq-->>Cron: Returns JSON (Title, Content, Hashtags)
        Cron->>DB: Save New Post (scheduledDate: N+1 days)
    end
```

## Description
This cron job acts as a proactive maintenance worker. The critical step is the deduplication logic. By querying the database for the 5 most recent posts and passing them into the LLM's system prompt context window, we mathematically instruct the AI to explore different topics, preventing the "calendar fatigue" common in AI automation tools.
