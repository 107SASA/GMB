# Auth Setup Guide

## Overview
We utilize **NextAuth.js (v4)** with the Credentials provider to handle local username/password authentication, using `bcryptjs` for secure hashing.

## Session Strategy
We use **JWT (JSON Web Tokens)** because:
1. It works perfectly with Next.js Edge Middleware.
2. It allows us to embed `organizationId` and `activeBusinessId` directly into the token, saving a database lookup on every API request.

## Middleware Protection
The `src/middleware.ts` file intercepts all traffic to `/dashboard/*`.
If no valid NextAuth session token is found in the cookies, it automatically redirects the user to `/login`.

## Security Implementations
- **HttpOnly Cookies**: Prevents XSS attacks from reading the JWT.
- **CSRF Protection**: Native to NextAuth.
- **Bcrypt Hashing**: Passwords are never stored in plaintext.

## Setup Instructions
1. Set `NEXTAUTH_SECRET` in your `.env.local`. Run `openssl rand -base64 32` to generate one.
2. Set `NEXTAUTH_URL=http://localhost:3000` (or your production domain).
3. Seed a test user in MongoDB using the `/api/seed` (if created) or manually create a User document with a hashed password.
