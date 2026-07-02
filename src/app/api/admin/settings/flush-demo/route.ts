import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Lead from '@/models/Lead';
import Review from '@/models/Review';
import Post from '@/models/Post';
import Conversation from '@/models/Conversation';
import ConversationThread from '@/models/ConversationThread';
import Customer from '@/models/Customer';
import ReviewRequest from '@/models/ReviewRequest';

const DEMO_TENANT = 'demo-tenant';

export async function POST() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const [
      leads,
      reviews,
      posts,
      conversations,
      threads,
      customers,
      reviewRequests,
    ] = await Promise.all([
      Lead.deleteMany({ tenantId: DEMO_TENANT }),
      Review.deleteMany({ tenantId: DEMO_TENANT }),
      Post.deleteMany({ tenantId: DEMO_TENANT }),
      Conversation.deleteMany({ tenantId: DEMO_TENANT }),
      ConversationThread.deleteMany({ tenantId: DEMO_TENANT }),
      Customer.deleteMany({ tenantId: DEMO_TENANT }),
      ReviewRequest.deleteMany({ tenantId: DEMO_TENANT }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        deleted: {
          leads:            leads.deletedCount,
          reviews:          reviews.deletedCount,
          posts:            posts.deletedCount,
          conversations:    conversations.deletedCount,
          threads:          threads.deletedCount,
          customers:        customers.deletedCount,
          reviewRequests:   reviewRequests.deletedCount,
        },
        total:
          leads.deletedCount +
          reviews.deletedCount +
          posts.deletedCount +
          conversations.deletedCount +
          threads.deletedCount +
          customers.deletedCount +
          reviewRequests.deletedCount,
      },
    });
  } catch (error: any) {
    console.error('Flush Demo Data Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to flush demo data' },
      { status: 500 }
    );
  }
}
