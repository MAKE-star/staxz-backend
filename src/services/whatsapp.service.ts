import { config } from '../config';
import { ConversationModel } from '../models/conversation.model';
import { EnquiryModel } from '../models/enquiry.model';
import { ProviderModel } from '../models/provider.model';
import { EnquiryStatus } from '../types';
import { logger } from '../utils/logger';

export class WhatsAppService {
  static async sendEnquiryToProvider(params: {
    enquiryId: string;
    hirerId: string;
    providerId: string;
    providerWhatsApp: string;
    categoryId: string;
    serviceType: string;
    inspirationPhotoUrl?: string;
    notes?: string;
  }): Promise<string> {
    const message = [
      `🔔 *New Staxz Enquiry*`,
      `Service: *${params.categoryId}* (${params.serviceType === 'home' ? '🏠 Home Service' : '🪑 Walk-In'})`,
      params.notes ? `Note: _${params.notes}_` : null,
      ``,
      `Reply with your price in Naira only — e.g. *8500*`,
      `You have *60 minutes* to respond. Staxz adds 15% on top of your quote.`,
    ].filter(Boolean).join('\n');

    const conversationId = await this._sendMessage(params.providerWhatsApp, message);

    if (params.inspirationPhotoUrl) {
      await this._sendImage(params.providerWhatsApp, params.inspirationPhotoUrl, '📸 Client inspiration photo');
    }

    await ConversationModel.log({
      enquiry_id: params.enquiryId,
      provider_wa_id: params.providerWhatsApp.replace('+', ''),
      hirer_id: params.hirerId,
      provider_id: params.providerId,
      direction: 'outbound',
      from_role: 'bot',
      message_text: message,
      media_url: params.inspirationPhotoUrl,
    });

    return conversationId;
  }

  static async sendBookingConfirmed(params: {
    bookingId: string;
    enquiryId?: string;
    hirerId: string;
    providerId: string;
    providerWhatsApp: string;
    hirerName: string;
    bookingReference: string;
    serviceAddress?: string;
    scheduledAt?: string;
  }): Promise<void> {
    const message = [
      `✅ *Booking Confirmed — ${params.bookingReference}*`,
      `Client: ${params.hirerName}`,
      params.serviceAddress ? `Address: ${params.serviceAddress}` : null,
      params.scheduledAt   ? `Time: ${params.scheduledAt}` : null,
      ``,
      `Payment is in escrow. Released once the client confirms completion.`,
    ].filter(Boolean).join('\n');

    await this._sendMessage(params.providerWhatsApp, message);
    await ConversationModel.log({
      booking_id: params.bookingId,
      enquiry_id: params.enquiryId,
      provider_wa_id: params.providerWhatsApp.replace('+', ''),
      hirer_id: params.hirerId,
      provider_id: params.providerId,
      direction: 'outbound',
      from_role: 'system',
      message_text: message,
    });
  }

  static async sendDisputeNotificationToAdmin(params: {
    bookingReference: string;
    hirerName: string;
    providerName: string;
    reason: string;
    escrowKobo: number;
  }): Promise<void> {
    const adminNumber = process.env.ADMIN_WHATSAPP_NUMBER;
    if (!adminNumber) return;
    const msg = `🚨 *Dispute — ${params.bookingReference}*\nHirer: ${params.hirerName}\nProvider: ${params.providerName}\nReason: ${params.reason}\nEscrow frozen: ₦${(params.escrowKobo / 100).toLocaleString('en-NG')}`;
    await this._sendMessage(adminNumber, msg);
  }

