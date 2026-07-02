# Google Places Setup Instructions

To ensure the new onboarding experience works in production, you must configure Google Cloud Platform (GCP).

## 1. Get an API Key
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select your existing one.
3. Navigate to **APIs & Services** > **Credentials**.
4. Click **Create Credentials** > **API Key**.

## 2. Enable Required APIs
You MUST enable the following APIs for your project:
1. **Places API (New)** or **Places API**
2. **Maps JavaScript API** (Optional, if you add map components later)

## 3. Restrict the Key (CRITICAL)
In the credentials dashboard:
- Under **Application Restrictions**, you can leave it open for development, but in production, restrict it to your IP addresses (since requests originate from your Next.js server).
- Under **API Restrictions**, restrict this key to ONLY the **Places API**.

## 4. Environment Variables
Add the key to your `.env.local`:
```bash
GOOGLE_MAPS_API_KEY="AIzaSy..."
```
