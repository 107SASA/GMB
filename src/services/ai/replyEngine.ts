import { Groq } from "groq-sdk";
import { GROQ_MODEL } from "@/lib/aiModel";

export interface ReplyResult {
  reply: string;
  promptTokens: number;
  completionTokens: number;
}

export async function generateReviewReply(params: {
  reviewText: string;
  rating: number;
  tone: string;
  businessName: string;
  /** SeoPlan.uspLine — the differentiator to weave in naturally. Optional. */
  uspLine?: string;
  /** SeoPlan.reviewReplyMustInclude — short phrases (city, a service word,
   *  the USP theme) to try to include when it reads naturally. Optional. */
  mustInclude?: string[];
}): Promise<ReplyResult> {
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });

  const uspLine = params.uspLine ? `\nBusiness USP (weave in naturally when it fits): ${params.uspLine}` : '';
  const mustLine = params.mustInclude && params.mustInclude.length
    ? `\nTry to include these where it reads naturally (never force all of them): ${params.mustInclude.join(', ')}`
    : '';

  const prompt = `You are an expert Public Relations and Reputation Management AI for "${params.businessName}".
A customer left a ${params.rating}-star review.
Review text: "${params.reviewText}"

Your task: Generate a direct, human-sounding response to this review.
Tone requested: ${params.tone}.${uspLine}${mustLine}

Guidelines:
1. Do not use generic corporate jargon (e.g., "We are sorry for the inconvenience").
2. Be concise (2-4 sentences).
3. If it is a negative review, acknowledge the issue specifically and offer a path to resolution.
4. If it is a positive review, show genuine gratitude.
5. Do NOT include placeholders like [Your Name]. Sign off as "The ${params.businessName} Team".
6. Output ONLY the response text. No markdown, no quotes around the output, no intro text.`;

  try {
    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: GROQ_MODEL,
      temperature: 0.6,
      max_tokens: 250,
    });

    const reply = response.choices[0]?.message?.content?.trim() || "Thank you for your feedback.";
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
