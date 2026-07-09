import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface AuditEngineOptions {
  /** Feature 2B — Improvement Plan Duration selector (30 / 45 / 90 days). */
  actionPlanDurationDays?: 30 | 45 | 90;
}

/**
 * Per-duration instructions for the action plan (Feature 2B). Each bucket
 * produces a genuinely different plan — different cadence, different
 * number of periods, and a different strategic focus — not just a
 * relabeled heading on the same content.
 */
const ACTION_PLAN_SPECS: Record<30 | 45 | 90, {
  label: string;
  cadenceNoun: string;
  periodCount: number;
  periodLabels: string[];
  focus: string;
  extendedLabel: string;
  extendedFocus: string;
}> = {
  30: {
    label: '30-Day Action Plan',
    cadenceNoun: 'week',
    periodCount: 4,
    periodLabels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    focus:
      'Prioritize ONLY the highest-impact, lowest-effort fixes and quick wins that can realistically be completed by one person in a single week each. Every task must be concrete and achievable within 7 days — no multi-week initiatives.',
    extendedLabel: 'Beyond 30 Days — Ongoing Roadmap',
    extendedFocus:
      'Summarize, at a high level, what should happen after the 30-day sprint to keep building toward full optimization (do not repeat the 30-day tasks).',
  },
  45: {
    label: '45-Day Action Plan',
    cadenceNoun: 'phase',
    periodCount: 3,
    periodLabels: ['Days 1-15', 'Days 16-30', 'Days 31-45'],
    focus:
      'Focus on MEDIUM-TERM improvements: reputation building (review generation & response cadence), content strategy (posting cadence, GBP content), and citation/NAP consistency improvements. These are initiatives that need 2+ weeks to show results, not one-day quick wins.',
    extendedLabel: 'Beyond 45 Days — Ongoing Roadmap',
    extendedFocus:
      'Summarize what should happen after day 45 to sustain the reputation and content gains and move toward full authority building.',
  },
  90: {
    label: '90-Day Roadmap',
    cadenceNoun: 'month',
    periodCount: 3,
    periodLabels: ['Month 1', 'Month 2', 'Month 3'],
    focus:
      'Build a COMPLETE optimization roadmap: authority building (backlinks/citations at scale), long-term reputation strategy, a sustained posting schedule, and structural profile growth. Each month should build on the last toward category-leading authority.',
    extendedLabel: 'Beyond 90 Days — Ongoing Roadmap',
    extendedFocus:
      'Summarize the ongoing maintenance cadence (posting, review responses, ranking checks) needed to sustain the gains after the 90-day roadmap ends.',
  },
};

export async function generateAIAudit(
  businessData: any,
  options: AuditEngineOptions = {}
): Promise<any> {

  const durationDays = options.actionPlanDurationDays ?? 30;
  const planSpec = ACTION_PLAN_SPECS[durationDays];

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
${planSpec.periodLabels.map(p => `    { "week": "${p}", "tasks": ["Task 1", "Task 2"], "expectedOutcome": "Outcome" }`).join(',\n')}
  ],
  "ninetyDayPlan": [
    { "month": "${planSpec.extendedLabel}", "tasks": [], "focusAreas": ["SEO", "Reviews"] }
  ],
  "actionPlan": {
    "durationDays": ${durationDays},
    "planLabel": "${planSpec.label}",
    "extendedLabel": "${planSpec.extendedLabel}"
  }
}

TASK — IMPROVEMENT PLAN (Feature: user selected a "${planSpec.label}" duration):
Generate "thirtyDayPlan" as exactly ${planSpec.periodCount} items, one per period listed below (use these EXACT period labels as the "week" value, in this order): ${JSON.stringify(planSpec.periodLabels)}.
Plan focus for this duration: ${planSpec.focus}
Generate "ninetyDayPlan" as exactly ONE item titled "${planSpec.extendedLabel}" representing what comes AFTER this plan: ${planSpec.extendedFocus}

RULES:
1. "strengths" MUST be generated from actual data (e.g., if Profile Score is 90%, make that a strength, list the evidence).
2. "weaknesses" MUST be generated from actual gaps (e.g., use the Competitor Intelligence to find Review Gaps).
3. Do NOT generate "Data Unavailable". Always provide minimum 3 strengths and 3 weaknesses.
4. "priorityFixes" MUST perfectly match the items listed in IDENTIFIED NATIVE PRIORITY FIXES. Do not invent new fixes. Just add the Impact/Effort/expectedScoreGain scoring.
5. "thirtyDayPlan" MUST specifically address the exact data gaps identified in "priorityFixes", respecting the duration-specific focus above. Tasks in a ${planSpec.cadenceNoun}-based plan must be realistic to complete within that ${planSpec.cadenceNoun}.
6. "ninetyDayPlan" (the single "beyond the plan" item) MUST build on "thirtyDayPlan" and be tailored to the exact tier and review volume of this business. Do not hallucinate generic advice.
7. The ${planSpec.periodCount} periods in "thirtyDayPlan" MUST be genuinely different from each other in substance (not the same tasks reworded) and MUST clearly differ from what a different duration selection would produce — do not fall back to generic, duration-agnostic advice.
8. EVERYTHING MUST BE STRICTLY DATA-DRIVEN. NO ESTIMATED OR FAKE SCORES.
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
    parsed._usage = {
      promptTokens:    response.usage?.prompt_tokens    ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    };
    return parsed;
  } catch (error: any) {
    console.error('Error generating AI audit:', error);
    throw new Error(`Failed to generate AI audit: ${error.message || error}`);
  }
}
