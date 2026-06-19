import { logger } from '../utils/logger';

const FLW_BASE = 'https://api.flutterwave.com/v3';
const SECRET = process.env.FLW_SECRET_KEY!;

const headers = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${SECRET}`,
});

export class FlutterwaveService {
  // ── Account Resolution ────────────────────────────────────────────────────
  static async resolveAccount(accountNumber: string, bankCode: string): Promise<{ account_name: string; account_number: string }> {
    const res = await fetch(
      `${FLW_BASE}/accounts/resolve?account_number=${accountNumber}&account_bank=${bankCode}`,
      { headers: headers() }
    );
    const data = await res.json() as any;
    logger.info({ accountNumber, bankCode, data }, 'FLW resolve account');

    if (data.status !== 'success') {
      throw new Error(data.message ?? 'Could not resolve account');
    }
    return { account_name: data.data.account_name, account_number: data.data.account_number };
  }

  // ── Initiate Payment ──────────────────────────────────────────────────────
  static async initiatePayment(opts: {
    email: string;
    amountKobo: number;
    reference: string;
    redirectUrl: string;
    metadata: Record<string, any>;
  }): Promise<{ paymentUrl: string; reference: string }> {
    const res = await fetch(`${FLW_BASE}/payments`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        tx_ref:          opts.reference,
        amount:          opts.amountKobo / 100, // FLW uses Naira not kobo
        currency:        'NGN',
        redirect_url:    opts.redirectUrl,
        customer:        { email: opts.email },
        customizations:  { title: 'Staxz', logo: 'https://starkel.netlify.app/logo.png' },
        meta:            opts.metadata,
      }),
    });
    const data = await res.json() as any;
    logger.info({ reference: opts.reference, data }, 'FLW initiate payment');

    if (data.status !== 'success') {
      throw new Error(data.message ?? 'Payment initiation failed');
    }
    return { paymentUrl: data.data.link, reference: opts.reference };
  }

  // ── Verify Payment ────────────────────────────────────────────────────────
  static async verifyPayment(transactionId: string): Promise<{ status: string; amountNaira: number; reference: string }> {
    const res = await fetch(`${FLW_BASE}/transactions/${transactionId}/verify`, { headers: headers() });
    const data = await res.json() as any;
    logger.info({ transactionId, data }, 'FLW verify payment');

    if (data.status !== 'success') throw new Error('Payment verification failed');
    return {
      status:      data.data.status,
      amountNaira: data.data.amount,
      reference:   data.data.tx_ref,
    };
  }

  // ── Create Transfer Recipient ─────────────────────────────────────────────
  static async createTransferRecipient(opts: {
    accountNumber: string;
    bankCode: string;
    accountName: string;
  }): Promise<string> {
    // FLW transfers use account details directly — no recipient ID needed
    // Just return a composite key for reference
    return `${opts.bankCode}:${opts.accountNumber}`;
  }

  // ── Transfer to Provider ──────────────────────────────────────────────────
  static async transferToProvider(opts: {
    bookingId: string;
    providerQuoteKobo: number;
    bookingReference: string;
    accountNumber: string;
    bankCode: string;
    accountName: string;
  }): Promise<void> {
    const amountNaira = opts.providerQuoteKobo / 100;

    const res = await fetch(`${FLW_BASE}/transfers`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        account_bank:    opts.bankCode,
        account_number:  opts.accountNumber,
        amount:          amountNaira,
        narration:       `Staxz payout - ${opts.bookingReference}`,
        currency:        'NGN',
        reference:       `payout_${opts.bookingId}_${Date.now()}`,
        callback_url:    `${process.env.API_BASE_URL}/api/v1/webhooks/flutterwave`,
        debit_currency:  'NGN',
      }),
    });
    const data = await res.json() as any;
    logger.info({ bookingId: opts.bookingId, data }, 'FLW transfer to provider');

    if (data.status !== 'success') {
      throw new Error(data.message ?? 'Transfer failed');
    }
  }

  // ── Refund ────────────────────────────────────────────────────────────────
  static async refundHirer(opts: { flwRef: string; amountKobo: number }): Promise<void> {
    const res = await fetch(`${FLW_BASE}/transactions/${opts.flwRef}/refund`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ amount: opts.amountKobo / 100 }),
    });
    const data = await res.json() as any;
    logger.info({ flwRef: opts.flwRef, data }, 'FLW refund');

    if (data.status !== 'success') throw new Error(data.message ?? 'Refund failed');
  }

  // ── Verify Webhook ────────────────────────────────────────────────────────
  static verifyWebhook(signature: string, payload: string): boolean {
    const crypto = require('crypto');
    const hash = crypto.createHmac('sha256', process.env.FLW_SECRET_HASH!)
      .update(payload)
      .digest('hex');
    return hash === signature;
  }

  // ── Get Banks ─────────────────────────────────────────────────────────────
  static async getBanks(): Promise<{ id: number; code: string; name: string }[]> {
    const res = await fetch(`${FLW_BASE}/banks/NG`, { headers: headers() });
    const data = await res.json() as any;
    return data.data ?? [];
  }
}