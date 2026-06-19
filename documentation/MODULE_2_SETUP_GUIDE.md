# Module 2: AI Content Studio - Setup Guide

## Requirements
To run Module 2, you must have the Groq SDK configured properly, as the AI Engine relies on Groq LLaMA models instead of OpenAI to provide lightning-fast generation.

## 1. Environment Variables
Ensure your `.env.local` contains a valid Groq API Key:

```env
GROQ_API_KEY=gsk_your_groq_api_key_here
```

## 2. Running Locally
1. Start the Next.js app:
   ```bash
   npm run dev
   ```
2. Navigate to `http://localhost:3000/dashboard/content`.

## 3. Testing the Flow
- Enter dummy business details into the Content Generator Form.
- Add some keywords and hit "Generate AI Workspace".
- The generation will take 2-5 seconds.
- You will be presented with a 3-tab UI.
- On the "Weekly Posts" tab, click "Schedule" on any post.
- Verify in your MongoDB instance (via Compass or Mongo Shell) that a new `Post` record was inserted with `status: 'draft'`.
