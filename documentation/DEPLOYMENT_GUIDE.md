# Deployment Guide

## 1. Prerequisites
- **Vercel Account**: For frontend/API hosting.
- **MongoDB Atlas**: For database hosting.
- **Inngest Cloud**: For background workers.
- **Twilio**: For WhatsApp integration.
- **Groq/OpenAI**: For AI generation.

## 2. Environment Variables Setup
Copy `.env.local.example` to the Vercel Environment Variables dashboard. Ensure `NEXTAUTH_URL` is set to your production domain.

## 3. MongoDB Atlas
1. Create a cluster.
2. Under Network Access, allow `0.0.0.0/0` (since Vercel IP ranges change).
3. Grab the Connection String and set it as `MONGODB_URI`.

## 4. Inngest Cloud Setup
1. Sync your Vercel project with Inngest via the Vercel Integration.
2. This will automatically inject `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
3. Once deployed, Inngest will hit `https://your-domain.com/api/inngest` to register all your background workers.

## 5. Twilio Webhook Setup
1. Go to Twilio Console -> WhatsApp Sandbox (or Production Sender).
2. Set the "When a message comes in" webhook to: `https://your-domain.com/api/whatsapp/webhook`.
3. Set the method to `HTTP POST`.

## 6. Vercel Deployment
1. Connect your GitHub repository to Vercel.
2. Ensure the Framework Preset is set to `Next.js`.
3. Hit Deploy. The build process will run `next build`.
4. Monitor the logs for any TypeScript compilation errors.
