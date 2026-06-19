# Module 8: Dashboard API Docs

## `GET /api/dashboard/stats`

### Description
Fetches all necessary data to hydrate the AI Command Center. Uses optimized parallel MongoDB aggregation pipelines.

### Query Parameters
- `businessId` (required): The MongoDB ObjectId of the business workspace.
- `tenantId` (optional): For platform-level isolation.

### Response Structure
```json
{
  "success": true,
  "data": {
    "metrics": {
      "totalLeads": 150,
      "convertedLeads": 20,
      "totalReviews": 45,
      "avgRating": 4.8,
      "unansweredReviews": 2,
      "postsPublished": 120,
      "bufferDays": 14
    },
    "charts": {
      "leadsOverTime": [{ "date": "2026-05-01", "leads": 5 }],
      "sourceDonut": [{ "name": "WhatsApp", "value": 100 }],
      "starsDistribution": [{ "star": 5, "count": 40 }]
    },
    "panels": {
      "recentLeads": [ ... ],
      "calendar": [ ... ],
      "followUps": [ ... ],
      "activities": [ ... ]
    }
  }
}
```
