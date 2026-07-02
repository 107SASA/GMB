import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export interface GenerateContentRequest {
  business_name: string;
  business_type: string;
  location: string;
  keywords: string[];
  tone: string;
  content_type: string;
  previous_posts?: string[];
}

export interface AIContentResponse {
  title: string;
  content: string;
  hashtags: string[];
  cta: string;
  seo_score: number;
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  gmb_post: 'Google Business Profile post',
  seo_description: 'SEO-optimized business description',
  faq: 'Frequently Asked Questions (FAQ) section',
  promotional: 'promotional offer post',
  educational: 'educational tip or how-it-works post',
};

const TONE_LABELS: Record<string, string> = {
  professional: 'professional and polished',
  friendly: 'warm and approachable',
  casual: 'relaxed and conversational',
  authoritative: 'confident and expert',
  enthusiastic: 'energetic and exciting',
};

function buildPrompt(data: GenerateContentRequest): string {
  const contentLabel = CONTENT_TYPE_LABELS[data.content_type] || data.content_type;
  const toneLabel = TONE_LABELS[data.tone] || data.tone;
  const keywordList = data.keywords.join(', ');

  return `You are an expert local SEO content writer specializing in Google Business Profile optimization.
Create a ${contentLabel} for the following local business.

Business Details:
- Business Name: ${data.business_name}
- Business Type: ${data.business_type}
- Location: ${data.location}
- Target Keywords: ${keywordList}
- Writing Tone: ${toneLabel}

${data.previous_posts && data.previous_posts.length > 0 ? `To ensure variety, DO NOT repeat the following recent posts:\n- ${data.previous_posts.join('\n- ')}\n` : ''}

Content Requirements:
- Write in a ${toneLabel} tone
- Naturally incorporate the target keywords for local SEO
- Include the business location to boost local search visibility
- Write like a real human, not a robot — avoid clichés and generic phrases
- Make it compelling, engaging, and conversion-focused
- Include a clear, persuasive call-to-action
- Keep it concise but impactful

${data.content_type === 'faq' ? 'Generate 3-5 relevant Q&A pairs in a clear format.' : ''}
${data.content_type === 'seo_description' ? 'Write 150-300 words optimized for Google Business Profile description.' : ''}
${data.content_type === 'gmb_post' ? 'Write 100-200 words suitable for a GMB post update.' : ''}
${data.content_type === 'promotional' ? 'Write a promotional post highlighting a special offer or service (100-200 words).' : ''}
${data.content_type === 'educational' ? 'Write an educational tip that showcases expertise (100-200 words).' : ''}

You MUST respond with ONLY a valid JSON object. No markdown, no code fences, no explanation — just raw JSON:
{
  "title": "Attention-grabbing title for the content",
  "content": "The full content text here",
  "hashtags": ["relevant", "local", "hashtags"],
  "cta": "A compelling call-to-action phrase",
  "seo_score": 85
}`;
}

function sanitizeInput(input: string): string {
  return input
    .replace(/ignore previous instructions/gi, '')
    .replace(/system prompt/gi, '')
    .replace(/\bact as\b/gi, '')
    .replace(/\bpretend\b/gi, '')
    .trim()
    .slice(0, 200);
}

export async function generateStructuredContent(data: GenerateContentRequest): Promise<AIContentResponse> {
  const sanitized: GenerateContentRequest = {
    ...data,
    business_name: sanitizeInput(data.business_name),
    business_type: sanitizeInput(data.business_type),
    location: sanitizeInput(data.location),
    keywords: data.keywords.map((k) => sanitizeInput(k)).filter(Boolean),
  };

  const prompt = buildPrompt(sanitized);

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content:
          'You are a local SEO expert and content writer. Always respond with valid JSON only. Never include markdown code fences, backticks, or any explanation outside the JSON object.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error('No response from AI service.');

  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: AIContentResponse;
  try {
    parsed = JSON.parse(cleaned) as AIContentResponse;
  } catch {
    throw new Error('AI returned invalid JSON. Please try again.');
  }

  if (!parsed.title || !parsed.content || !parsed.cta) {
    throw new Error('AI returned incomplete content. Please try again.');
  }

  parsed.seo_score = Math.min(100, Math.max(0, Number(parsed.seo_score) || 70));
  parsed.hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 10) : [];

  return parsed;
}
