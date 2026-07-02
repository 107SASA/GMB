# Review Monitoring Flow

This details how the system polls for new reviews and automatically drafts AI replies.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Cron as Inngest (reviewAutopollCron)
    participant GMB as Google API
    participant DB as MongoDB (Reviews)
    participant Groq as Groq (Llama-3)

    Cron->>GMB: GET /v4/accounts/{id}/locations/{id}/reviews
    GMB-->>Cron: Returns Reviews
    
    loop For Each Review
        Cron->>DB: Check if Review ID exists
        alt Is New Review
            Cron->>Groq: analyzeSentiment()
            Groq-->>Cron: { sentiment: 'critical', tone: 'empathetic' }
            Cron->>Groq: draftReply()
            Groq-->>Cron: "We are so sorry..."
            Cron->>DB: Save Review (replyStatus: 'PENDING')
        end
    end
```

## Description
The auto-poll runs continuously in the background. By comparing the fetched Google reviews against the `Review` database, it identifies newly posted reviews. It then executes two sequential AI calls: one rigid call for classification (sentiment) and one creative call for drafting the response.
