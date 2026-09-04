# Local Setup Guide

This guide explains how to run the entire GrowwMatics AI platform locally.

## 1. Prerequisites
- Node.js (v18+)
- MongoDB Atlas Account (or local MongoDB)
- Twilio Account (for Sandbox)
- Groq API Key
- SerpApi Key

## 2. Environment Variables
Create a `.env.local` file in the root:
```env
MONGODB_URI=mongodb+srv://...
GROQ_API_KEY=gsk_...
SERPAPI_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=+14155238886
INNGEST_EVENT_KEY=local
INNGEST_SIGNING_KEY=local
```

## 3. Running Next.js
Install dependencies and start the Next.js App Router:
```bash
npm install
npm run dev
```
The dashboard is now available at `http://localhost:3000`.

## 4. Running Inngest (Background Workers)
Because Vercel serverless functions don't run continually, you MUST run the Inngest Dev Server to process background tasks (like WhatsApp parsing and cron jobs).
Open a **new terminal tab**:
```bash
npx inngest-cli@latest dev
```
Access the Inngest Dev UI at `http://localhost:8288`. It will automatically connect to your Next.js app on port 3000.

## 5. Twilio Sandbox Setup (Local Webhooks)
To test WhatsApp locally, you need a public URL for Twilio to ping.
1. Use `ngrok` to expose your port 3000:
   ```bash
   ngrok http 3000
   ```
2. Copy the `https://xxxx.ngrok.app` URL.
3. Go to Twilio Console -> Messaging -> Try it out -> Send a WhatsApp message.
4. Set the **"When a message comes in"** webhook to:
   `https://xxxx.ngrok.app/api/webhook/twilio`
5. Join your sandbox by messaging the join code to your Twilio number.

## 6. Testing
You can now text your Twilio sandbox number. Ngrok will forward it to your local Next.js `/api/webhook/twilio` route. Next.js will instantly respond 200 OK and push the event to your local Inngest server, which will execute `processWhatsappMessage` and hit the Groq API!

## 7. Razorpay Webhook Setup (Local Payments)
Same problem as Twilio: Razorpay's servers can't call `http://localhost:3000`, so a payment made against local dev never reaches `/api/webhook/razorpay` unless you tunnel it.

1. Reuse the same `ngrok http 3000` tunnel from step 5 (or start one if you skipped Twilio).
2. Razorpay Dashboard → **Account & Settings → Webhooks** → Add a webhook pointing at
   `https://xxxx.ngrok.app/api/webhook/razorpay`, subscribed to at least
   `subscription.activated`, `subscription.charged`, `payment.failed`, `subscription.cancelled`.
3. Copy that webhook's **Secret** into `.env.local` as `RAZORPAY_WEBHOOK_SECRET` (must match the one shown in the dashboard for THAT webhook, not a different one).

**Without the tunnel**, checkout still mostly works locally: `GET /api/billing/status` (polled by the checkout widget) self-heals by checking directly with Razorpay's API if the webhook never showed up (see `lib/billing/razorpayReconcile.ts`), so a successful payment activates within a few seconds either way. The tunnel is only required to test webhook-only paths locally — failed payments, cancellations, renewals — where nothing else triggers a status re-check.