  /**
   * Handle an inbound message from a provider.
   * Handles idempotency, logging, price parsing, and re-prompting.
   */
  static async handleInbound(params: {
    waId: string;
    messageId: string;
    text: string;
    mediaUrl?: string;
    rawPayload: Record<string, unknown>;
  }): Promise<{ handled: boolean; price?: number; enquiryId?: string }> {
    const provider = await ProviderModel.findByWhatsApp(`+${params.waId}`);
    if (!provider) return { handled: false };

    const enquiries = await EnquiryModel.findPendingForProvider(provider.id);
    if (!enquiries.length) {
      // Spec §6.2: if provider replies again after quoting, ignore it silently
      logger.debug({ waId: params.waId }, 'No pending enquiries — ignoring reply');
      return { handled: false };
    }

    const enquiry = enquiries[enquiries.length - 1];

    // Spec §6.2: Only the FIRST valid price response is used.
    // If enquiry already has a quote (status = quoted), ignore further replies.
    if (enquiry.status === EnquiryStatus.QUOTED) {
      logger.debug({ enquiryId: enquiry.id }, 'Enquiry already quoted — ignoring additional provider reply');
      return { handled: false };
    }

    // Log inbound — returns null if duplicate (idempotency)
    const logged = await ConversationModel.log({
      enquiry_id: enquiry.id,
      provider_wa_id: params.waId,
      hirer_id: enquiry.hirer_id,
      provider_id: provider.id,
      direction: 'inbound',
      from_role: 'provider',
      message_text: params.text,
      media_url: params.mediaUrl,
      wati_message_id: params.messageId,
      raw_payload: params.rawPayload,
    });

    if (!logged) {
      logger.debug({ messageId: params.messageId }, 'Duplicate inbound message — skipped');
      return { handled: false };
    }

    const price = this.parseQuoteFromReply(params.text);

    if (price === null) {
      // Re-prompt provider with clearer instructions
      const reprompt = `Please reply with the price only as a number — e.g. *18000*\nDo not include words or currency symbols.`;
      await this._sendMessage(`+${params.waId}`, reprompt);
      await ConversationModel.log({
        enquiry_id: enquiry.id,
        provider_wa_id: params.waId,
        hirer_id: enquiry.hirer_id,
        provider_id: provider.id,
        direction: 'outbound',
        from_role: 'bot',
        message_text: reprompt,
      });
      return { handled: true };
    }

    return { handled: true, price, enquiryId: enquiry.id };
  }

  /** Parse price from provider's WhatsApp reply. Per spec §6.2 regex. */
  static parseQuoteFromReply(text: string): number | null {
    const cleaned = text.toLowerCase().trim();

    // "15k" or "15.5k"
    const kMatch = cleaned.match(/\b(\d+(?:\.\d+)?)\s*k\b/);
    if (kMatch) {
      const val = parseFloat(kMatch[1]) * 1000;
      return val > 0 ? val : null;
    }

    // Standard number, optional commas: "18,000", "18000", "₦8500", "price is 8500"
    const numMatch = cleaned.match(/\b(\d[\d,]*(?:\.\d+)?)\b/);
    if (numMatch) {
      const val = parseFloat(numMatch[1].replace(/,/g, ''));
      return val > 0 ? val : null;
    }

    return null;
  }

  private static async _sendMessage(to: string, message: string): Promise<string> {
    if (!config.wati.accessToken || !config.wati.apiUrl) {
      logger.debug({ to, preview: message.slice(0, 80) }, '[DEV] WhatsApp outbound suppressed');
      return `dev-${Date.now()}`;
    }
    try {
      const res = await fetch(`${config.wati.apiUrl}/api/v1/sendSessionMessage/${to.replace('+', '')}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.wati.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageText: message }),
      });
      const data = await res.json() as { conversationId?: string; id?: string };
      return data.conversationId ?? data.id ?? `wati-${Date.now()}`;
    } catch (err) {
      logger.error({ err, to }, 'WhatsApp send failed');
      return `err-${Date.now()}`;
    }
  }

  private static async _sendImage(to: string, url: string, caption: string): Promise<void> {
    if (!config.wati.accessToken) return;
    try {
      await fetch(`${config.wati.apiUrl}/api/v1/sendSessionFile/${to.replace('+', '')}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.wati.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, caption }),
      });
    } catch (err) {
      logger.error({ err, to }, 'WhatsApp image send failed');
    }
  }
}
