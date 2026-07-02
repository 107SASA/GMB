# Module 6: AI Sales Agent - API Docs

## `POST /api/whatsapp/webhook`
- **Purpose**: Receives Twilio WhatsApp messages.
- **Behavior**: Returns `200 OK` instantly to prevent Twilio timeouts. Pushes the raw payload to Inngest.

## `GET /api/inbox/threads?businessId=...`
- **Purpose**: Fetches the list of active conversation threads for the sidebar.
- **Response**: Array of `ConversationThread` objects with populated `leadId`.

## `PATCH /api/inbox/threads`
- **Purpose**: Toggle AI on/off for a specific thread.
- **Body**: `{ "threadId": "...", "aiEnabled": false }`

## `GET /api/inbox/messages?leadId=...`
- **Purpose**: Fetch message history for the chat window. Marks the thread as read (`unreadCount: 0`).

## `POST /api/inbox/messages`
- **Purpose**: Allows a human agent to send a manual message. Automatically disables the AI for that thread.

## `GET | POST /api/inbox/config`
- **Purpose**: Fetch or update the `BusinessAIConfig` (System Prompt, Tone, Sales Rules).
