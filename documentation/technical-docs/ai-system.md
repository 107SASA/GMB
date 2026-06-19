# AI Systems Architecture

This platform relies on Large Language Models (LLMs) to power the core value proposition. We use the **Groq SDK** running the **Llama-3 (70b-versatile)** model.

## 1. Why Groq?
Groq utilizes LPU (Language Processing Unit) architecture, offering inference speeds vastly superior to OpenAI. For synchronous WhatsApp chat bots, latency under 2 seconds is critical to prevent a disjointed user experience.

## 2. Structured JSON Outputs
Historically, extracting structured data (like intent scores or hashtags) from LLMs required fragile Regex parsing (`split('[METADATA]')` or stripping backticks). 
We now enforce native JSON structures using Groq's `response_format: { type: 'json_object' }`.

### Example: Content Generation
```typescript
const response = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [...],
  temperature: 0.8,
  response_format: { type: 'json_object' },
});
```
The system prompt strictly dictates the JSON keys required:
```json
{
  "title": "...",
  "content": "...",
  "hashtags": ["...", "..."],
  "cta": "...",
  "seo_score": 85
}
```

## 3. Contextual Memory & Deduplication
LLMs are stateless. If a cron job asks the AI to generate 3 posts in a loop, it might generate the exact same post 3 times.

**The Solution:**
In `src/services/inngest/functions.ts` (inside `processContentJob`), we extract the text of the last 5 scheduled posts. We pass this array as `previous_posts` into the API request. The AI prompt explicitly instructs the model to *avoid* overlapping topics with the provided history.

## 4. Deterministic Sentiment Analysis
When grading reviews, we need rigid, predictable outputs (not conversational fluidity).
For the `analyzeSentiment` function, we:
- Drop the `temperature` to `0.1` (highly deterministic).
- Restrict `max_tokens` to a very small number.
- Force it to output *only* `positive`, `neutral`, `negative`, or `critical`.

## 5. Sales Conversation Metadata Injection
The WhatsApp agent needs to act conversational, but we still need metadata (intent, urgency). 
The AI prompt instructs the model to respond conversationally, but append a specific hidden tag (or output a multi-layered JSON object where one key is the text reply, and the other keys update the CRM).
