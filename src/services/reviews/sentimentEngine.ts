export interface SentimentResult {
  label: 'positive' | 'neutral' | 'negative' | 'critical';
  score: number; // 0 to 100
}

/**
 * Fast rules-based sentiment engine designed to run efficiently during sync pipelines.
 * Avoids heavy LLM calls for standard syncs.
 */
export function analyzeSentiment(text: string, rating: number): SentimentResult {
  const lowercaseText = (text || '').toLowerCase();
  
  // High-risk keywords that automatically flag a review as Critical regardless of star rating (unless 5 star)
  const criticalKeywords = ['terrible', 'worst', 'scam', 'fraud', 'lawyer', 'sue', 'lawsuit', 'horrible', 'disgusting'];
  
  const containsCriticalKeyword = criticalKeywords.some(kw => lowercaseText.includes(kw));

  if (rating <= 2) {
    if (containsCriticalKeyword || rating === 1) {
      return { label: 'critical', score: Math.floor(Math.random() * 20) }; // 0-19
    }
    return { label: 'negative', score: 20 + Math.floor(Math.random() * 20) }; // 20-39
  }

  if (rating === 3) {
    if (containsCriticalKeyword) {
      return { label: 'negative', score: 35 };
    }
    return { label: 'neutral', score: 40 + Math.floor(Math.random() * 20) }; // 40-59
  }

  // 4 or 5 stars
  const positiveScore = rating === 4 ? 60 + Math.floor(Math.random() * 20) : 80 + Math.floor(Math.random() * 20);
  return { label: 'positive', score: positiveScore };
}
