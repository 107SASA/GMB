import Groq from 'groq-sdk';

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
}

export interface GeneratedPost {
  dayLabel: string;
  postType: string;
  title: string;
  body: string;
  cta: string;
  hashtags: string[];
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
}

export async function generateAIContent(request: ContentGenerationRequest): Promise<ContentGenerationResult> {
  const prompt = `
You are an expert AI marketing assistant and copywriter. Generate content for the following business based on the requirements.
Output STRICT JSON matching the schema below. DO NOT wrap the output in markdown code blocks.

BUSINESS DETAILS:
- Name: ${request.businessName}
- Type: ${request.businessType}
- Location: ${request.location}
- Tone: ${request.tone}
- Keywords: ${request.keywords.join(', ')}
- Requested Content Types: ${request.contentTypes.join(', ')}

REQUIRED JSON OUTPUT SCHEMA:
{
  "posts": [
    {
      "dayLabel": "Day 1",
      "postType": "The type of post (e.g. Promotional, Educational, FAQ, Festival)",
      "title": "Catchy title",
      "body": "Main content of the post (1-2 paragraphs)",
      "cta": "Call to action string (e.g. Call Now, Learn More, Visit Website)",
      "hashtags": ["#tag1", "#tag2"]
    }
  ], // Generate EXACTLY 7 posts
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
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7, // Slightly creative
    });

    const content = response.choices[0].message?.content;
    if (!content) {
      throw new Error('No content returned from Groq AI');
    }

    const parsed = JSON.parse(content) as ContentGenerationResult;
    return parsed;
  } catch (error: any) {
    console.error('Error generating AI content:', error);
    throw new Error(`Failed to generate AI content: ${error.message || error}`);
  }
}
