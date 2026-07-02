import { NextRequest, NextResponse } from "next/server";
import { handleReviewRedirect } from "@/lib/reviewRedirect";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = await handleReviewRedirect(id);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("Tracking redirect error:", error);
    return NextResponse.redirect('https://google.com');
  }
}
