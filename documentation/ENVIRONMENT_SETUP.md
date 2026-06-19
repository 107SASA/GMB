# .env.local.example

```env
# 1. DATABASE
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/gmb-platform

# 2. AUTHENTICATION
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_super_secret_jwt_string_here

# 3. AI SERVICES
OPENAI_API_KEY=sk-proj-xxxx
GROQ_API_KEY=gsk_xxxx

# 4. TWILIO WHATSAPP
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_WHATSAPP_NUMBER=+14155238886

# 5. EMAIL
RESEND_API_KEY=re_xxxx

# 6. INNGEST (Auto-populated by Vercel Integration in production)
INNGEST_EVENT_KEY=local
INNGEST_SIGNING_KEY=local

# 7. APP CONFIG
NEXT_PUBLIC_APP_URL=http://localhost:3000
```
