import Groq from 'groq-sdk';
import { POSTS_PER_WEEK } from '@/lib/contentConfig';
import { GROQ_MODEL } from '@/lib/aiModel';

export { POSTS_PER_WEEK };

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export interface ContentGenerationRequest {
  businessName: string;
  businessType: string;
  location: string;
  tone: string;
  keywords: string[];
  contentTypes: string[];
  topic?: string;
  /** The single differentiator to lead posts with — from the SEO brain
   *  (SeoPlan.uspLine). Optional. */
  usp?: string;
  /** Weekday/theme/keyword plan from the SEO brain (SeoPlan.postThemes).
   *  When present, each post follows one theme in order. Optional. */
  postThemes?: Array<{ weekday: string; theme: string; keyword: string; postType: string }>;
  /** Sep 2026 weekly engine: one brief per post, in order (from the content plan). */
  slotBriefs?: string[];
  /** Verified facts the posts may use — nothing outside this block may be stated as fact. */
  factsBlock?: string;
}

/** Hard rules for every generated post — business facts come ONLY from the facts block. */
export const CONTENT_FACT_RULES = `FACT RULES (mandatory):
- Use ONLY business facts from the VERIFIED FACTS block. If something is not there, do not state it.
- Never invent: services, products, locations, branches, offers, discounts, prices, completed projects, customers, testimonials, ratings, reviews, awards, certifications, credentials, years of experience, guarantees, results, statistics, percentages, contact details.
- Never use superlatives or rank claims: best, #1, number one, top, leading, premier, 5-star, award-winning.
- No reputation claims unless the facts state them: trusted, reliable, expert, experienced, quality workmanship, on time, within budget.
- Work the post's keyword into an ordinary sentence the way a customer would say it. Never append it to the title as a tag, and never mention keywords, searching, search engines or SEO in the post.
- Offers: only the OWNER OFFER text, word for word in meaning — never add a discount, price, date or condition. No offer language in any other post.
- Festivals: only the festival named in that post's brief; a greeting, not an invented promotion.
- Educational tips about the service are fine as general advice, never as claims about this business's results.`;

export interface GeneratedPost {
  dayLabel: string;
  postType: string;
  title: string;
  body: string;
  cta: string;
  hashtags: string[];
  thumbnailPrompt: string;
  /** Set after the post is persisted to MongoDB as a draft. */
  _id?: string;
  /** Set after thumbnail image is generated via NanoBanana. */
  imageUrl?: string;
}

export interface GeneratedFAQ {
  question: string;
  answer: string;
}

export interface ContentGenerationResult {
  posts: GeneratedPost[];
  seoDescription: string;
  faqs: GeneratedFAQ[];
  contentScore: number;
  seoScore: number;
  engagementPrediction: 'High' | 'Medium' | 'Low';
  _usage?: { promptTokens: number; completionTokens: number };
}

