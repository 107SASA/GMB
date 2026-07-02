import Groq from "groq-sdk";

let groq: Groq | null = null;

function getGroq() {
  if (!groq) {
    if (!process.env.GROQ_API_KEY) {
      console.warn("GROQ_API_KEY is missing. AI analysis will fail.");
    }
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY || "",
    });
  }
  return groq;
}

export interface AIAnalysisResult {
  sentiment: string;
  insights: string;
  seoRecommendations: string[];
  keywords: string[];
  prioritizedActions: Array<{
    title: string;
    description: string;
    priority: "High" | "Medium" | "Low";
    impact: "High" | "Medium" | "Low";
    difficulty: "Easy" | "Medium" | "Hard";
  }>;
  summary: string;
}

export async function analyzeBusinessData(
  businessInfo: any,
  reviews: any[]
): Promise<AIAnalysisResult> {
  const reviewsText = reviews.slice(0, 10).map((r: any) => r.text || r.snippet).join("\n---\n");

  const prompt = `
    Analyze the following Google Business Profile data and reviews.
    Business: ${JSON.stringify(businessInfo)}
    Reviews: ${reviewsText}

    Generate a comprehensive audit report in JSON format with the exact following keys:
    1. "sentiment": A summary of customer sentiment (Positive, Neutral, Negative).
    2. "insights": Key takeaways from reviews.
    3. "seoRecommendations": 5 actionable SEO tips for the description and category.
    4. "keywords": 10 relevant keywords to include in posts and description.
    5. "prioritizedActions": An array of 4-6 objects with {title, description, priority, impact, difficulty}.
    6. "summary": A 2-sentence executive summary.

    Ensure the response is strictly JSON. No markdown or extra text.
  `;

  try {
    const response = await getGroq().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("Groq failed to generate a response");

    return JSON.parse(content) as AIAnalysisResult;
  } catch (error: any) {
    console.error("Error running AI analysis via Groq:", error.message);
    throw error;
  }
}
