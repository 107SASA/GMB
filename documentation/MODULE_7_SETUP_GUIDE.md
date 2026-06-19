# Module 7: Setup Guide

## Local n8n Setup via Docker
The easiest way to run n8n alongside your Next.js app is using Docker.

1. Ensure Docker Desktop is installed and running.
2. Run the following command in your terminal to start n8n:
```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n
```
3. Open your browser and navigate to `http://localhost:5678`.
4. Follow the on-screen instructions to create your local admin account.

## Exposing Local APIs
If n8n is running in Docker and your Next.js app is running on `localhost:3000`, n8n cannot resolve `localhost`.
- You must use `http://host.docker.internal:3000` as the `GMB_API_URL` environment variable inside n8n.
- Alternatively, use `ngrok http 3000` and use the public ngrok URL.

## Twilio Setup
1. Gather your `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
2. In n8n, go to **Credentials** -> **Add Credential** -> **Header Auth** (or Basic Auth for Twilio APIs).
3. Follow the Import Guide to map these credentials to the workflows.
