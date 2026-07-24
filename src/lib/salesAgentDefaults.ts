/**
 * Defaults + helpers for the WhatsApp SALES AGENT (platform → lead nurture that
 * fires after a free audit). Client-safe (no server deps) so the super-admin UI
 * and the server both import from here.
 *
 * Everything the agent does is configurable by the super-admin (SalesAgentConfig):
 * enable/disable, the first-touch message, how long after the audit it's sent,
 * a follow-up drip with per-step delays, and the AI persona for live replies.
 */

/** Variables available in every message template. */
export const SALES_TEMPLATE_VARS = [
  '{{name}}',        // lead first name
  '{{business}}',    // business name
  '{{rank}}',        // Google search rank
  '{{profile}}',     // profile completion %
  '{{seo}}',         // SEO score %
  '{{review}}',      // reviews & replies score %
  '{{competitor}}',  // top competitor name
  '{{keywords}}',    // missing keywords (comma list)
  '{{subscribeUrl}}',
  '{{shopUrl}}',
] as const;

export type SalesMessageMode = 'ai' | 'template';

export interface SalesFollowUp {
  /** Hours to wait (since the previous agent message) before sending this. */
  delayHours: number;
  mode: SalesMessageMode;
  template: string;
  aiSystemPrompt?: string;
  /** Only send if the lead hasn't replied since the last agent message. */
  onlyIfNoReply: boolean;
}

export interface SalesAgentConfigShape {
  enabled: boolean;
  firstMessage: {
    mode: SalesMessageMode;
    /** Minutes to wait after the audit completes before the first message. */
    delayMinutes: number;
    template: string;
    aiSystemPrompt: string;
  };
  followUps: SalesFollowUp[];
  /** Persona/instructions for live inbound replies (Phase 2 conversation). */
  agentSystemPrompt: string;
  subscribeUrl: string;
  shopUrl: string;
}

export const DEFAULT_FIRST_TEMPLATE =
`{{name}}, your business is currently at rank {{rank}}. 📉

That's like being on page 3 of Google—most customers never scroll that far.

Here's why your visibility is low:

1. *Profile ({{profile}}%)*: An incomplete profile is like a shop with half a board. Google ranks 100% complete profiles higher.
2. *SEO ({{seo}}%)*: You're missing key words like {{keywords}}. Without these, Google doesn't know what you sell.
3. *Reviews & Replies ({{review}}%)*: No recent activity makes the business look closed. Replying to reviews tells Google you are active.

Want to see how we can fix this and get you ahead of competitors like {{competitor}}?`;

export const DEFAULT_FIRST_AI_PROMPT =
`You are a friendly, sharp WhatsApp sales assistant for GrowwMatics AI, which grows local businesses on Google. You message a lead right after their free Google Business Profile audit. Goal: make them feel the problem and want to fix it with us — never pushy, always helpful.

Write ONE WhatsApp message. Rules:
- Start with the lead's first name.
- State their Google rank with a vivid, simple analogy (e.g. "page 3 of Google — most customers never scroll that far").
- Give EXACTLY 3 numbered reasons visibility is low, tied to the real numbers: Profile %, SEO %, Reviews & Replies %. One short sentence each with a relatable analogy. Name the missing keywords if given.
- End with a warm question offering to fix it and get ahead of a named competitor (if provided).
- WhatsApp formatting: *bold* with single asterisks, a few tasteful emojis. Tight. No markdown headers, no links.`;

export const DEFAULT_AGENT_PROMPT =
`You are the GrowwMatics AI WhatsApp sales assistant, continuing a chat with a local-business owner who just got a free Google audit. Be warm, concise, and genuinely helpful — like a knowledgeable friend, not a pushy salesperson.

Your goal: guide them to subscribe so we can fix their Google visibility (profile, SEO, reviews, ranking) and help them beat competitors.

Guidelines:
- Answer their questions using the audit context you're given (their rank, scores, competitors, missing keywords).
- Handle objections honestly; focus on outcomes (more calls, customers, higher ranking).
- When they show interest, share the subscribe link and offer to help them get started.
- Keep replies short and WhatsApp-friendly (*bold*, a few emojis). One question at a time.
- Never invent data. If unsure, say you'll help them check it in the dashboard.`;

export const DEFAULT_FOLLOWUPS: SalesFollowUp[] = [
  {
    delayHours: 24,
    mode: 'template',
    onlyIfNoReply: true,
    template:
`Hi {{name}} 👋 Just checking in on your {{business}} Google audit. Your profile is at {{profile}}% and rank {{rank}} — a few quick fixes can change that fast.

Want me to show you how? You can also see the full platform here: {{shopUrl}}`,
  },
  {
    delayHours: 72,
    mode: 'template',
    onlyIfNoReply: true,
    template:
`{{name}}, your competitors like {{competitor}} are already using tools like this to stay ahead 🏃

Whenever you're ready, you can get started here: {{subscribeUrl}} — happy to answer any questions!`,
  },
];

export function defaultSalesAgentConfig(subscribeUrl = '', shopUrl = ''): SalesAgentConfigShape {
  return {
    enabled: false,
    firstMessage: {
      mode: 'ai',
      delayMinutes: 2,
      template: DEFAULT_FIRST_TEMPLATE,
      aiSystemPrompt: DEFAULT_FIRST_AI_PROMPT,
    },
    followUps: DEFAULT_FOLLOWUPS,
    agentSystemPrompt: DEFAULT_AGENT_PROMPT,
    subscribeUrl,
    shopUrl,
  };
}

/** Fills {{var}} placeholders. Unknown placeholders are left as-is. */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => {
    const v = vars[key];
    return v === undefined || v === null || v === '' ? m : String(v);
  });
}
