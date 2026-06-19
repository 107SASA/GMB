# Module 9: Review Campaigns API Docs

## `POST /api/campaigns/import`
Accepts a validated array of customers from the PapaParse frontend client and bulk-upserts them into MongoDB.

**Payload:**
```json
{
  "businessId": "60b9b...",
  "tenantId": "demo-tenant",
  "customers": [
    {
      "name": "John Doe",
      "phone": "+1234567890",
      "service": "HVAC Repair",
      "tags": ["residential"]
    }
  ]
}
```

## `POST /api/campaigns/send`
Triggers the background Inngest worker to start a drip campaign for a specific customer.

**Payload:**
```json
{
  "customerId": "60c1c...",
  "businessId": "60b9b...",
  "tenantId": "demo-tenant",
  "channel": "whatsapp"
}
```

## `GET /api/campaigns/track/:requestId`
A redirect endpoint used in SMS messages (e.g., `https://gmbboost.com/api/campaigns/track/60c1c...`). 
It intercepts the click, sets `clicked = true` on the `ReviewRequest` document, and immediately issues an HTTP 302 redirect to the actual Google Maps Review URL.
