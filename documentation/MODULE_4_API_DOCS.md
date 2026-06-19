# Module 4: AI Reputation Agent - API Docs

## `POST /api/reviews/fetch`
Syncs reviews from the Provider, processes sentiment, and updates Analytics.

**Request:**
```json
{
  "businessId": "60b9b3..."
}
```
**Response:**
```json
{
  "success": true,
  "analytics": { "avgRating": 4.5, "responseRate": 80, ... },
  "reviews": [ ... ]
}
```

---

## `POST /api/reviews/generate-reply`
Invokes the Groq LLaMA 3.3 engine to generate a context-aware reply.

**Request:**
```json
{
  "reviewId": "123...",
  "tone": "Apology"
}
```
**Response:**
```json
{
  "success": true,
  "reply": "We are so sorry for the terrible experience..."
}
```

---

## `POST /api/reviews/post-reply`
Publishes the approved reply back to the Provider.

**Request:**
```json
{
  "reviewId": "123...",
  "replyText": "Thank you for the wonderful feedback!"
}
```
**Response:**
```json
{
  "success": true,
  "review": { ... }
}
```
