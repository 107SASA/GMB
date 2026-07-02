# Module 5: CRM System

## 1. Module Overview
The CRM System is the centralized data layer for capturing, qualifying, and tracking incoming leads. It is designed to track a lead's journey from a raw "New" state to "Sales Ready", monitoring variables like intent score, budget, urgency, and conversation stage.

## 2. Architecture
- **Frontend Structure**: 
  - `src/app/dashboard/crm/page.tsx`: A drag-and-drop Kanban board using `@dnd-kit` mapping the CRM data structure.
- **Backend Structure**: 
  - `src/app/api/leads/route.ts`: Basic `GET` (fetch all) and `POST` (create new lead) endpoints.
  - `src/app/api/leads/[id]/route.ts`: Specific endpoints to manage individual lead statuses.
- **Database**: 
  - Uses the massive `Lead` Mongoose model.

## 3. APIs Used
- **Internal APIs**: 
  - `GET /api/leads`
  - `POST /api/leads`
- **External APIs**: 
  - N/A natively, but the CRM acts as the target for the WhatsApp webhook.

## 4. MongoDB/Mongoose Structure
- **Collections**:
  - `leads`: Highly detailed schema including:
    - `status`: New, Contacted, Qualified, Interested, Booking Pending, Converted, Lost.
    - `qualificationStatus`: Unqualified, Partially Qualified, Qualified, Sales Ready.
    - AI-derived insights: `aiSummary`, `aiTags`, `intentScore`, `conversionProbability`.
    - Activity: `lastUserMessage`, `lastAIReply`, `lastInteractionTime`.

## 5. AI Integrations
- While the CRM itself does not run AI queries, it is deeply integrated with the WhatsApp AI Agent (Module 6) which actively writes data (like `aiSummary` and `qualificationStatus`) directly into the `Lead` model after evaluating conversations.

## 6. Automation & n8n Workflows
- **Triggers**: n8n is intended to pull leads from this model via `/api/leads` to trigger Drip Campaigns or "Follow-Up" logic, but the actual orchestration logic is missing from this repository.

## 7. UI/UX Components
- **Pages**: `/dashboard/crm`. Features a Kanban pipeline for drag-and-drop lead stage management.

## 8. Environment Variables Needed
None specifically for the CRM (beyond standard `MONGODB_URI`).

## 9. Execution/Setup Guide
The API endpoints are live and functional, but the data must be interacted with via Postman or MongoDB Compass until the UI is built.

## 10. Module Dependencies
- **Depends on**: Database connectivity.
- **Depended upon by**: WhatsApp AI Agent (for creating leads when users text the Twilio number).

## 11. Known Issues / Technical Debt
- **Activity Timeline**: While the Kanban board exists, individual lead modal views for the activity timeline are still in progress.

## 12. Future Scaling Suggestions
- **Websocket Updates**: Introduce Socket.io or Pusher so that when the WhatsApp Agent updates a Lead's `intentScore` in the background, the CRM UI updates live without refreshing.
