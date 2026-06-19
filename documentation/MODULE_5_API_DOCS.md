# Module 5: AI Lead Manager - API Docs

## `POST /api/crm/leads`
Creates a new lead, logs the creation activity, and dispatches the initial Inngest follow-up worker.
**Body:** `{ "businessId": "...", "name": "John", "phone": "+1...", "source": "Website" }`

## `GET /api/crm/leads?businessId=...`
Fetches all leads for the specified business, sorted by creation date.

## `PATCH /api/crm/leads/:id`
Updates fields on a lead (e.g. `pipelineStage`, `status`, `notes`). If `pipelineStage` changes, an automatic `status_change` activity log is generated.

## `POST /api/crm/leads/:id/activity`
Appends a manual note, call log, or meeting to the lead's timeline.
**Body:** `{ "type": "note", "content": "Left a voicemail" }`

## `GET /api/crm/leads/:id/timeline`
Retrieves a unified timeline combining `Activity` logs and upcoming `FollowUp` logs for rendering in the Drawer interface.
