import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import Business from '@/models/Business';
import ReviewMonitorLog from '@/models/ReviewMonitorLog';
import { generateAIReply, analyzeSentiment } from './ai';

/**
 * MOCK: Fetch new reviews from Google Business Profile
 * In production, this would call the Google My Business API
 */
export async function fetchGoogleReviews(businessId: string) {
  // Mocking new reviews that could have been polled from Google
  return [
    {
      reviewerName: 'John Doe',
      rating: 5,
      reviewText: 'Great service! The team was very helpful and the quality is amazing.',
      sourcePlatform: 'Google',
      createdAt: new Date(),
    },
    {
      reviewerName: 'Jane Smith',
      rating: 2,
      reviewText: 'Very slow response time. Not happy with the experience today.',
      sourcePlatform: 'Google',
      createdAt: new Date(),
    }
  ];
}

export async function processNewReviews(businessId: string) {
  await dbConnect();
  
  try {
    const business = await Business.findById(businessId);
    if (!business) throw new Error('Business not found');

    const fetchedReviews = await fetchGoogleReviews(businessId);
    let newReviewsDetected = 0;
    let aiRepliesGenerated = 0;
    const errors: string[] = [];

    for (const data of fetchedReviews) {
      // Check if review already exists (assuming reviewerName + reviewText is unique enough for mock)
      const existing = await Review.findOne({
        businessId: business._id,
        reviewer: data.reviewerName,
        rating: data.rating,
      });

      if (!existing) {
        newReviewsDetected++;
        try {
          const sentiment = await analyzeSentiment(data.reviewText, data.rating);
          const aiReply = await generateAIReply(data.reviewText, data.rating, data.reviewerName, 'Professional');

          const reviewData = {
            businessId: business._id,
            reviewer: data.reviewerName,
            rating: data.rating,
            reviewText: data.reviewText,
            sentiment,
            aiSuggestedReply: aiReply,
            replyStatus: 'PENDING',
            replyTone: 'Professional',
            sourcePlatform: data.sourcePlatform,
          };

          const savedReview = await Review.create(reviewData);
          aiRepliesGenerated++;
          
          if (sentiment === 'critical' && business?.integrations?.twilioSid && business?.integrations?.twilioAuthToken) {
            try {
              const client = require('twilio')(business.integrations.twilioSid, business.integrations.twilioAuthToken);
              
              // Find the owner phone (simplified for MVP: send to business phone if no user phone)
              const alertPhone = business.phone || '+1234567890';
              
              await client.messages.create({
                body: `🚨 Critical Alert: You received a 1-star review from ${data.reviewerName}. Log in to GMBBoost to respond immediately.`,
                from: business.integrations.whatsappNumber ? `whatsapp:${business.integrations.whatsappNumber}` : 'whatsapp:+14155238886',
                to: `whatsapp:${alertPhone}`
              });
              console.log('Dispatched critical review alert to owner via WhatsApp');
            } catch (err: any) {
              console.error('Failed to send critical alert via Twilio:', err.message);
            }
          }
        } catch (err: any) {
          errors.push(`Failed to process review for ${data.reviewerName}: ${err.message}`);
        }
      }
    }

    await ReviewMonitorLog.create({
      businessId: business._id,
      reviewsFetched: fetchedReviews.length,
      newReviewsDetected,
      aiRepliesGenerated,
      errorLogs: errors,
    });

    return {
      success: true,
      stats: { fetched: fetchedReviews.length, new: newReviewsDetected, replies: aiRepliesGenerated },
      errors
    };
  } catch (error: any) {
    console.error('Process New Reviews Error:', error);
    return { success: false, error: error.message };
  }
}
