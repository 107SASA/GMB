import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Business from "@/models/Business";
import { generatePost } from "@/services/ai";

export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await req.json();
    let businessProfile;

    if (body.businessId) {
      businessProfile = await Business.findById(body.businessId);
    } else {
      const { getActiveBusinessContext } = await import('@/lib/business-context');
      const context = await getActiveBusinessContext();
      if (!context.ok) return NextResponse.json({ message: 'No active business context found' }, { status: 400 });
      businessProfile = context.business;
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
