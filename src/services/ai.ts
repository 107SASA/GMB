import Groq from "groq-sdk";
import { ILead } from "@/models/Lead";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export async function generateSalesResponse(history: Message[], lead: ILead): Promise<string> {
  const currentDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const systemPrompt: Message = {
    role: 'system',
    content: `You are a professional AI sales assistant and Lead Conversion Agent for a business automation platform.
Today's date is ${currentDate}.

Your responsibilities:
- Talk naturally with users and maintain conversational context.
- Understand customer requirements and subtly extract business information.
- Qualify leads gradually (do not interrogate). Ask ONE meaningful question at a time.
- You MUST get their real name before moving forward — keep asking until they give it.
- Detect buying intent and assist with bookings/demo scheduling if they show high interest.
- Keep responses short, concise, and natural (1-3 brief paragraphs max).
- ONLY offer booking or callback when customer clearly shows they want to visit or need a call.
- If customer asks for booking themselves, ask for preferred date and time.

Current Lead context:
- Name: ${lead.name !== lead.phone ? lead.name : "Not provided yet"}
- Status: ${lead.qualificationStatus || lead.status}
- Known Info: Business (${lead.businessType || 'unknown'}), Budget (${lead.budget || 'unknown'}), Urgency (${lead.urgency || 'unknown'})
- Interest: ${lead.interest || 'unknown'}

Rules:
- NO random emojis. NO media generation.
- NEVER repeat fallback messages continuously.
- Avoid robotic, scripted conversations.
- NEVER add LEAD_CAPTURED tag if you don't have the person's real name.
- NEVER add BOOKING_CONFIRMED tag for a past date.

IMPORTANT TAGS - add at the end of reply when conditions are met:

As soon as you receive the customer's real name (even before interest is known):
NAME_RECEIVED::name=<name>

When you have collected BOTH real name AND interest:
LEAD_CAPTURED::name=<name>||interest=<interest>

When customer updates or clarifies their interest and lead already exists:
INTEREST_UPDATED::interest=<interest>

When user confirms a booking with a FUTURE date and time only:
BOOKING_CONFIRMED::name=<name>||date=<date>||time=<time>

When user asks for a call, asks to speak to someone, or seems frustrated:
HUMAN_HANDOFF

Only add ONE tag per reply, at the very end, nothing after it.`
  };

  const messages = [systemPrompt, ...history.map(msg => ({ role: msg.role, content: msg.content }))] as any;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 300,
    });

    let content = chatCompletion.choices[0]?.message?.content || "";
    
    // AI Response Sanitization
    content = content.replace(/\*\*/g, '');
    content = content.replace(/\*/g, '');
    content = content.replace(/!\[.*?\]\(.*?\)/g, '');
    content = content.trim().replace(/\n{3,}/g, '\n\n');

    if (!content) {
      return "Sorry, I’m facing a temporary issue right now. Please try again in a moment.";
    }

    return content;
  } catch (error) {
    console.error("Error generating AI response:", error);
    return "Sorry, I’m facing a temporary issue right now. Please try again in a moment.";
  }
}

export async function extractLeadInsights(history: Message[], currentInsights: any = {}): Promise<any> {
  const systemPrompt: Message = {
    role: 'system',
    content: `You are an AI data extraction engine.
Analyze the following conversation between a user and an AI sales assistant.
Extract or update the following business information based strictly on the user's messages.
If information is not explicitly mentioned, retain the current value or output null.

Output ONLY valid JSON matching this schema:
{
  "businessType": string | null,
  "budget": string | null,
  "urgency": string | null,
  "requirements": string | null,
  "intentScore": number (0-100),
  "qualificationStatus": "Unqualified" | "Qualified" | "Sales Ready"
}

Scoring rules:
- Mentions budget -> +15 intent
- Urgent -> +20 intent
- Asks for pricing/demo -> +25 intent
- Negative response -> decrease intent

Current Insights: ${JSON.stringify(currentInsights)}
`
  };

  const messages = [
    systemPrompt, 
    { role: 'user', content: JSON.stringify(history.map(h => ({ role: h.role, text: h.content }))) }
  ] as any;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.1, // Strict factual extraction
      response_format: { type: 'json_object' }
    });

    const output = chatCompletion.choices[0]?.message?.content || "{}";
    const insights = JSON.parse(output);
    return insights;
  } catch (error) {
    console.error("Error extracting AI insights:", error);
    return null;
  }
}

const postTypes = [
  "PROMOTIONAL",
  "EDUCATIONAL",
  "TIPS",
  "FAQ",
  "OFFER",
  "MOTIVATIONAL",
  "LOCAL_SEO"
];

function getRandomPostType() {
  return postTypes[Math.floor(Math.random() * postTypes.length)];
}

