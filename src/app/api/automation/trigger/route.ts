import { NextResponse } from "next/server";
import crypto from "crypto";
import { checkScheduledPosts } from "@/services/automation";

/**
 * External scheduler hook (n8n / cron) that runs the scheduled-post sweep.
 *
 * Auth: `Authorization: Bearer <AUTOMATION_TRIGGER_SECRET>`.
 *
 * SEC-13: this used to reuse `JWT_SECRET` (the session-signing secret) as its
 * bearer — so rotating the signing key silently broke this integration and
 * vice-versa. It now uses a dedicated `AUTOMATION_TRIGGER_SECRET`, falling
 * back to `JWT_SECRET` (with a warning) ONLY while the new var is being rolled
 * out. Set `AUTOMATION_TRIGGER_SECRET` in the deploy env and update the n8n
 * credential; the fallback can then be removed.
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.AUTOMATION_TRIGGER_SECRET || process.env.JWT_SECRET;
  if (!process.env.AUTOMATION_TRIGGER_SECRET && process.env.JWT_SECRET) {
    console.warn(
      '[automation/trigger] AUTOMATION_TRIGGER_SECRET is not set — falling back to JWT_SECRET. ' +
      'Set a dedicated AUTOMATION_TRIGGER_SECRET and update the n8n credential.'
    );
  }
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
