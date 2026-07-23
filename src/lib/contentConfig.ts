/**
 * Shared content-generation config, safe to import from BOTH client and server
 * (no server-only deps like the Groq SDK). Keep values here that the UI and the
 * generator must agree on.
 */

/**
 * Posts produced per weekly content generation. Reduced from 7 → 4: a 7-post
 * batch (and its 7 background thumbnails) was slow and heavy; 4/week is the
 * cadence we generate and schedule.
 */
export const POSTS_PER_WEEK = 4;
