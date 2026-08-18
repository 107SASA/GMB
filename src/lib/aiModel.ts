/**
 * Single source of truth for the Groq chat-completion model used across
 * every AI feature on the platform (audit narrative generation, content
 * generation, review replies, WhatsApp sales/booking/report agents, intent
 * classification, campaign messages).
 *
 * Why this exists: `llama-3.3-70b-versatile` was hardcoded as a literal
 * string separately in 15 files. Groq shut that model down on 2026-08-16
 * (see console.groq.com/docs/deprecations) and broke every one of those
 * features simultaneously in production, with no single place to fix it.
 * `openai/gpt-oss-120b` is Groq's own recommended replacement. Verified live
 * against GET https://api.groq.com/openai/v1/models on 2026-08-18.
 */
export const GROQ_MODEL = 'openai/gpt-oss-120b';
