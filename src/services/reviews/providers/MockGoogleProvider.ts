export interface ProviderReview {
  providerReviewId: string;
  reviewerName: string;
  rating: number;
  text: string;
  postedAt: string;
}

export class MockGoogleProvider {
  /**
   * Simulates fetching recent reviews from a Google Business Profile
   */
  async fetchReviews(businessId: string): Promise<ProviderReview[]> {
    // Artificial delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Return mocked data with random IDs to prevent endless duplicates in a real app,
    // but for demo, we use static IDs so they deduplicate correctly on subsequent syncs.
    return [
      {
        providerReviewId: `gmb-1-${businessId}`,
        reviewerName: 'Priya Sharma',
        rating: 5,
        text: 'Absolutely fantastic service! The team was highly professional and resolved my issue immediately. Highly recommend.',
        postedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(), // 1 day ago
      },
      {
        providerReviewId: `gmb-2-${businessId}`,
        reviewerName: 'Rahul Verma',
        rating: 4,
        text: 'Good experience overall. Wait time was a bit longer than expected but the quality makes up for it.',
        postedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), // 3 days ago
      },
      {
        providerReviewId: `gmb-3-${businessId}`,
        reviewerName: 'Amit Patel',
        rating: 1,
        text: 'Terrible customer service. I was completely ignored for 30 minutes and the product broke the next day.',
        postedAt: new Date().toISOString(), // today
      },
      {
        providerReviewId: `gmb-4-${businessId}`,
        reviewerName: 'Sneha Gupta',
        rating: 3,
        text: 'It was okay. Nothing special but gets the job done.',
        postedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
      }
    ];
  }

  /**
   * Simulates posting a reply to a specific review
   */
  async postReply(providerReviewId: string, replyText: string): Promise<{ success: boolean; postedAt: string }> {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    // Simulate a random provider failure (1 in 10 chance) for realism
    if (Math.random() < 0.1) {
      throw new Error('Google API Error: Failed to publish reply.');
    }

    return { success: true, postedAt: new Date().toISOString() };
  }
}

// Export a singleton instance
export const googleProvider = new MockGoogleProvider();