export async function generateAIContent(request: ContentGenerationRequest): Promise<ContentGenerationResult> {
  const topicLine = request.topic
    ? `- Campaign Topic: ${request.topic}`
    : '';
  const uspLine = request.usp ? `- Differentiator to lead with (USP): ${request.usp}` : '';
  const briefsLine = request.slotBriefs && request.slotBriefs.length
    ? `- Posts to write (EXACTLY ${request.slotBriefs.length}, in this order):\n${request.slotBriefs.map((b, i) => `    ${i + 1}. ${b}`).join('\n')}`
    : '';
  const themesLine = !briefsLine && request.postThemes && request.postThemes.length
    ? `- Post plan (follow one per post, in order — use the given keyword as that post's primary keyword):\n${request.postThemes
        .map((t, i) => `    ${i + 1}. ${t.weekday} · ${t.postType} — ${t.theme} (keyword: ${t.keyword})`)
        .join('\n')}`
    : '';

  const prompt = `
You are an expert AI marketing assistant and copywriter. Generate content for the following business based on the requirements.
Output STRICT JSON matching the schema below. DO NOT wrap the output in markdown code blocks.

BUSINESS DETAILS:
- Name: ${request.businessName}
- Type: ${request.businessType}
- Location: ${request.location}
- Tone: ${request.tone}
- Keywords: ${request.keywords.join(', ')}
${uspLine}
${themesLine}
${briefsLine}
${topicLine}
${request.factsBlock ? `
VERIFIED FACTS:
${request.factsBlock}
` : ''}
${CONTENT_FACT_RULES}
- Requested Content Types: ${request.contentTypes.join(', ')}

KEYWORD RULES: each post targets ONE primary keyword (plus optionally one locality word). Do not stuff multiple keywords into a post. Lead the copy with the USP when one is given.

REQUIRED JSON OUTPUT SCHEMA:
{
  "posts": [
    {
      "dayLabel": "Day 1",
      "postType": "The type of post (e.g. Promotional, Educational, FAQ, Festival)",
      "title": "Catchy title",
      "body": "Main content of the post (1-2 paragraphs)",
      "cta": "Call to action string (e.g. Call Now, Learn More, Visit Website)",
      "hashtags": ["#tag1", "#tag2"],
      "thumbnailPrompt": "A detailed English image generation prompt for a professional social media thumbnail that visually represents this post's topic. Include style (e.g. photorealistic, flat design), mood, colors, and subject. Keep it under 100 words."
    }
  ], // Generate EXACTLY ${request.slotBriefs?.length || POSTS_PER_WEEK} posts${request.topic ? `. All posts must revolve around the campaign topic: "${request.topic}"` : ''}
  "seoDescription": "SEO optimized description (max 750 characters) targeting the location and keywords.",
  "faqs": [
    {
      "question": "Question string",
      "answer": "Answer string"
    }
  ], // Generate EXACTLY 5 FAQs
  "contentScore": 80, // Number 0-100 indicating quality
  "seoScore": 85, // Number 0-100 indicating SEO strength
  "engagementPrediction": "High" // "High", "Medium", or "Low"
}
`;

  try {
    const { withGroqRetry } = await import('@/lib/groqRetry');
    const response: any = await withGroqRetry(() => groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      // Lower when writing from verified briefs — less room to embellish.
      temperature: request.slotBriefs?.length ? 0.4 : 0.7,
    }), { reason: 'content_batch' });

    const content = response.choices[0].message?.content;
    if (!content) {
      throw new Error('No content returned from Groq AI');
    }

    const parsed = JSON.parse(content) as ContentGenerationResult;
    parsed._usage = {
      promptTokens:    response.usage?.prompt_tokens    ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    };
    return parsed;
  } catch (error: any) {
    console.error('Error generating AI content:', error);
    throw new Error(`Failed to generate AI content: ${error.message || error}`);
  }
}

/**
 * Rewrite ONE post that failed the evidence gate, with the reasons it failed.
 * Returns null on any failure (the caller then saves a safe DRAFT).
 */
export async function regenerateSinglePost(input: { brief: string; factsBlock: string; rejected: { title: string; body: string }; reasons: string[]; tone?: string }): Promise<{ title: string; body: string; cta: string; hashtags: string[]; thumbnailPrompt: string } | null> {
  const prompt = `Rewrite this Google Business Profile post so it passes the fact check. Output strict JSON: {"title": "...", "body": "...", "cta": "...", "hashtags": ["#..."], "thumbnailPrompt": "..."}.

POST BRIEF: ${input.brief}
VERIFIED FACTS:
${input.factsBlock}

${CONTENT_FACT_RULES}

REJECTED DRAFT:
Title: ${input.rejected.title}
Body: ${input.rejected.body}

WHY IT WAS REJECTED:
${input.reasons.map((r) => `- ${r}`).join('\n')}

Tone: ${input.tone || 'Professional'}. Remove every rejected claim rather than rephrasing it.`;
  try {
    const { withGroqRetry } = await import('@/lib/groqRetry');
    const res: any = await withGroqRetry(() => groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }), { reason: 'content_regenerate' });
    const j = JSON.parse(res.choices[0]?.message?.content || '{}');
    if (!j.title || !j.body) return null;
    return { title: String(j.title), body: String(j.body), cta: String(j.cta || 'Learn more'), hashtags: Array.isArray(j.hashtags) ? j.hashtags.map(String) : [], thumbnailPrompt: String(j.thumbnailPrompt || '') };
  } catch (err: any) {
    console.warn('[contentEngine] regeneration failed:', err?.message);
    return null;
  }
}
