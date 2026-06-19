# Production Deployment

## 1. Vercel (Frontend & APIs)
The platform is built on Next.js and optimized for Vercel.
1. Connect your GitHub repository to Vercel.
2. In the Vercel dashboard, add all environment variables.
3. **CRITICAL:** Vercel functions have timeouts (10s on Hobby, 60s on Pro). Our architecture mitigates this by passing heavy tasks to Inngest, so standard Hobby/Pro plans are perfectly fine.
4. Deploy.

## 2. Inngest Cloud
You must link your Vercel deployment to Inngest Cloud.
1. Create an Inngest Account.
2. Link it to your Vercel project via the Vercel Integration (this automatically sets `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Vercel).
3. Inngest Cloud will automatically detect your `/api/inngest` route upon deployment and register all cron jobs and workers.

## 3. MongoDB Atlas
1. Ensure your MongoDB Atlas cluster allows network access from Vercel's IP addresses (or `0.0.0.0/0` if necessary).
2. Set the `MONGODB_URI` in Vercel.

## 4. Twilio Production
1. Upgrade from the Twilio Sandbox to a registered WhatsApp Business Account.
2. Update the webhook URL in your Twilio settings to point to your live Vercel domain:
   `https://your-domain.com/api/webhook/twilio`
3. Update `TWILIO_WHATSAPP_NUMBER` in Vercel to your official number.
