import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { partitionOwnership } from "@/services/jobs/config";
import { loadRegistry } from "@/services/jobs/dispatch";

/**
 * GET /api/inngest/ownership — which Inngest function ids THIS web process
 * serves to Inngest vs. releases to the native worker. Consumed only by the
 * worker's startup/periodic ownership guard (src/services/jobs/ownershipGuard.ts).
 *
 * Reports this process's effective env; it cannot see Inngest Cloud's
 * registration (that needs the dashboard check + PUT /api/inngest resync).
 *
 * Disabled (404) unless JOBS_GUARD_TOKEN is set; requires
 * `Authorization: Bearer <JOBS_GUARD_TOKEN>`. Exposes function ids only.
 */
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const expected = process.env.JOBS_GUARD_TOKEN || "";
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const provided = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(expected);
  return provided.length === want.length && crypto.timingSafeEqual(provided, want);
}

export async function GET(req: NextRequest) {
  if (!process.env.JOBS_GUARD_TOKEN) return new NextResponse(null, { status: 404 });
  if (!authorized(req)) return new NextResponse(null, { status: 401 });
  try {
    const known = (await loadRegistry()).map((f) => f.id);
    const { inngest, native } = partitionOwnership(known);
    // Mirrors the conditional registration in /api/inngest/route.ts.
    const served =
      process.env.LEAD_ENGINE_V2 === "true" ? inngest : inngest.filter((id) => id !== "proactive-nba-scheduler");
    return NextResponse.json(
      { version: 1, known, served, native },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err: any) {
    // Unknown ids in JOBS_NATIVE_FUNCTIONS throw here — surface as 500 so the guard fails closed.
    return NextResponse.json({ error: String(err?.message || err).slice(0, 200) }, { status: 500 });
  }
}
