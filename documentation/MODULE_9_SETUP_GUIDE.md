# Module 9: Setup & Testing Guide

## Required Environment Variables
Ensure the following exist in your `.env.local`:
- `GROQ_API_KEY`: For generating the personalized review text.
- `TWILIO_ACCOUNT_SID` & `TWILIO_AUTH_TOKEN`: For WhatsApp delivery.

## Testing the CSV Import
1. Create a dummy CSV file on your desktop:
   ```csv
   Name,Phone,Service
   Alice Test,+1234567890,Plumbing
   Bob Test,+1987654321,Roofing
   ```
2. Navigate to `http://localhost:3000/dashboard/campaigns`.
3. Click **Import Customers** and drag the CSV file into the dropzone.
4. Verify the PapaParse preview table successfully parsed the columns.
5. Click **Import**. The UI will refresh, and the rows will appear in the database table with a "Ready" status.

## Testing the Drip Campaign
1. Ensure your Inngest Dev Server is running (`npx inngest-cli@latest dev`).
2. Click the **"Request"** button next to one of your imported customers.
3. Open the Inngest Dashboard (`http://127.0.0.1:8288`).
4. You will see the `process-review-campaign` function executing. It will send the first message, and then correctly transition into a `Sleeping` state for 2 days!
