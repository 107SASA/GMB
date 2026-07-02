export interface WhatsAppMessagePayload {
  to: string;
  templateName?: string;
  body?: string;
}

export class MetaWhatsAppService {
  private businessPhone: string;
  private token: string;

  constructor(businessPhone: string, token: string) {
    this.businessPhone = businessPhone;
    this.token = token;
  }

  /**
   * Stub: Send a WhatsApp message using Meta Cloud API
   */
  async sendMessage(payload: WhatsAppMessagePayload) {
    console.log(`[Meta WhatsApp] Sending message to ${payload.to} from ${this.businessPhone}`);
    // Future Cloud API Implementation
    // return await fetch(`https://graph.facebook.com/v17.0/${this.businessPhone}/messages`, ...)
    return { success: true, messageId: 'meta_mock_' + Date.now() };
  }

  /**
   * Stub: Handle incoming webhook payload from Meta
   */
  static parseWebhook(body: any) {
    console.log(`[Meta WhatsApp] Parsing incoming webhook...`);
    return { success: true };
  }
}
