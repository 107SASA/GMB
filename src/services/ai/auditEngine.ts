import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function generateAIAudit(
  businessData: any
): Promise<any> {

  const prompt = `
You are an elite Enterprise Business Intelligence Engine & Local SEO strategist.

Your job is strictly to ANALYZE the explicit FACTS provided below. DO NOT invent competitors, DO NOT invent rankings, DO NOT invent metrics. DO NOT hallucinate Priority Fixes outside of the specific gaps identified.

FACTS:
BUSINESS NAME: ${businessData.businessName}
CATEGORY: ${businessData.category}
TIER: ${businessData.tier || 'Unknown'}
LOCATION: ${businessData.area || ''}, ${businessData.city || ''}, ${businessData.state || ''}
WEBSITE: ${businessData.website || 'Missing'}
DESCRIPTION: ${businessData.description || 'Missing'}

NATIVE ANALYTICS (Do not modify these numbers, only analyze them):
Profile Completion Score: ${businessData.nativeAnalytics?.profileCompletion?.completionPercentage || 0}%
Review Count: ${businessData.nativeAnalytics?.reviewMetrics?.reviewCount || 0}
Average Rating: ${businessData.nativeAnalytics?.reviewMetrics?.averageRating || 0}

COMPETITOR INTELLIGENCE:
${businessData.competitors && businessData.competitors.length > 0 ? JSON.stringify(businessData.competitors) : 'No suitable competitors found.'}

IDENTIFIED NATIVE PRIORITY FIXES (You MUST base your Priority Fixes entirely on this list):
${JSON.stringify(businessData.nativeAnalytics?.priorityFixes || [])}

BUSINESS INTELLIGENCE GAPS:
${JSON.stringify(businessData.nativeAnalytics?.businessIntelligence || {})}

TASK:
Based strictly on the facts above, generate the missing analytical sections of the audit report.

REQUIRED JSON FORMAT:
{
  "profileScore": {
    "overallScore": 0,
    "seoScore": ${businessData.nativeAnalytics?.seoScore?.score || 0},
    "reviewScore": 0,
    "profileCompletionScore": ${businessData.nativeAnalytics?.profileCompletion?.completionPercentage || 0},
    "ratingScore": 0,
    "contentScore": 0
  },
  "keywordGapAnalysis": [
    {
      "keyword": "example missing keyword",
      "found": false,
      "missing": true,
      "priority": "High"
    }
  ],
  "reviewAnalysis": {
    "positivePercent": 0,
    "neutralPercent": 0,
    "negativePercent": 0,
    "mostCommonPraises": [],
    "mostCommonComplaints": []
  },
  "strengths": [
    {
      "title": "Example Strength",
      "observation": "What data point proves this?",
      "evidence": "Actual metric (e.g. 50 reviews)",
      "impact": "Business impact"
    }
  ],
  "weaknesses": [
    {
      "title": "Example Weakness",
      "observation": "What data point proves this gap?",
      "evidence": "Actual metric (e.g. 0 reviews vs avg 50)",
      "risk": "Business risk"
    }
  ],
  "priorityFixes": [
    {
      "title": "Exact Title From IDENTIFIED NATIVE PRIORITY FIXES",
      "reason": "Exact Reason From IDENTIFIED NATIVE PRIORITY FIXES",
      "impact": "High",
      "effort": "Low",
      "expectedScoreGain": "+15 points",
      "revenuePotential": "High"
    }
  ],
  "thirtyDayPlan": [
    { "week": "Week 1", "tasks": ["Task 1", "Task 2"], "expectedOutcome": "Outcome" },
    { "week": "Week 2", "tasks": [], "expectedOutcome": "Outcome" },
    { "week": "Week 3", "tasks": [], "expectedOutcome": "Outcome" },
    { "week": "Week 4", "tasks": [], "expectedOutcome": "Outcome" }
  ],
  "ninetyDayPlan": [
    { "month": "Month 1", "tasks": [], "focusAreas": ["SEO", "Reviews"] },
    { "month": "Month 2", "tasks": [], "focusAreas": [] },
    { "month": "Month 3", "tasks": [], "focusAreas": [] }
  ]
}

RULES:
1. "strengths" MUST be generated from actual data (e.g., if Profile Score is 90%, make that a strength, list the evidence).
2. "weaknesses" MUST be generated from actual gaps (e.g., use the Competitor Intelligence to find Review Gaps).
3. Do NOT generate "Data Unavailable". Always provide minimum 3 strengths and 3 weaknesses.
4. "priorityFixes" MUST perfectly match the items listed in IDENTIFIED NATIVE PRIORITY FIXES. Do not invent new fixes. Just add the Impact/Effort/expectedScoreGain scoring.
5. "thirtyDayPlan" MUST specifically address the exact data gaps identified in "priorityFixes".
6. "ninetyDayPlan" MUST build on the thirtyDayPlan and be tailored to the exact tier and review volume of this business. Do not hallucinate generic advice.
7. EVERYTHING MUST BE STRICTLY DATA-DRIVEN. NO ESTIMATED OR FAKE SCORES.
`;

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });

    const content = response.choices[0].message?.content;
    if (!content) throw new Error('No content returned from Groq AI');

    const jsonMatch = content.match(/```(?:json)?\n([\s\S]*?)\n```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    const parsed = JSON.parse(jsonStr.trim());
    return parsed;
  } catch (error: any) {
    console.error('Error generating AI audit:', error);
    throw new Error(`Failed to generate AI audit: ${error.message || error}`);
  }
}
