import { Groq } from "groq-sdk";
import { GROQ_MODEL } from "@/lib/aiModel";

export interface ReplyResult {
  reply: string;
  promptTokens: number;
  completionTokens: number;
}

/** Hard rules for every review reply — the evidence gate (services/reviews/validateReply.ts) enforces them. */
export const REPLY_FACT_RULES = `RULES (mandatory):
- Respond to what THIS reviewer actually wrote — mention the specific thing they praised or complained about. No generic paragraph.
- Use ONLY facts from VERIFIED BUSINESS FACTS or from the review itself. If something is not there, do not say it.
- Never invent: services, products, offers, discounts, prices, locations or branches, facilities, guarantees, achievements, awards, ratings, promotions, or anything about the reviewer (who they are, how often they visit, what they bought) beyond what they wrote.
- Never claim a problem was fixed, refunded, replaced or resolved. For a complaint: acknowledge it specifically, apologise where appropriate, and invite them to contact the business directly — do not promise a specific remedy.
- No sales pitch, no "call now / book now", no competitor comparisons, no mention of Google rankings, search or SEO.
- Keywords: you MAY use at most one of the KEYWORDS, once, only if it fits naturally, written as normal English (e.g. "your bathroom renovation in Nashik", never "your bathroom renovation Nashik"). Never repeat a keyword or list several.
- If the review has little or no text, reply with a short, warm thank-you only — no services, keywords or location.
- 2–4 sentences. No placeholders like [Name]. Sign off as "The {business} Team".
- Output ONLY the reply text.`;

export async function generateReviewReply(params: {
  reviewText: string;
  rating: number;
  tone: string;
  businessName: string;
  /** Reviewer's display name when Google provides it. */
  reviewer?: string;
  /** Verified business facts (name, category, location, services, website/GBP excerpts). */
  factsBlock?: string;
  /** SEO plan keywords, labelled measured / proposed. */
  keywords?: string[];
  /** An existing reply on this review (conversation context). */
  previousReply?: string;
  /** Regeneration: the rejected draft and why it was rejected. */
  rejected?: { reply: string; reasons: string[] };
  /** @deprecated kept for callers not yet on the pipeline; ignored when factsBlock is given. */
  uspLine?: string;
  /** @deprecated see uspLine. */
  mustInclude?: string[];
}): Promise<ReplyResult> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const reviewer = params.reviewer && !/^(a google user|anonymous)$/i.test(params.reviewer) ? params.reviewer : null;
  const facts = params.factsBlock ?? [`Business: ${params.businessName}`, params.uspLine ? `Owner-stated differentiator: ${params.uspLine}` : ''].filter(Boolean).join('\n');
  const keywords = params.keywords ?? params.mustInclude ?? [];
  const prompt = `You write replies to Google reviews for "${params.businessName}".

REVIEW (${params.rating}/5)${reviewer ? ` by ${reviewer}` : ''}:
"${params.reviewText || '(no text — rating only)'}"
${params.previousReply ? `\nEXISTING REPLY ON THIS REVIEW (keep consistent, do not repeat it):\n"${params.previousReply}"\n` : ''}
VERIFIED BUSINESS FACTS:
${facts}

KEYWORDS (optional, at most one, only if natural): ${keywords.length ? keywords.join(', ') : '(none)'}

Tone: ${params.tone}.${reviewer ? ` You may greet ${reviewer.split(/\s+/)[0]} by first name.` : ''}

${REPLY_FACT_RULES.replace('{business}', params.businessName)}
${params.rejected ? `\nYOUR PREVIOUS DRAFT WAS REJECTED:\n"${params.rejected.reply}"\nWhy:\n${params.rejected.reasons.map((r) => `- ${r}`).join('\n')}\nWrite a new reply that removes every rejected claim.` : ''}`;

  try {
    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: GROQ_MODEL,
      temperature: params.rejected ? 0.3 : 0.5,
      max_tokens: 700,
    });

    const reply = response.choices[0]?.message?.content?.trim().replace(/^["“]|["”]$/g, '') || '';
    if (!reply) throw new Error('empty reply');
    return {
      reply,
      promptTokens:    response.usage?.prompt_tokens    ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    };
  } catch (error) {
    console.error("Failed to generate AI reply:", error);
    throw new Error("AI Reply Generation failed");
  }
}
