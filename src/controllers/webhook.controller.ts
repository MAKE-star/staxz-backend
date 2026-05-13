import { Request, Response } from 'express';
import { BookingService } from '../services/booking.service';
import { WithdrawalService } from '../services/withdrawal.service';
import { SavedCardModel } from '../models/saved.model';
import { BookingModel } from '../models/booking.model';
import { WhatsAppService } from '../services/whatsapp.service';
import { PaystackService } from '../services/paystack.service';
import { PaystackWebhookEvent } from '../types';
import { logger } from '../utils/logger';

export class WebhookController {
  static async paystackWebhook(req: Request, res: Response): Promise<void> {
    // Acknowledge immediately — Paystack requires < 5s response
    res.sendStatus(200);

    const signature = req.headers['x-paystack-signature'] as string;
    const rawBody   = (req as Request & { rawBody: string }).rawBody;

    if (!PaystackService.verifyWebhookSignature(rawBody, signature)) {
      logger.warn('Invalid Paystack webhook signature — rejected');
      return;
    }

    const event = req.body as PaystackWebhookEvent;
    logger.info({ event: event.event, ref: event.data?.reference }, 'Paystack webhook');

    switch (event.event) {
      case 'charge.success': {
        await BookingService.onPaymentConfirmed(event.data.reference, event.data.amount);

        // Auto-save card if Paystack returns tokenised auth (reusable card)
        const auth = (event.data as Record<string, unknown>).authorization as Record<string, unknown> | undefined;
        if (auth?.reusable && auth.authorization_code) {
          const booking = await BookingModel.findByPaystackRef(event.data.reference);
          if (booking) {
            await SavedCardModel.upsert({
              user_id: booking.hirer_id,
              paystack_auth_code: auth.authorization_code as string,
              last4: (auth.last4 as string) ?? '****',
              card_type: auth.card_type as string | undefined,
              exp_month: auth.exp_month ? parseInt(auth.exp_month as string, 10) : undefined,
              exp_year:  auth.exp_year  ? parseInt(auth.exp_year  as string, 10) : undefined,
              bank: auth.bank as string | undefined,
            });
          }
        }
        break;
      }

      case 'transfer.success': {
        const transferCode = (event.data as Record<string, unknown>).transfer_code as string;
        if (transferCode) {
          await WithdrawalService.handleTransferWebhook(transferCode, 'success');
        }
        break;
      }

      case 'transfer.failed':
      case 'transfer.reversed': {
        const transferCode = (event.data as Record<string, unknown>).transfer_code as string;
        const reason = (event.data as Record<string, unknown>).reason as string | undefined;
        if (transferCode) {
          await WithdrawalService.handleTransferWebhook(transferCode, 'failed', reason);
        }
        break;
      }

      default:
        logger.debug({ event: event.event }, 'Unhandled Paystack event type');
    }
  }

  /**
   * Wati sends every inbound WhatsApp message here.
   * 1. Verify token
   * 2. Delegate to WhatsAppService.handleInbound (idempotency + logging)
   * 3. If price parsed → BookingService.receiveQuote
   */
  static async watiWebhook(req: Request, res: Response): Promise<void> {
    res.sendStatus(200); // Ack immediately

    const body = req.body as {
      waId?: string;
      text?: string;
      id?: string;
      timestamp?: string;
      type?: string;
      data?: { text?: { body?: string } };
      image?: { link?: string };
    };

    // Normalise across Wati payload formats
    const waId      = body.waId ?? '';
    const messageId = body.id ?? `fallback-${Date.now()}`;
    const text      = body.text ?? body.data?.text?.body ?? '';
    const mediaUrl  = body.image?.link;

    if (!waId || !text) {
      logger.debug({ body }, 'Wati webhook missing waId or text');
      return;
    }

    logger.info({ waId, messageId, text: text.slice(0, 60) }, 'Inbound WhatsApp message');

    const result = await WhatsAppService.handleInbound({
      waId,
      messageId,
      text,
      mediaUrl,
      rawPayload: body as Record<string, unknown>,
    });

    if (result.handled && result.price !== undefined && result.enquiryId) {
      await BookingService.receiveQuote(result.enquiryId, result.price.toString());
    }
  }

  /** Wati GET verification handshake */
  static watiVerify(req: Request, res: Response): void {
    const { token } = req.query as { token?: string };
    if (token === process.env.WATI_WEBHOOK_TOKEN) {
      res.send(token);
    } else {
      res.sendStatus(403);
    }
  }
}
