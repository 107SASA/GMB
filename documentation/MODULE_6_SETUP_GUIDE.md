# Module 6: Setup & Testing Guide

## Prerequisites
1. `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in `.env.local`.
2. `GROQ_API_KEY` for LLaMA 3.3 inference.
3. Inngest dev server running (`npx inngest-cli@latest dev`).

## Twilio Configuration
1. Go to your Twilio Console -> WhatsApp Sandbox (or actual sender).
2. Set the Webhook URL to your public URL (via ngrok/localtunnel): `https://YOUR_NGROK_URL.ngrok.app/api/whatsapp/webhook`
3. Ensure the HTTP method is set to `POST`.

## Testing the Flow
1. Open the Inbox Dashboard: `http://localhost:3000/dashboard/inbox`
2. Send a WhatsApp message from your phone to your Twilio Number: *"Hi, I want to book a demo."*
3. You will see the new thread pop up in the Inbox instantly.
4. Wait 2-3 seconds. The Inngest worker will process the AI generation, and you will see the AI's outbound response appear in the Chat Window and on your phone!
5. In the Inbox, type *"I will take over from here"* in the composer and click send.
6. The AI Toggle will flip to "Human Takeover Active" (Yellow).
7. Reply from your phone again. The AI will *not* respond.
