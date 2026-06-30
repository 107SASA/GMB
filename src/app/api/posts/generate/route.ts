import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Business from "@/models/Business";
import { generatePost } from "@/services/ai";
import { requireBusinessContext } from '@/lib/tenant';
import { checkUsageLimit } from '@/lib/featureGating';

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    // Check AI generation limit before calling AI
    const limitCheck = await checkUsageLimit(ctx.userId, ctx.businessId, 'aiGenerations');
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: limitCheck.reason, code: limitCheck.code ?? 'UPGRADE_REQUIRED', limit: limitCheck.limit, used: limitCheck.used },
        { status: 403 }
      );
    }

    await dbConnect();
    const body = await req.json();
    let businessProfile;

    if (body.businessId) {
      businessProfile = await Business.findById(body.businessId);
    } else {
      businessProfile = await Business.findById(ctx.businessId);
    }

    if (!businessProfile) {
      return NextResponse.json({ message: "Business profile not found" }, { status: 404 });
    }

    const aiContent = await generatePost(businessProfile);
    if (!aiContent) {
      return NextResponse.json({ message: "AI generation failed" }, { status: 500 });
    }

    return NextResponse.json({
      title: `${businessProfile.name || businessProfile.businessName} Update`,
      content: aiContent,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
