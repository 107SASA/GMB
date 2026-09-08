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

## 7. Build memory

`next build` (and a standalone `tsc --noEmit`) type-check the whole codebase in
one pass and the default Node heap (~2 GB) is no longer enough — the build
fails with `FATAL ERROR: Ineffective mark-compacts near heap limit / JavaScript
heap out of memory` in the "Running TypeScript" phase.

Set an 8 GB heap in the build/CI environment:

```
NODE_OPTIONS=--max-old-space-size=8192
```

- **Vercel / most CI**: add `NODE_OPTIONS` as an environment variable (build scope).
- **DigitalOcean droplet / bare `npm run build`**: `NODE_OPTIONS=--max-old-space-size=8192 npm run build`
  (PowerShell: `$env:NODE_OPTIONS='--max-old-space-size=8192'; npm run build`).

It is intentionally NOT baked into the `package.json` scripts because the inline
`NODE_OPTIONS=… cmd` prefix is not portable to Windows `cmd`/PowerShell and this
repo is developed on Windows.

The `mobile/` Expo app is a separate package — build and lint it from inside
`mobile/` with its own toolchain, not from the web root.
