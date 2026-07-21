/**
 * Meta WhatsApp Cloud API client (Graph API).
 *
 * Low-level senders only — provider routing, MessageQueue logging, and the
 * 24-hour-window template fallback live in ./send.ts. Configure via:
 *   META_WHATSAPP_ACCESS_TOKEN   permanent System User token (whatsapp_business_messaging)
 *   META_WHATSAPP_PHONE_NUMBER_ID  the sender's Phone Number ID (not the phone number)
 *   META_GRAPH_API_VERSION       optional, defaults to v23.0
 */

export interface MetaSendResult {
  success: boolean;
  /** WhatsApp message id (wamid...) — stored where Twilio SIDs used to go. */
  sid?: string;
  error?: string;
  /** Meta error code, e.g. 131047 = outside the 24h customer service window. */
  errorCode?: number;
}

export interface MetaConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
}

export function getMetaConfig(): MetaConfig | null {
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) return null;
  return {
    accessToken,
    phoneNumberId,
    apiVersion: process.env.META_GRAPH_API_VERSION || 'v23.0',
  };
}

/** Meta wants bare digits with country code — no 'whatsapp:' prefix, no '+'. */
export function normalizePhoneForMeta(phone: string): string {
  return phone.replace(/^whatsapp:/i, '').replace(/[^\d]/g, '');
}

/** Error codes that mean "free-form text rejected, a template is required". */
const REENGAGEMENT_ERROR_CODES = new Set([131047, 131026, 470]);

export function isReengagementError(errorCode?: number, message?: string): boolean {
  if (errorCode !== undefined && REENGAGEMENT_ERROR_CODES.has(errorCode)) return true;
  return /re-?engagement|24[\s-]?hour/i.test(message || '');
}

async function postToMeta(config: MetaConfig, payload: Record<string, unknown>): Promise<MetaSendResult> {
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const err = data.error || {};
      return {
        success: false,
        error: err.message || `Meta API HTTP ${res.status}`,
        errorCode: typeof err.code === 'number' ? err.code : undefined,
      };
    }
    return { success: true, sid: data.messages?.[0]?.id };
  } catch (e: any) {
    return { success: false, error: e?.name === 'AbortError' ? 'Meta API timeout (15s)' : e?.message || 'Meta API request failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMetaText(phone: string, body: string): Promise<MetaSendResult> {
  const config = getMetaConfig();
  if (!config) return { success: false, error: 'Meta WhatsApp is not configured (missing META_WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID)' };
  return postToMeta(config, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhoneForMeta(phone),
    type: 'text',
    text: { preview_url: true, body },
  });
}

/**
 * Send an approved template. `bodyParams` fill {{1}}, {{2}}, ... in order.
 * Meta rejects params containing newlines/tabs/4+ consecutive spaces, so
 * params are flattened to single-spaced text.
 */
export async function sendMetaTemplate(
  phone: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[] = []
): Promise<MetaSendResult> {
  const config = getMetaConfig();
  if (!config) return { success: false, error: 'Meta WhatsApp is not configured (missing META_WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID)' };
  const components = bodyParams.length
    ? [{
        type: 'body',
        parameters: bodyParams.map((text) => ({
          type: 'text',
          text: text.replace(/\s+/g, ' ').trim().slice(0, 1024),
        })),
      }]
    : undefined;
  return postToMeta(config, {
    messaging_product: 'whatsapp',
    to: normalizePhoneForMeta(phone),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components ? { components } : {}),
    },
  });
}
