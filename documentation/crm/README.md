# CRM Module Documentation

The CRM is the single source of truth for all leads, customers, and communications within GMBBoost. It acts as a lightweight, automated pipeline (similar to HubSpot or Pipedrive) where all data flows into a unified master view.

## Core Principles

1. **Single Source of Truth**: All inbound requests (WhatsApp, Website forms, Manual entries, Review interactions) create or update `Lead` documents in the CRM.
2. **Business Isolation**: Multi-tenancy is strictly enforced. No API endpoint allows access to leads outside the user's `activeBusinessId`.
3. **Unified Views**: Both the Kanban and List views use the identical underlying data state. Any filtering, sorting, or manipulation reflects immediately across both views.
4. **AI-Powered**: Leads are automatically scored by LLaMA (0-100) based on their interaction history and intent.

## Data Model

The primary entity is the `Lead`.
- `businessId`: (ObjectId) The tenant this lead belongs to.
- `pipelineStage`: (String) Maps to the Kanban columns.
- `status`: (String) `active` or `inactive`/`lost`.
- `aiLeadScore`: (Number) 0-100 score indicating conversion intent.
- `source`: (String) The origin of the lead (WhatsApp, Website, etc).

## API Endpoints

All CRM endpoints are located under `/api/crm/leads`.
- `GET /api/crm/leads`: Fetches all leads for the active business. Enforces `activeBusinessId` via cookies.
- `POST /api/crm/leads`: Creates a new manual lead.
- `PATCH /api/crm/leads/:id`: Updates lead details or pipeline stages. Generates an `Activity` timeline event if the stage changes.
- `POST /api/crm/leads/:id/activity`: Appends a manual note to the Activity Timeline.

## Activity Timeline

The Activity Timeline (`Activity` model) tracks every interaction with the lead:
1. Stage changes (Kanban drags)
2. Inbound WhatsApp messages
3. Outbound AI WhatsApp messages
4. Manual notes added by users

## Pipeline Standardization

While businesses can dynamically add and name their own pipeline stages (`kanbanColumns`), new businesses are provisioned with standard defaults:
`['New', 'Contacted', 'Qualified', 'Interested', 'Not Interested', 'Converted']`.

Leads without a stage are mapped to the first column (`New` or `Unassigned`).

## Platform Architecture: Demo Bookings

While the CRM is predominantly used by our clients to manage *their* leads, it also acts as the internal system of record for **GMBBoost Platform Prospects** (Demo Bookings). 

When a user visits `/book-demo` and submits the form:
1. An internal `Lead` is created with `tenantId: 'gmbboost-internal'` and `leadType: 'Platform Prospect'`.
2. A `DemoBooking` record is created and linked to the `Lead`.
3. An Inngest background job (`demo/booked`) dispatches confirmation emails via SendGrid to the prospect and platform admins.
4. The Super Admin manages these bookings strictly via the `/admin/demo-bookings` dashboard. 

**Security Note:** Standard API endpoints (`/api/crm/leads`) enforce strict multi-tenancy (`activeBusinessId`). Platform prospects bypass this by using a dedicated tenant namespace and are only surfaced in Super Admin routes (`/api/admin/demo-bookings`), ensuring clients never see our internal leads.
