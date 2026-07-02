export interface SentimentResult {
  label: 'positive' | 'neutral' | 'negative' | 'critical';
  score: number; // 0 to 100
}

/**
 * Fast rules-based sentiment engine designed to run efficiently during sync pipelines.
 * Avoids heavy LLM calls for standard syncs.
 * Scores are deterministic midpoints so analytics never drift across reprocessing runs.
 */
export function analyzeSentiment(text: string, rating: number): SentimentResult {
  const lowercaseText = (text || '').toLowerCase();

  const criticalKeywords = ['terrible', 'worst', 'scam', 'fraud', 'lawyer', 'sue', 'lawsuit', 'horrible', 'disgusting'];
  const containsCriticalKeyword = criticalKeywords.some(kw => lowercaseText.includes(kw));

  if (rating <= 2) {
    if (containsCriticalKeyword || rating === 1) {
      return { label: 'critical', score: 10 };
    }
    return { label: 'negative', score: 30 };
  }

  if (rating === 3) {
    if (containsCriticalKeyword) {
      return { label: 'negative', score: 35 };
    }
    return { label: 'neutral', score: 50 };
  }

  // 4 or 5 stars
  const positiveScore = rating === 4 ? 70 : 90;
  return { label: 'positive', score: positiveScore };
}
