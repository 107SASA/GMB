# MongoDB Schema Reference

The platform uses Mongoose to map application data to MongoDB collections.

---

## 1. `Business`
Core tenant model representing the user's business.
- **Fields:**
  - `name` (String): Business name.
  - `phone` (String): Twilio assigned number.
  - `website`, `address`, `placeId`, `industry` (Strings): GMB data.
  - `aiPersonality` (String): Used to dictate the AI's chat tone.

## 2. `Lead` (CRM)
Represents a potential customer currently in the sales pipeline.
- **Fields:**
  - `name`, `phone` (String, Indexed).
  - `status` (Enum): `['New', 'Contacted', 'Qualified', 'Interested', 'Booking Pending', 'Converted', 'Lost']`. Maps to the Kanban board columns.
  - `intentScore` (Number): 0-100, dictated by the AI.
  - `urgency` (Enum): `['Low', 'Medium', 'High', 'Urgent']`.
  - `aiSummary` (String): A brief summary of the conversation history.

## 3. `Conversation`
Stores the exact transcript of WhatsApp interactions for context injection.
- **Fields:**
  - `leadId` (ObjectId, ref 'Lead').
  - `messages` (Array of Objects): Contains `role` ('user' | 'assistant') and `content` (String), and `timestamp`.

## 4. `Post`
Represents a Google Business Post.
- **Fields:**
  - `businessId` (ObjectId, ref 'Business').
  - `title`, `content` (String).
  - `type` (Enum): `['Update', 'Offer', 'Event']`.
  - `hashtags` (Array of Strings).
  - `scheduledDate` (Date): When the cron job should publish it.
  - `status` (Enum): `['draft', 'scheduled', 'published', 'failed']`.

## 5. `Review`
A Google review left by a customer.
- **Fields:**
  - `businessId` (ObjectId).
  - `reviewerName`, `reviewText` (String).
  - `rating` (Number): 1-5.
  - `sentiment` (Enum): `['positive', 'neutral', 'negative', 'critical']`.
  - `aiSuggestedReply` (String): The drafted response waiting for human approval.
  - `replyStatus` (Enum): `['PENDING', 'APPROVED', 'POSTED']`.

## 6. `Customer`
A historical buyer, usually uploaded via CSV for campaigns.
- **Fields:**
  - `firstName`, `lastName`, `phone`, `email` (String).
  - `lastVisit` (Date): Used for filtering.
  - `totalSpent` (Number): Used for VIP segmentation.

## 7. `ReviewRequest`
A tracking model for drip campaigns.
- **Fields:**
  - `customerId` (ObjectId).
  - `campaignId` (String).
  - `status` (Enum): `['PENDING', 'SENT', 'CLICKED', 'REVIEWED']`.
  - `sentAt`, `clickedAt` (Date).

## 8. `AutomationLog`
An audit trail of actions taken by Inngest workers.
- **Fields:**
  - `type` (String): e.g., 'api_publish'.
  - `workflow` (String): e.g., 'content-scheduler'.
  - `action` (String): e.g., 'publish_post'.
  - `status` (String): 'success' | 'failed'.
