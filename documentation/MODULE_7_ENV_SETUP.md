# Module 7: n8n Environment Setup

Inside n8n, workflows use the `{{$env.VARIABLE_NAME}}` syntax to pull environment variables dynamically. This ensures that the JSON files are safe to commit and deploy across different environments.

## Setting n8n Environment Variables
If you are running n8n via Docker, you must pass these variables using the `-e` flag, or by creating a `.env` file for docker-compose.

```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -e GMB_API_URL="http://host.docker.internal:3000" \
  -e BUSINESS_ID="60b9b3b3b3b3b3b3b3b3b3b3" \
  -e TENANT_ID="demo-tenant" \
  -e TWILIO_ACCOUNT_SID="AC12345..." \
  -e TWILIO_AUTH_TOKEN="abcd..." \
  -e TWILIO_WHATSAPP_NUMBER="whatsapp:+14155238886" \
  -e ADMIN_WHATSAPP_NUMBER="whatsapp:+1234567890" \
  -v ~/.n8n:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n
```

### Variable Breakdown:
- **`GMB_API_URL`**: The base URL of your Next.js application.
- **`BUSINESS_ID`**: The MongoDB ObjectId of the business for multi-tenant isolation.
- **`TENANT_ID`**: The string identifier for the tenant.
- **`TWILIO_*`**: Standard Twilio API credentials.
- **`ADMIN_WHATSAPP_NUMBER`**: The phone number (formatted `whatsapp:+1...`) where automation alerts (like low buffer warnings) will be sent.