export async function generatePost(businessData: any) {
  try {
    const postType = getRandomPostType();
    const prompt = `
You are an expert local business marketing strategist.

Generate ONE unique Google Business Profile style post.

BUSINESS DETAILS:
Business Name: ${businessData.name || businessData.businessName}
Business Type: ${businessData.category || businessData.businessType}
City: ${businessData.city || businessData.address}
Services: ${businessData.services || 'General'}
Offers: ${businessData.offers || 'None'}
Tone: ${businessData.tone || 'professional'}
Phone: ${businessData.phone || ''}
Website: ${businessData.website || ''}

POST TYPE:
${postType}

IMPORTANT RULES:
1. Keep post between 80-150 words
2. Make content engaging and human-like
3. Add strong CTA
4. Include city name naturally for local SEO
5. Avoid repetitive wording
6. Do NOT use placeholders like [insert phone]
7. Do NOT generate very long paragraphs
8. Add 3-5 relevant hashtags
9. Make content suitable for Google Business Profile
10. Make every post different from previous ones

EXAMPLES OF POST TYPES:
- PROMOTIONAL → promote services
- EDUCATIONAL → give useful advice
- TIPS → quick tips
- FAQ → answer customer questions
- OFFER → promote offers
- MOTIVATIONAL → inspiring customer-focused content
- LOCAL_SEO → location-based visibility content

Generate high-quality content now.
`;

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are a professional local SEO and social media marketing expert."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.9,
      max_tokens: 300,
    });

    return response.choices[0]?.message?.content || null;
  } catch (err: any) {
    console.error("Groq Error:", err.message);
    return null;
  }
}

export async function generateReviewSuggestions(businessName: string, customerName: string, service: string, rating: number = 5): Promise<any[]> {
  try {
    const prompt = `You are helping a customer write a genuine Google review for a business.

Business: ${businessName || 'the business'}
Customer name: ${customerName || 'a customer'}
Service received: ${service || 'general service'}
Desired star rating: ${rating} out of 5

Generate exactly 3 short, natural, authentic-sounding Google review drafts that the customer can edit and post.
Each review should:
- Sound like a real person wrote it (not AI)
- Be 20-40 words
- Mention the service if provided
- Match the star rating in tone
- Be unique in phrasing

Return a JSON array like:
[
  { "rating": 5, "text": "..." },
  { "rating": 5, "text": "..." },
  { "rating": 4, "text": "..." }
]
Return ONLY the JSON array, no other text.`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 400,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "[]";
    const json = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(json);
  } catch (err) {
    console.error("Error generating review suggestions:", err);
    return [];
  }
}

export async function personalizeReviewMessage(businessName: string, customerName: string, service: string, channel: string = 'whatsapp'): Promise<string | null> {
  try {
    const prompt = `Write a short, friendly ${channel} message to ${customerName || 'the customer'} asking them to leave a Google review for ${businessName || 'our business'} after their ${service || 'recent visit'}.

Rules:
- Warm and personal, not salesy
- Under 60 words
- Include a placeholder {{review_link}} where the link goes
- Use 1-2 emojis max
- Do NOT include subject lines
Return only the message text.`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 150,
    });

    return completion.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error("Error personalizing message:", err);
    return null;
  }
}

export async function generateAIReply(reviewText: string, rating: number, reviewerName: string, tone: string = 'Professional'): Promise<string> {
  try {
    const prompt = `You are a professional customer service representative for a business.
Generate a polite, empathetic and professional reply to the following customer review.

Reviewer: ${reviewerName}
Rating: ${rating}/5
Review: ${reviewText || 'No text provided'}
Tone: ${tone}

Guidelines:
- Keep the reply under 80 words
- Be professional and friendly
- Address the specific points mentioned
- If rating is low (1-3), apologize and offer to improve
- If rating is high (4-5), thank them warmly
- Do not use generic, robotic responses
- Tone specific instructions:
  - Professional: Formal, polite, and brand-safe.
  - Friendly: Warm, engaging, use 1-2 emojis.
  - Apology: Empathetic, sincere, focused on resolving the issue.

Reply:`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 150,
    });

    return completion.choices[0]?.message?.content?.trim() || `Thank you for your feedback, ${reviewerName}. We truly value your thoughts and will use them to improve our services.`;
  } catch (error) {
    console.error('AI Reply generation error', error);
    return `Thank you for your feedback, ${reviewerName}. We truly value your thoughts and will use them to improve our services.`;
  }
}

export async function analyzeSentiment(reviewText: string, rating: number): Promise<string> {
  if (!reviewText) {
    return rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';
  }
  try {
    const prompt = `Analyze the sentiment of this customer review:
"${reviewText}"
Rating: ${rating}/5

Categorize the sentiment as EXACTLY ONE of the following words:
positive
neutral
negative
critical

(If it's extremely angry, threatening, or claims food poisoning/scam, label it "critical").
Return ONLY the category word.`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 10,
    });

    const sentiment = completion.choices[0]?.message?.content?.trim().toLowerCase() || 'neutral';
    if (['positive', 'neutral', 'negative', 'critical'].includes(sentiment)) {
      return sentiment;
    }
    return rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';
  } catch (error) {
    console.error('Sentiment analysis error', error);
    return rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';
  }
}
