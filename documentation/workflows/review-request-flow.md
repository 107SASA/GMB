# Review Request Drip Campaign Flow

This flow illustrates the delayed execution capabilities of Inngest for managing SMS review campaigns over multiple days.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Admin as Dashboard
    participant API as /api/upload
    participant DB as MongoDB (Customers)
    participant Inngest as Inngest (sendReviewRequest)
    participant Twilio as Twilio
    participant User as Customer
    participant Redirect as /go/[id]

    Admin->>API: Upload CSV
    API->>DB: Upsert Customers (Deduplicate)
    Admin->>Inngest: Start Campaign
    
    Inngest->>Twilio: Send Initial SMS with link /go/123
    Twilio-->>User: Receives SMS
    
    Inngest->>Inngest: step.sleep("2d") (Suspends Execution)
    
    opt User Clicks Link during Sleep
        User->>Redirect: Clicks /go/123
        Redirect->>DB: Update ReviewRequest (status: 'CLICKED')
        Redirect-->>User: Redirect to Google Maps
    end
    
    Inngest->>Inngest: Wakes up after 2 days
    Inngest->>DB: Check ReviewRequest Status
    DB-->>Inngest: Returns Status
    
    alt status == 'SENT'
        Inngest->>Twilio: Send Reminder SMS
    else status == 'CLICKED'
        Inngest->>Inngest: Do Nothing (End Workflow)
    end
```

## Description
The review generation campaign relies on Inngest's `step.sleep()` function to pause the worker in the cloud without consuming server resources. When it awakens, it queries the database to see if the smart-link interceptor (`/go/[id]`) logged a click. If the user clicked, they are spared the reminder text.
