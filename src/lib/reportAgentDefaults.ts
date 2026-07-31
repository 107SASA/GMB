/**
 * Defaults + helpers for the WhatsApp REPORT AGENT ("D3" — platform → prospect
 * free GBP report delivery). GrowwMatics-owned, owner-only line, same as the
 * booking (D1) and sales (D2) agents. A visitor taps "boost my Google
 * profile", the agent hands them a link to connect their real Google Business
 * Profile, and once connected delivers a report-card image + personalized
 * summary. Client-safe (no server deps) so the super-admin UI and the server
 * both import from here — mirrors src/lib/bookingAgentDefaults.ts.
 */

export const REPORT_AGENT_BRAND_NAME = 'GrowwMatics AI';

/** Variables available in the report-intro template (sent immediately). */
export const REPORT_INTRO_TEMPLATE_VARS = ['{{link}}'] as const;

/** Variables available in the report-summary template (sent after the image). */
export const REPORT_SUMMARY_TEMPLATE_VARS = [
  '{{name}}', '{{business}}', '{{rank}}', '{{profile}}', '{{seo}}', '{{review}}', '{{dashboardLink}}',
] as const;

export interface ReportAgentConfigShape {
  enabled: boolean;
  /** Persona/tone for pre-connection chat replies (objections, questions). */
  agentSystemPrompt: string;
  /** Sent immediately when a new report thread starts. Supports {{link}}. */
  reportIntroTemplate: string;
  /** Sent right after the report-card image. Supports the score vars above. */
  reportSummaryTemplate: string;
}

export const DEFAULT_REPORT_AGENT_PROMPT =
`You are the friendly WhatsApp assistant for ${REPORT_AGENT_BRAND_NAME}, helping a prospect get a free report on their Google Business Profile.

They have already been sent a link to connect their Google account — your only job right now is to answer any questions or hesitation they have (e.g. "is this safe?", "why do you need this?", "how long does it take?") warmly and briefly, and remind them to tap the link if they haven't yet.

Style:
- Warm, concise, human. WhatsApp formatting: *bold* with single asterisks, a few tasteful emojis.
- Never invent scores or data you don't have — the report itself isn't ready until they connect.
- Reassure: connecting is free, takes under a minute, and only reads their public Business Profile data.`;

export const DEFAULT_REPORT_INTRO =
`Hi! 👋 I'm the ${REPORT_AGENT_BRAND_NAME} assistant. I can't help until you connect the right Google account — tap below and select the account with your Business Profile:

{{link}}

Takes under a minute. Once connected, I'll generate your free report right here. 🚀`;

export const DEFAULT_REPORT_SUMMARY =
`Great news, {{name}} — I found *{{business}}*! 📊

Here's where you stand:
• Google Search Rank: *{{rank}}*
• Profile Completion: *{{profile}}%*
• SEO Score: *{{seo}}%*
• Review Score: *{{review}}%*

Want to save this report and start fixing the gaps? Set up your free dashboard here: {{dashboardLink}}`;

export function defaultReportAgentConfig(): ReportAgentConfigShape {
  return {
    enabled: false,
    agentSystemPrompt: DEFAULT_REPORT_AGENT_PROMPT,
    reportIntroTemplate: DEFAULT_REPORT_INTRO,
    reportSummaryTemplate: DEFAULT_REPORT_SUMMARY,
  };
}

/** Fills {{var}} placeholders. Unknown placeholders are left as-is. */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => {
    const v = vars[key];
    return v === undefined || v === null || v === '' ? m : String(v);
  });
}
