# Module 6: Automation & Human Handoff Flow

## 1. Webhook Reception
- Twilio sends a message. The Next.js API route returns an empty TwiML `<Response></Response>` within ~50ms.
- A `whatsapp/incoming` event is enqueued.

## 2. Worker Processing
- Inngest picks up the event.
- It checks the `ConversationThread`. If `aiEnabled` is FALSE, the worker simply logs the inbound message to the database and cleanly exits. No AI generation happens.
- If `aiEnabled` is TRUE, it fetches the `BusinessAIConfig`.
- It fetches the last 10 messages to build context.
- Groq/LLaMA 3.3 generates a reply based on the System Prompt and Sales Rules.
- The outbound message is sent via Twilio SDK.

## 3. Human Takeover (Handoff)
- An admin watches the chat in the Inbox UI.
- They can click the "AI Handling" toggle to instantly pause the bot.
- Alternatively, if they type a message in the composer and click "Send", the backend API (`POST /api/inbox/messages`) automatically triggers a `ConversationThread.findOneAndUpdate({ aiEnabled: false })`.
- Future inbound messages will be ignored by the Inngest AI worker until the toggle is turned back on.
