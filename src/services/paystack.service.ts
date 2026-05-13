import { config } from '../config';
import { PaymentError } from '../utils/errors';
import { logger } from '../utils/logger';

const PAYSTACK_BASE = 'https://api.paystack.co';

const paystackHeaders = {
  Authorization: `Bearer ${config.paystack.secretKey}`,
  'Content-Type': 'application/json',
};

async function paystackRequest<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown
): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: paystackHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json() as { status: boolean; message: string; data: T };

  if (!data.status) {
    logger.error({ path, data }, 'Paystack API error');
    throw new PaymentError(data.message);
  }

  return data.data;
}

export class PaystackService {
  static async initiatePayment(params: {
    email: string;
    amountKobo: number;
    reference: string;
    metadata: Record<string, unknown>;
  }): Promise<{ authorizationUrl: string; reference: string }> {
    const data = await paystackRequest<{
      authorization_url: string;
      reference: string;
    }>('/transaction/initialize', 'POST', {
      email: params.email,
      amount: params.amountKobo, // Paystack uses kobo
      reference: params.reference,
      metadata: params.metadata,
      channels: ['card', 'bank', 'ussd', 'bank_transfer'],
      callback_url: `${process.env.APP_BASE_URL}/payments/verify`,
    });

    return {
      authorizationUrl: data.authorization_url,
      reference: data.reference,
    };
  }

  static async verifyTransaction(reference: string): Promise<{
    status: string;
    amount: number;
    reference: string;
  }> {
    const data = await paystackRequest<{
      status: string;
      amount: number;
      reference: string;
    }>(`/transaction/verify/${reference}`);
    return data;
  }

  static async initiateTransfer(params: {
    amountKobo: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }): Promise<{ transferCode: string; reference: string }> {
    const data = await paystackRequest<{
      transfer_code: string;
      reference: string;
    }>('/transfer', 'POST', {
      source: 'balance',
      amount: params.amountKobo,
      recipient: params.recipientCode,
      reference: params.reference,
      reason: params.reason,
    });
    return { transferCode: data.transfer_code, reference: data.reference };
  }

  static async createTransferRecipient(params: {
    accountName: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<string> {
    const data = await paystackRequest<{ recipient_code: string }>(
      '/transferrecipient', 'POST',
      {
        type: 'nuban',
        name: params.accountName,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: 'NGN',
      }
    );
    return data.recipient_code;
  }

  static async transferToProvider(params: {
    bookingId: string;
    providerQuoteKobo: number;
    bookingReference: string;
    recipientCode?: string;
  }): Promise<void> {
    if (!params.recipientCode) {
      // No recipient code yet — log for manual action
      logger.warn(
        { bookingId: params.bookingId, amountKobo: params.providerQuoteKobo },
        '⚠️ No Paystack recipient code for provider — manual transfer required'
      );
      return;
    }

    await paystackRequest('/transfer', 'POST', {
      source: 'balance',
      reason: `Staxz payout — booking ${params.bookingReference}`,
      amount: params.providerQuoteKobo,
      recipient: params.recipientCode,
      reference: `${params.bookingReference}-payout`,
    });

    logger.info(
      { bookingId: params.bookingId, amountKobo: params.providerQuoteKobo },
      'Paystack transfer to provider initiated'
    );
  }

  static async refundHirer(params: {
    paystackRef: string;
    amountKobo: number;
  }): Promise<void> {
    await paystackRequest('/refund', 'POST', {
      transaction: params.paystackRef,
      amount: params.amountKobo,
    });
    logger.info({ paystackRef: params.paystackRef, amountKobo: params.amountKobo }, 'Refund initiated');
  }

  static verifyWebhookSignature(payload: string, signature: string): boolean {
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('sha512', config.paystack.webhookSecret)
      .update(payload)
      .digest('hex');
    return hash === signature;
  }
}
