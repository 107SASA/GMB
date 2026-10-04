import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { inngest } from '@/services/inngest/client';
import dbConnect from '@/lib/mongodb';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { workflow, businessId } = await req.json();

    if (!workflow) {
      return NextResponse.json({ success: false, error: 'workflow is required' }, { status: 400 });
    }

    await dbConnect();

    let eventsSent = 0;

    switch (workflow) {
      case 'buffer-check': {
        if (!businessId) {
          return NextResponse.json(
            { success: false, error: 'businessId is required for buffer-check' },
            { status: 400 }
          );
        }
        await inngest.send({ name: 'scheduler/manual-generate', data: { businessId, force: true } });
        eventsSent = 1;
        break;
      }

      case 'publish-posts': {
        const { default: Post } = await import('@/models/Post');
        const now = new Date();
        const readyPosts = await Post.find({
          status: 'scheduled',
          scheduledDate: { $lte: now },
        })
          .select('_id')
          .lean();
        if (readyPosts.length > 0) {
          await inngest.send(
            readyPosts.map((p: any) => ({
              name: 'scheduler/publish-post' as const,
              data: { postId: p._id.toString() },
            }))
          );
        }
        eventsSent = readyPosts.length;
        break;
      }

      case 'sync-reviews': {
        if (!businessId) {
          return NextResponse.json(
            { success: false, error: 'businessId is required for sync-reviews' },
            { status: 400 }
          );
        }
        await inngest.send({ name: 'reviews/sync', data: { businessId } });
        eventsSent = 1;
        break;
      }

      case 'review-autopoll': {
        // A click is not evidence that a Google review was submitted.
        eventsSent = 0;
        break;
      }

      case 'generate-content': {
        if (!businessId) {
          return NextResponse.json(
            { success: false, error: 'businessId is required for generate-content' },
            { status: 400 }
          );
        }
        await inngest.send({ name: 'scheduler/manual-generate', data: { businessId, force: true } });
        eventsSent = 1;
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown workflow: ${workflow}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, triggered: true, workflow, eventsSent });
  } catch (error: any) {
    console.error('[admin/automations/trigger] error:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
