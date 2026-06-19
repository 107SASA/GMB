# Module 5: CRM Setup Guide

## Requirements
1. Valid `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in your `.env.local`.
2. Valid `TWILIO_WHATSAPP_NUMBER` configured to send outbound messages.
3. Inngest dev server running (`npx inngest-cli@latest dev`).

## Verification Steps
1. Navigate to `http://localhost:3000/dashboard/crm`.
2. Click the **"Add Dummy Lead"** button. This will hit the POST API.
3. A new lead named "John Smith" will appear in the **New** column with an AI Score.
4. Open the Inngest dashboard (`http://127.0.0.1:8288`). You should see `crm/lead-created` event triggered.
5. In the UI, drag John Smith from **New** to **Qualified**. The UI will update instantly and sync to MongoDB.
6. Click the lead card to open the **Lead Drawer**. 
7. Add a manual note in the timeline. Notice how the status change from "New -> Qualified" is already logged above your note!
