# Module 4: Setup Guide

## Requirements
1. MongoDB Atlas connection.
2. Inngest Local Dev Server.
3. Groq API Key (for LLaMA 3.3 generation).

## Environment Variables
Ensure `.env.local` contains:
```env
GROQ_API_KEY=your_key
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_WHATSAPP_NUMBER=your_number
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Running the UI
Navigate to `http://localhost:3000/dashboard/reviews`.
The dashboard will start empty. 

## Testing the Module
1. Click **Sync Reviews** in the top right.
2. The mock provider will simulate network latency and return 4 dummy reviews.
3. Watch the Analytics Cards instantly calculate your average rating and sentiment.
4. Expand the 1-Star Review (Amit Patel).
5. Select the **Apology** tone.
6. Click **Generate AI Reply**. Groq will respond within seconds.
7. Edit the text if desired, then click **Approve & Post**.
8. Notice the reply status update and the "Unanswered" count drop on the Analytics cards!
