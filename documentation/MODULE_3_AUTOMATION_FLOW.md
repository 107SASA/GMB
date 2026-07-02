# Module 3: Automation Flow

## The 7-Day Rule
The system strictly enforces a minimum 7-day scheduled content buffer.

### Scenario A: Cron Execution (Automated)
1. At 8:00 AM, Inngest triggers `bufferMonitorWorker`.
2. Worker finds `Business A` has only 3 days of content.
3. Worker dispatches `processContentJob`.
4. `processContentJob` notices buffer < 4, sends Twilio WhatsApp Alert to Business Admin: "Buffer critically low."
5. AI Engine generates 4 new posts.
6. Posts are saved as `scheduled`.
7. `AutomationLog` records success.

### Scenario B: UI Execution (Manual)
1. User logs in, sees `LowBufferBanner` (e.g. 5/7 days covered).
2. User clicks "Generate Now".
3. UI calls `POST /api/scheduler/generate`.
4. API dispatches `processContentJob` with `force: true`.
5. AI Engine generates 7 new posts.
6. Calendar polls API, UI updates to 7/7 days covered (Healthy).
