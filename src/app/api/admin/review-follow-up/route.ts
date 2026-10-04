import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { loadReviewFollowUpPolicy, saveReviewFollowUpPolicy } from '@/lib/reviewFollowUpPolicyStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const policy = await loadReviewFollowUpPolicy();
  return NextResponse.json({
    success: true,
    policy,
    reviewCompletionStop: {
      available: false,
      reason: 'No verified Google review-completion signal exists. A click is not a submitted review.',
    },
  });
}

export async function PUT(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const result = await saveReviewFollowUpPolicy(body);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ success: true, policy: result.value });
}
