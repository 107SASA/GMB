import { NextResponse } from "next/server";
import { WorkflowError } from "@/lib/blog/workflow";
import type { StudioViewer } from "@/lib/studioAuth";

/** JSON error for a Studio route — friendly message for known cases, generic otherwise. */
export function studioError(err: unknown, label: string) {
  if (err instanceof WorkflowError) {
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: err.status });
  }
  console.error(`[studio] ${label}:`, (err as any)?.message || err);
  return NextResponse.json({ success: false, error: "Something went wrong. Please try again." }, { status: 500 });
}

/**
 * Audit trail: every Studio change is recorded under the person who made it
 * (AdminActionLog — same log as Super Admin "login as customer" actions).
 * Best-effort, never blocks.
 */
export async function logStudioAction(viewer: StudioViewer, action: string, metadata: Record<string, unknown>) {
  try {
    const [{ default: dbConnect }, { default: AdminActionLog }] = await Promise.all([
      import("@/lib/mongodb"),
      import("@/models/AdminActionLog"),
    ]);
    await dbConnect();
    await AdminActionLog.create({
      adminUserId: viewer.userId,
      adminEmail: viewer.email,
      action: `studio.${action}`,
      metadata: { ...metadata, role: viewer.isSuperAdmin ? "SUPER_ADMIN" : "TEAM_MEMBER" },
    });
  } catch (err: any) {
    console.error("[studio] action log failed:", err?.message);
  }
}

export const isObjectId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);
