import { Groq } from "groq-sdk";

export async function generateReviewReply(params: {
  reviewText: string;
  rating: number;
  tone: string;
  businessName: string;
}): Promise<string> {
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });

  const prompt = `You are an expert Public Relations and Reputation Management AI for "${params.businessName}".
A customer left a ${params.rating}-star review.
Review text: "${params.reviewText}"

Your task: Generate a direct, human-sounding response to this review.
Tone requested: ${params.tone}.

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
      model: "llama-3.3-70b-versatile",
      temperature: 0.6,
      max_tokens: 150,
    });

    return response.choices[0]?.message?.content?.trim() || "Thank you for your feedback.";
  } catch (error) {
    console.error("Failed to generate AI reply:", error);
    throw new Error("AI Reply Generation failed");
  }
}
