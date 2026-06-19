# Module 2: AI Content Studio - API Docs

## `POST /api/content/generate`

Generates structured content synchronously using Groq.

**Request Body:**
```json
{
  "businessName": "Acme Roofing",
  "businessType": "Roofing Contractor",
  "location": "Austin, TX",
  "tone": "Professional",
  "keywords": ["roof repair", "storm damage"],
  "contentTypes": ["GMB Posts", "SEO Description", "FAQs"]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "posts": [
      {
        "dayLabel": "Day 1",
        "postType": "Promotional",
        "title": "Expert Roof Repair",
        "body": "Need roof repair...",
        "cta": "Call Now",
        "hashtags": ["#roofing", "#austin"]
      }
    ],
    "seoDescription": "Acme Roofing provides...",
    "faqs": [
      {
        "question": "Do you offer free estimates?",
        "answer": "Yes, we do!"
      }
    ],
    "contentScore": 95,
    "seoScore": 92,
    "engagementPrediction": "High"
  }
}
```

---

## `POST /api/content/schedule`

Saves a generated post into the database as a draft.

**Request Body:**
```json
{
  "title": "Expert Roof Repair",
  "content": "Need roof repair...",
  "postType": "Promotional",
  "hashtags": ["#roofing"],
  "cta": "Call Now",
  "tone": "Professional"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "postId": "60b9b...1234"
}
```
