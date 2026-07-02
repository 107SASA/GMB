# Module 3: Setup Guide

## Requirements
To fully utilize Module 3, you need:
1. Running MongoDB Atlas.
2. Running Inngest local dev server.
3. Active Twilio credentials (optional for testing, required for SMS/WhatsApp alerts).

## Environment Variables
Ensure the following are set in `.env.local`:
```env
# Twilio for Admin Alerts
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_WHATSAPP_NUMBER=your_number
```

## Running the Architecture
1. Start Next.js: `npm run dev`
2. Start Inngest: `npx inngest-cli@latest dev`
3. Navigate to `http://localhost:3000/dashboard/scheduler`

## Testing the Buffer
1. Because your database is likely empty for posts, the UI will immediately show a red "Critical" buffer health banner.
2. Click "Generate Now".
3. Watch the Inngest Dev UI (`http://localhost:8288`). You will see the job `process-content-job` execute.
4. After ~5 seconds, the UI will automatically refresh, showing the buffer as Healthy!
