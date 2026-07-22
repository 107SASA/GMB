import { NextResponse } from "next/server";
import crypto from "crypto";
import { checkScheduledPosts } from "@/services/automation";

/**
 * External scheduler hook (n8n / cron) that runs the scheduled-post sweep.
 *
 * Auth: `Authorization: Bearer <JWT_SECRET>` — the contract documented in
 * .env.production. The check below used to have its `return` commented out,
 * which left the endpoint fully open: anyone could POST it in a loop and drive
 * checkScheduledPosts(), spending Groq/SerpAPI credits and loading Atlas.
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.JWT_SECRET;
  // No secret configured means we cannot authenticate anyone — fail closed
  // rather than accepting "Bearer undefined".
  if (!secret) return false;

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;

  const provided = Buffer.from(header.slice("Bearer ".length).trim());
  const expected = Buffer.from(secret);

  // Length must match before timingSafeEqual, which throws on unequal buffers.
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    await checkScheduledPosts();
    return NextResponse.json({ message: "Automation tasks triggered successfully" });
  } catch (error: any) {
    console.error("Automation Trigger Error:", error);
    // Don't leak internal error details to an external caller.
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
