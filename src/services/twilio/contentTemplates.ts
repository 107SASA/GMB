/**
 * Reads one Twilio Content template and its WhatsApp approval, for the Super
 * Admin WhatsApp templates list. Read-only: nothing is created, submitted or
 * approved here — templates are made and submitted in the Twilio console.
 */
export const CONTENT_SID_RE = /^HX[0-9a-fA-F]{32}$/;

export type TemplateLookup =
  | {
      ok: true;
      twilioName: string;
      body: string;
      /** approved | pending | rejected | paused | unsubmitted | unknown */
      approvalStatus: string;
      category?: string;
      rejectionReason?: string;
    }
  | { ok: false; status: number; error: string };

/** The template's text, whichever content type it was built as. */
function bodyOf(types: Record<string, any> | undefined): string {
  if (!types) return '';
  for (const type of Object.values(types)) {
    if (type && typeof type.body === 'string' && type.body.trim()) return type.body;
  }
  return '';
}

export async function lookupContentTemplate(contentSid: string): Promise<TemplateLookup> {
  const sid = String(contentSid || '').trim();
  if (!CONTENT_SID_RE.test(sid)) return { ok: false, status: 400, error: 'A template SID is "HX" followed by 32 letters and numbers.' };
  const account = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!account || !token) return { ok: false, status: 503, error: 'Twilio is not configured on the server.' };
  const headers = { Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString('base64')}` };
  const get = async (url: string) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    return { res, json: await res.json().catch(() => ({} as any)) };
  };
  try {
    const content = await get(`https://content.twilio.com/v1/Content/${sid}`);
    if (content.res.status === 404) return { ok: false, status: 404, error: 'No template with this SID exists in your Twilio account.' };
    if (!content.res.ok) return { ok: false, status: 502, error: content.json?.message || `Twilio returned ${content.res.status}.` };
    const approval = await get(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`);
    const whatsapp = approval.res.ok ? approval.json?.whatsapp || {} : {};
    return {
      ok: true,
      twilioName: content.json?.friendly_name || whatsapp.name || '',
      body: bodyOf(content.json?.types),
      approvalStatus: String(whatsapp.status || (approval.res.ok ? 'unsubmitted' : 'unknown')).toLowerCase(),
      category: whatsapp.category ? String(whatsapp.category).toUpperCase() : undefined,
      rejectionReason: whatsapp.rejection_reason || undefined,
    };
  } catch (err: any) {
    return { ok: false, status: 502, error: `Could not reach Twilio: ${err?.message || 'network error'}` };
  }
}
