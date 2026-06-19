# Post Publishing Scheduler Flow

This outlines how approved/scheduled content is pushed live.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Cron as Inngest (publishScheduledPostsCron)
    participant DB as MongoDB (Posts)
    participant Worker as Inngest (processPublishPostJob)
    participant GMB as Google Business API

    Cron->>DB: Find posts where status='scheduled' AND scheduledDate <= NOW
    DB-->>Cron: Returns Array of Due Posts
    
    loop For Each Due Post
        Cron->>Worker: Dispatch inngest.send('scheduler/publish-post')
    end
    
    Worker->>DB: Double-check status
    Worker->>GMB: POST /v4/accounts/{id}/locations/{id}/localPosts
    GMB-->>Worker: 200 OK
    Worker->>DB: Update status='published', set publishedAt
```

## Description
Instead of one massive loop executing API calls (which could crash and leave half the posts unpublished), the primary Cron simply acts as a dispatcher. It finds *all* due posts, and fans them out to individual `processPublishPostJob` workers. This ensures that if publishing one post fails due to a Google API error, it isolates the failure and retries that specific post without affecting the others.
