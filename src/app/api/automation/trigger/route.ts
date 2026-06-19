import { NextResponse } from "next/server";
import { checkScheduledPosts } from "@/services/automation";
import dbConnect from "@/lib/mongodb";

export async function POST(req: Request) {
  try {
    // This endpoint can be triggered by n8n or any external scheduler
    
    // Auth check should be here if required
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${process.env.JWT_SECRET}`) {
      // return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Trigger scheduled posts check
    await checkScheduledPosts();
    
    // You can also add other automated tasks here like follow-ups
    
    return NextResponse.json({ message: "Automation tasks triggered successfully" });
  } catch (error: any) {
    console.error("Automation Trigger Error:", error);
    return NextResponse.json({ message: "Server error", error: error.message }, { status: 500 });
  }
}
