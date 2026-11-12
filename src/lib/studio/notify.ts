/**
 * Content Studio emails. All best-effort: a failed email never fails the
 * action that triggered it (the Review queue in the Studio is the source of
 * truth; email is only a nudge).
 */
const esc = (v: string) =>
  v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function appUrl(path: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://growwmatics.com").replace(/\/$/, "");
  return `${base}${path}`;
}

function shell(heading: string, body: string, buttonLabel: string, link: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #eaeaea;border-radius:8px">
    <h2 style="margin:0 0 12px;color:#101613">${heading}</h2>
    ${body}
    <p style="text-align:center;margin:28px 0"><a href="${link}" style="background:#06b34c;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${buttonLabel}</a></p>
    <p style="color:#888;font-size:12px">Growwmatics AI Content Studio</p>
  </div>`;
}

async function send(to: string[], subject: string, html: string) {
  if (!to.length) return;
  try {
    const { sendTransactionalEmail } = await import("@/services/email");
    await Promise.all(to.map((t) => sendTransactionalEmail(t, subject, html, undefined, { ignoreQaSuppression: true })));
  } catch (err: any) {
    console.error("[studio/notify] email failed:", err?.message);
  }
}

async function superAdminEmails(): Promise<string[]> {
  const [{ default: dbConnect }, { default: User }] = await Promise.all([import("@/lib/mongodb"), import("@/models/User")]);
  await dbConnect();
  const rows = await User.find({ role: "SUPER_ADMIN", isDeleted: { $ne: true } }).select("email").lean<{ email: string }[]>();
  return rows.map((r) => r.email).filter(Boolean);
}

async function emailOf(userId: unknown): Promise<string[]> {
  if (!userId) return [];
  const [{ default: dbConnect }, { default: User }] = await Promise.all([import("@/lib/mongodb"), import("@/models/User")]);
  await dbConnect();
  const u = await User.findById(userId).select("email role isDeleted").lean<{ email?: string; role?: string; isDeleted?: boolean }>();
  return u?.email && !u.isDeleted ? [u.email] : [];
}

/** A team member submitted something — tell every Super Admin. */
export async function notifySubmitted(opts: { kind: "post" | "page"; title: string; byName: string; reviewPath: string }) {
  const what = opts.kind === "post" ? "blog post" : "website page change";
  await send(
    await superAdminEmails(),
    `Approval needed: ${opts.title}`,
    shell(
      `A ${what} is waiting for your approval`,
      `<p style="color:#555;font-size:15px"><b>${esc(opts.byName)}</b> submitted <b>${esc(opts.title)}</b>.</p>`,
      "Review it",
      appUrl(opts.reviewPath)
    )
  );
}

/** Super Admin approved or sent back — tell the person who submitted. */
export async function notifyReviewed(opts: {
  submittedBy: unknown;
  title: string;
  outcome: "published" | "scheduled" | "changes_requested";
  note?: string;
  when?: string;
  editPath: string;
}) {
  const heading =
    opts.outcome === "published"
      ? "Your post is live 🎉"
      : opts.outcome === "scheduled"
        ? "Your post is approved and scheduled"
        : "Changes requested";
  const body =
    opts.outcome === "changes_requested"
      ? `<p style="color:#555;font-size:15px"><b>${esc(opts.title)}</b> needs a few changes before it can go live:</p><blockquote style="margin:12px 0;padding:12px 16px;background:#f6f7f6;border-left:3px solid #06b34c;color:#333">${esc(opts.note || "")}</blockquote>`
      : `<p style="color:#555;font-size:15px"><b>${esc(opts.title)}</b> was approved${opts.when ? ` and goes live on <b>${esc(opts.when)}</b>` : " and is now live"}.</p>`;
  await send(await emailOf(opts.submittedBy), `${heading}: ${opts.title}`, shell(heading, body, "Open in Content Studio", appUrl(opts.editPath)));
}
