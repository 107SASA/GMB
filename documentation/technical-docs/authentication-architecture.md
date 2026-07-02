# Authentication Architecture

This document details the production-grade authentication implementation built into the SaaS platform.

## Overview
The platform uses a custom robust session strategy combining JWTs stored in strict `HttpOnly` cookies, MongoDB-backed user records, and background OTP delivery via Inngest.

## 1. Security First Principles
- **No LocalStorage**: Access tokens (JWTs) are NEVER stored in `localStorage` or `sessionStorage` to prevent XSS exfiltration. They are issued as `HttpOnly`, `SameSite=Strict`, `Secure` cookies by the `/api/auth/login` route.
- **Hashed Everything**: Passwords are hashed using `bcryptjs` with 12 salt rounds. All generated OTPs (for email and SMS) are hashed using `crypto.createHash('sha256')` before being saved to MongoDB. This ensures that even if the database is leaked, an attacker cannot log in or hijack verification flows.
- **Brute-Force Protection**: The `/api/auth/login` route tracks `failedLoginAttempts`. After 5 consecutive failures, the account is hard-locked for 15 minutes (`accountLockedUntil`).
- **Idempotent Background Sending**: When a user registers, the HTTP request does NOT wait for Twilio or Nodemailer to respond. It instantly returns a `201 Created` and dispatches two Inngest events (`auth/send-email-otp` and `auth/send-phone-otp`). Inngest handles reliable delivery and retries in the background.

## 2. Models
The `User` model (`src/models/User.ts`) is strictly designed for SaaS multi-tenancy.
Key fields:
- `email`, `phone` (Unique, Indexed)
- `role`: 'Admin', 'BusinessOwner', 'TeamMember'
- `isEmailVerified`, `isPhoneVerified`
- `emailOtp`, `phoneOtp` (Hashed values)
- `failedLoginAttempts`, `accountLockedUntil`

## 3. Middleware
`src/middleware.ts` acts as the primary gatekeeper.
- It intercepts every request.
- If the route starts with `/dashboard` and the `auth_token` cookie is missing, it issues an HTTP 302 Redirect to `/auth/login`.
- If the route is `/auth/login` and the user already has a valid token, they are redirected into the dashboard.

## 4. Workflows

### Registration & Verification
1. User submits `POST /api/auth/register`.
2. Backend validates strong password requirements.
3. Backend generates two 6-digit OTPs.
4. Backend hashes the OTPs, saves the unverified User document, and dispatches Inngest.
5. Inngest workers wake up and send the raw OTPs to the user via Email/SMS.
6. User arrives at `/auth/verify`.
7. User submits OTP via `POST /api/auth/verify`. Backend hashes input and compares. Sets `isVerified` flag.

### Login
1. User submits `POST /api/auth/login`.
2. Backend checks `accountLockedUntil`.
3. Backend uses `bcrypt.compare` on password.
4. If successful, issues JWT signed with `JWT_SECRET`.
5. Sets `Set-Cookie` header and returns 200 OK.
