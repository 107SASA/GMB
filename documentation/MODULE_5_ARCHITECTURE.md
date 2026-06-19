# Module 5: AI Lead Manager - Architecture

## Overview
The AI Lead Manager replaces generic, disconnected CRM solutions by natively integrating into the GMB Optimizer ecosystem. It utilizes `@dnd-kit` for a premium, lightweight Kanban interface and leverages our existing MongoDB and Inngest queues for robust, scalable lead automation.

## Database Models
- **Lead**: Core schema containing the prospect's profile, contact info, pipeline stage, custom fields, and AI scoring metrics (`aiLeadScore`, `aiInsights`). Isolated via `tenantId`.
- **Activity**: An immutable timeline tracking state changes, manual notes, and automated outbound communication (like Twilio WhatsApp sends).
- **FollowUp**: Tracks precisely scheduled follow-up tasks to ensure idempotency.

## Background Processing (Inngest)
- **`scheduleLeadFollowUpsJob`**: Fired on lead creation. This worker calculates the `aiLeadScore` using Groq and utilizes `step.sleepUntil` to safely pause execution for 1, 3, and 7 days. At each interval, it dispatches an event.
- **`dispatchWhatsappFollowUpJob`**: Receives events from the scheduler. Checks if the lead has converted or opted out. If still active, it fires the Twilio template and logs the success to the `Activity` collection.

## Frontend
The dashboard (`/dashboard/crm`) fetches the `Lead` array and passes it to the `KanbanBoard` component. State changes via drag-and-drop are optimistically rendered using `react` state and synced asynchronously to the DB. Clicking a lead card opens the `LeadDrawer` side panel without reloading the page, offering access to the lead's Activity Timeline.
