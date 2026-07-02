# Module 3: AI Marketing Automation - API Docs

## `GET /api/scheduler/buffer`
Returns the 7-day content buffer health for the active tenant.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "totalScheduledPosts": 5,
    "daysCovered": 4,
    "healthStatus": "Warning",
    "missingDays": 3,
    "upcomingPosts": [...],
    "allPosts": [...]
  }
}
```

---

## `POST /api/scheduler/generate`
Dispatches a manual AI generation job to the Inngest queue.

**Request:**
```json
{
  "businessId": "60b9b...1234"
}
```

---

## `POST /api/scheduler/schedule`
Updates a post's status from `draft` to `scheduled`.

**Request:**
```json
{
  "postId": "123",
  "scheduledDate": "2023-11-01T10:00:00Z"
}
```

---

## `POST /api/scheduler/publish`
Manually publishes a post, updating its status to `published` and logging the event in `AutomationLog`.

**Request:**
```json
{
  "postId": "123"
}
```
