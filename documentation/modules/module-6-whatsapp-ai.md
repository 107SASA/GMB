# Module 6: WhatsApp AI Agent

## 1. Module Overview
The WhatsApp AI Agent acts as an automated frontline responder for inbound WhatsApp leads. When a user messages the configured Twilio WhatsApp number, the system creates/updates their CRM `Lead` profile, analyzes their conversation history, generates a highly contextual sales-driven response, and automatically qualifies the lead's intent and budget.

## 2. Architecture
- **Frontend Structure**: 
  - N/A. Operates entirely as a background webhook.
- **Backend Structure**: 
  - `src/app/api/webhook/twilio/route.ts`: The entry point for incoming Twilio POST requests. It parses the `From`, `Body`, and `ProfileName` URL-encoded form data.
- **Service Layer**: 
  - `src/services/whatsapp.ts`: Handles interactions with the Twilio SDK to actually dispatch outgoing messages.
  - `src/services/ai.ts`: Contains `generateSalesResponse()`, which processes the chat history and outputs both the textual reply and embedded JSON metadata for CRM tracking.
- **Database**: 
  - Uses the `Conversation` model to maintain a chat log, and deeply interacts with the `Lead` model to update state.

## 3. APIs Used
- **Internal APIs**: 
  - `POST /api/webhook/twilio`: The public-facing endpoint configured in the Twilio Console.
- **External APIs**: 
  - **Twilio Messaging API**: For sending outbound WhatsApp messages (`whatsapp:+1234567890`).
  - **Groq API**: For the LLM inference.

## 4. MongoDB/Mongoose Structure
- **Collections**:
  - `conversations`: Stores `leadId`, `messages` array (role/content), `platform` (WhatsApp), and timestamps.
  - `leads`: Creates new documents using the Twilio phone number as the unique identifier.

## 5. AI Integrations
- **Prompts**: The AI operates under a highly sophisticated prompt in `ai.ts` that demands an engaging, conversational reply *followed immediately* by a hidden JSON block (wrapped in `[METADATA]` tags).
- **Generation Logic**: The system parses the raw LLM output, splits it at `[METADATA]`, sends the text portion back to the user via WhatsApp, and uses the JSON portion to update the `Lead`'s `intentScore`, `budget`, `urgency`, and `qualificationStatus`.

## 6. Automation & n8n Workflows
- **Triggers**: Fully decoupled from n8n. Operates entirely via direct Twilio Webhooks.

## 7. UI/UX Components
- **Pages**: None.

## 8. Environment Variables Needed
```env
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+1234567890
GROQ_API_KEY=gsk_...
```

## 9. Execution/Setup Guide
1. Obtain an Ngrok URL for your local `localhost:3000`.
2. Configure your Twilio WhatsApp Sandbox to point its "When a message comes in" webhook to `https://<ngrok-url>/api/webhook/twilio`.
3. Message the Twilio sandbox number from your personal WhatsApp to trigger the flow.

## 10. Module Dependencies
- **Depends on**: Twilio SDK, Groq SDK.
- **Depended upon by**: CRM System (Module 5), as this module is the primary engine that creates and qualifies leads.

## 11. Known Issues / Technical Debt
- **Media Handling**: The Twilio webhook parses the text `Body`, but there is no logic to handle `MediaUrl` inputs (images/audio notes sent by users).
- **Format Parsing Fragility**: Extracting `[METADATA]` from the LLM output using `split('[METADATA]')` works most of the time but can break if the LLM hallucinates different bracket formats or puts conversational text after the JSON.

## 12. Future Scaling Suggestions
- **JSON Schema Output**: Switch to Groq's official JSON structured outputs to guarantee perfect CRM metadata parsing.
