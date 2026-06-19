import { Response, Request, NextFunction } from 'express';
import { FlutterwaveService } from '../services/flutterwave.service';
import { BookingModel } from '../models/booking.model';
import { BookingStatus, AuthenticatedRequest, UserRole } from '../types';
import { sendSuccess } from '../utils/response';
import { NotFoundError, ForbiddenError, AppError } from '../utils/errors';
import { db } from '../config/database';
import { TransactionModel } from '../models/dispute.model';
import { TransactionType } from '../types';

export class PaymentController {
  /** POST /payments/initiate */
  static async initiate(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { enquiryId } = req.body as { enquiryId: string };

    const { rows } = await db.query('SELECT * FROM enquiries WHERE id = $1', [enquiryId]);
    const enquiry = rows[0];
    if (!enquiry) throw new NotFoundError('Enquiry');
    if (enquiry.hirer_id !== req.user.id) throw new ForbiddenError();
    if (enquiry.status !== 'quoted') throw new AppError('Enquiry has no active quote', 400);
    if (!enquiry.quote_kobo) throw new AppError('Quote amount missing', 400);

    const { rows: bookingRows } = await db.query(
      `SELECT b.* FROM bookings b
       JOIN enquiries e ON e.hirer_id = b.hirer_id AND e.provider_id = b.provider_id
       WHERE e.id = $1 AND b.status = 'pending_payment'`,
      [enquiryId]
    );

    const redirectUrl = `${process.env.APP_SCHEME ?? 'staxz'}://payment-callback`;

    if (bookingRows.length) {
      const booking = bookingRows[0];
      const { rows: hirerRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
      const email = `${hirerRows[0].phone.replace('+', '')}@staxz.app`;
      const payment = await FlutterwaveService.initiatePayment({
        email,
        amountKobo: booking.total_charged_kobo,
        reference: booking.reference,
        redirectUrl,
        metadata: { booking_id: booking.id },
      });
      sendSuccess(res, { paymentUrl: payment.paymentUrl, reference: payment.reference, bookingId: booking.id });
      return;
    }

    const { BookingService } = await import('../services/booking.service');
    const result = await BookingService.acceptQuoteAndPay(enquiryId, req.user.id);
    sendSuccess(res, { paymentUrl: result.paymentUrl, bookingId: result.booking.id });
  }

  /** POST /payments/release/:bookingId — admin releases escrow */
  static async release(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (req.user.role !== UserRole.ADMIN) throw new ForbiddenError();

    const booking = await BookingModel.findById(String(req.params.bookingId));
    if (!booking) throw new NotFoundError('Booking');
    if (booking.escrow_released) throw new AppError('Escrow already released', 409);
    if (![BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS, BookingStatus.DISPUTED].includes(booking.status)) {
      throw new AppError('Booking is not in a releasable state', 400);
    }

    // Get provider bank details
    const { rows: provRows } = await db.query(
      'SELECT bank_account_number, bank_code, bank_account_name FROM providers WHERE id = $1',
      [booking.provider_id]
    );
    const provider = provRows[0];
    if (!provider) throw new NotFoundError('Provider bank details');

    await db.transaction(async (client) => {
      await BookingModel.updateStatus(booking.id, BookingStatus.COMPLETED,
        { escrow_released: true, confirmed_at: new Date() }, client);

      await FlutterwaveService.transferToProvider({
        bookingId: booking.id,
        providerQuoteKobo: booking.provider_quote_kobo,
        bookingReference: booking.reference,
        accountNumber: provider.bank_account_number,
        bankCode: provider.bank_code,
        accountName: provider.bank_account_name,
      });

      await TransactionModel.create({
        booking_id: booking.id,
        type: TransactionType.ESCROW_RELEASE,
        amount_kobo: booking.provider_quote_kobo,
        paystack_ref: null,
        status: 'success',
        metadata: { released_by: req.user.id, manual: true },
      }, client);
    });

    sendSuccess(res, null, 200, `Escrow released — ₦${(booking.provider_quote_kobo / 100).toLocaleString('en-NG')} transferred to provider`);
  }

  /** POST /payments/refund/:bookingId — admin refunds hirer */
  static async refund(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (req.user.role !== UserRole.ADMIN) throw new ForbiddenError();

    const booking = await BookingModel.findById(String(req.params.bookingId));
    if (!booking) throw new NotFoundError('Booking');
    if (!booking.paystack_ref) throw new AppError('No payment reference on booking', 400);
    if (booking.status === BookingStatus.REFUNDED) throw new AppError('Already refunded', 409);

    const { amountKobo } = req.body as { amountKobo?: number };
    const refundAmount = amountKobo ?? booking.total_charged_kobo;

    await db.transaction(async (client) => {
      await BookingModel.updateStatus(booking.id, BookingStatus.REFUNDED, {}, client);
      await FlutterwaveService.refundHirer({ flwRef: booking.paystack_ref!, amountKobo: refundAmount });
      await TransactionModel.create({
        booking_id: booking.id,
        type: TransactionType.REFUND,
        amount_kobo: refundAmount,
        paystack_ref: booking.paystack_ref,
        status: 'initiated',
        metadata: { refunded_by: req.user.id },
      }, client);
    });

    sendSuccess(res, null, 200, `Refund of ₦${(refundAmount / 100).toLocaleString('en-NG')} initiated`);
  }

  /** GET /payments/resolve-account */
  static resolveAccount = async (
    req: Request<object, object, object, { account_number: string; bank_code: string }>,
    res: Response,
    // next: NextFunction
  ): Promise<void> => {
    try {
      const { account_number, bank_code } = req.query;
      if (!account_number || !bank_code) {
        res.status(400).json({ success: false, error: 'account_number and bank_code are required' });
        return;
      }
      const result = await FlutterwaveService.resolveAccount(account_number, bank_code);
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(422).json({
        success: false,
        error: e.message ?? 'Could not resolve account',
        fallback: true,
      });
    }
  };

  /** GET /payments/banks */
  static getBanks = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const banks = await FlutterwaveService.getBanks();
      res.json({ success: true, data: banks });
    } catch (e: any) {
      next(e);
    }
  };
}