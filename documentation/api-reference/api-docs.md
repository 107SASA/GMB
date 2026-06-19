# API Reference

This document covers the REST endpoints exposed in `src/app/api`.

---

## 1. Authentication (`/api/auth/*`)

### `POST /api/auth/register`
**Purpose:** Registers a new user, hashes password, and dispatches an Email OTP directly via Resend.
**Body:** `{ fullName, email, phone, password, companyName }`
**Response:** `201 Created`

### `POST /api/auth/login`
**Purpose:** Authenticates user and sets HttpOnly JWT cookie.
**Body:** `{ email, password }`
**Response:** `200 OK` (Sets `Set-Cookie: auth_token=...`)

### `POST /api/auth/verify-email`
**Purpose:** Verifies an OTP for email.
**Body:** `{ email, otp }`
**Response:** `200 OK`

### `POST /api/auth/resend-email-otp`
**Purpose:** Resends an OTP to the user's email.
**Body:** `{ email }`
**Response:** `200 OK`

### `POST /api/auth/logout`
**Purpose:** Clears the HttpOnly JWT cookie.
**Response:** `200 OK`

### `GET /api/auth/me`
**Purpose:** Retrieves the current authenticated user from the JWT cookie.
**Response:** `200 OK` (Returns User object excluding sensitive fields)

---

## 2. Webhooks

### `POST /api/webhook/twilio`
**Purpose:** Receives incoming SMS or WhatsApp messages from Twilio.
**Authentication:** Assumes Twilio standard signature validation (to be implemented in middleware).
**Request Body:** `application/x-www-form-urlencoded`
- `Body` (string): The text message.
- `From` (string): Sender's phone number.
- `ProfileName` (string, optional): WhatsApp sender name.
- `MessageSid` (string): Unique Twilio ID.
**Response:**
```xml
200 OK
Content-Type: text/xml

<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>
```
*Note: This endpoint instantly responds to Twilio and pushes the payload to Inngest for async processing.*

---

## 2. Leads (CRM)

### `GET /api/leads`
**Purpose:** Fetch the list of CRM leads.
**Query Parameters:**
- `status` (string, optional): Filter by lead status (e.g., 'New', 'Contacted').
- `minIntentScore` (number, optional): Filter by minimum intent score (0-100).
- `qualificationStatus` (string, optional): Filter by qualification level.
**Response:** `200 OK`
```json
[
  {
    "_id": "60d5ecb8b392d7...",
    "name": "John Doe",
    "phone": "+1234567890",
    "status": "Contacted",
    "intentScore": 85,
    "aiSummary": "User is looking for emergency plumbing."
  }
]
```

---

## 3. Review Generation

### `POST /api/upload`
**Purpose:** Parses a CSV file of historical customers and stores them for review campaigns.
**Request Body:** `multipart/form-data`
- `file` (File): The CSV file containing headers `name`, `phone`, `email`, `lastVisit`, `totalSpent`.
**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Processed 150 customers. 100 inserted, 50 updated.",
  "errors": []
}
```

### `GET /go/[id]`
**Purpose:** Smart-link tracker intercepting clicks from SMS campaigns.
**Path Parameters:**
- `id` (string): The customer ID.
**Behavior:**
1. Sets `ReviewRequest.status = 'CLICKED'` in MongoDB.
2. Returns a `302 Redirect` to the business's Google Review URL.

---

## 4. Reviews Management

### `GET /api/reviews`
**Purpose:** Fetch reviews and their AI-drafted replies.
**Query Parameters:**
- `businessId` (string): The ID of the business.
**Response:** Array of Review objects.

### `POST /api/reviews/[id]/post-reply`
**Purpose:** Approves and publishes an AI-generated reply to Google servers.
**Path Parameters:**
- `id` (string): The Review ID.
**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Reply posted successfully",
  "review": { ...updatedReview }
}
```

---

## 5. Inngest

### `PUT/POST/GET /api/inngest`
**Purpose:** Internal routing endpoint used by the Inngest Cloud executor to trigger background jobs. Not intended for manual frontend usage.

---

## 6. External Third-Party APIs

The platform heavily relies on external APIs, which must be configured in your `.env` file.

### Groq API (`GROQ_API_KEY`)
- **Usage:** Powers the core AI engine using the Llama-3 model (`llama-3.3-70b-versatile`).
- **Endpoints Used:** `/chat/completions`
- **Purpose:** Used in `src/services/ai.ts` for conversational replies, metadata extraction, content generation, and sentiment analysis.

### SerpApi (`SERPAPI_KEY`)
- **Usage:** Provides real-time scraping of Google Maps and Google Business profiles.
- **Endpoints Used:** `engine=google_maps`, `engine=google_maps_reviews`
- **Purpose:** Used in `src/services/google-maps.ts` during the GMB Audit to fetch live ratings, place IDs, and missing profile elements.

### Twilio API (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`)
- **Usage:** The bridge for telecom interactions (SMS and WhatsApp).
- **Endpoints Used:** Twilio REST API for Messages.
- **Purpose:** Used across the platform to send WhatsApp replies to leads, text alerts for critical reviews, and drip campaign SMS links to past customers.

### Inngest API (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`)
- **Usage:** The background job and queue orchestrator.
- **Purpose:** Inngest's cloud executor securely pings our `/api/inngest` endpoint using these keys to trigger cron jobs and deferred steps.

### Resend API (`RESEND_API_KEY`)
- **Usage:** Email delivery service.
- **Purpose:** Sending secure Email OTPs during user registration and authentication flows.
