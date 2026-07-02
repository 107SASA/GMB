# Module 3: AI Marketing Automation - Architecture

## Overview
This module transitions the application from a manual content generation tool to a fully automated marketing engine. It ensures businesses maintain a 7-day content buffer at all times via asynchronous background workers.

## Component Architecture
- **WeeklyCalendar**: A premium 7-day grid displaying content items grouped by date. Supports inline publishing and scheduling.
- **BufferHealthBar**: Visualizes the active buffer (e.g. 5/7 days covered) using dynamic Framer Motion gradients and color-coded status badges.
- **LowBufferBanner**: An intrusive but elegant warning banner that appears when content drops below a 7-day threshold. Contains a direct manual trigger for Inngest background generation.

## Database Schema
The system leverages:
1. **Post Model**: Augmented with `automationMetadata` to track if the post was created manually or via the cron job.
2. **AutomationLog Model**: Tracks `tenantId`, `businessId`, and workflow statuses (`scheduler`, `ai_generation`, `manual-publish`). Crucial for auditability and resolving background failures.

## Worker Architecture
Powered by Inngest, the architecture uses background queues instead of `node-cron` to avoid unhandled rejections or overlapping executions.
1. `bufferMonitorWorker`: Runs globally at 8 AM. Iterates through active businesses and dispatches individual generation jobs if needed.
2. `processContentJob`: The workhorse. Calls Groq AI, generates missing content, and saves it to MongoDB. Dispatches Twilio WhatsApp alerts if a business drops below 4 days of buffer or if the generation crashes.
