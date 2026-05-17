import { Response, Request, NextFunction } from 'express';
import { PaystackService } from '../services/paystack.service';
import { BookingModel } from '../models/booking.model';
import { BookingStatus, AuthenticatedRequest, UserRole } from '../types';
import { sendSuccess } from '../utils/response';
import { NotFoundError, ForbiddenError, AppError } from '../utils/errors';
import { db } from '../config/database';
import { TransactionModel } from '../models/dispute.model';
import { TransactionType } from '../types';

export class PaymentController {
  /** POST /payments/initiate — create Paystack session from an accepted enquiry */
  static async initiate(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { enquiryId } = req.body as { enquiryId: string };

    const { rows } = await db.query(
      'SELECT * FROM enquiries WHERE id = $1',
      [enquiryId]
    );
    const enquiry = rows[0];
    if (!enquiry) throw new NotFoundError('Enquiry');
    if (enquiry.hirer_id !== req.user.id) throw new ForbiddenError();
    if (enquiry.status !== 'quoted') throw new AppError('Enquiry has no active quote', 400);
    if (!enquiry.quote_kobo) throw new AppError('Quote amount missing', 400);

    // If booking already exists for this enquiry, use it
    const { rows: bookingRows } = await db.query(
      `SELECT b.* FROM bookings b
       JOIN enquiries e ON e.hirer_id = b.hirer_id AND e.provider_id = b.provider_id
       WHERE e.id = $1 AND b.status = 'pending_payment'`,
      [enquiryId]
    );

    if (bookingRows.length) {
      // Re-initiate payment for existing booking
      const booking = bookingRows[0];
      const hirer = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
      const payment = await PaystackService.initiatePayment({
        email: `${hirer.rows[0].phone.replace('+', '')}@staxz.app`,
        amountKobo: booking.total_charged_kobo,
        reference: booking.reference,
        metadata: { booking_id: booking.id },
      });
      sendSuccess(res, { paymentUrl: payment.authorizationUrl, reference: payment.reference, bookingId: booking.id });
      return;
    }

    // Delegate to booking service to create booking + return URL
    const { BookingService } = await import('../services/booking.service');
    const result = await BookingService.acceptQuoteAndPay(enquiryId, req.user.id);
    sendSuccess(res, { paymentUrl: result.paymentUrl, bookingId: result.booking.id });
  }

  /** POST /payments/release/:bookingId — admin manually releases escrow */
  static async release(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (req.user.role !== UserRole.ADMIN) throw new ForbiddenError();

    const booking = await BookingModel.findById(String(req.params.bookingId));
    if (!booking) throw new NotFoundError('Booking');
    if (booking.escrow_released) throw new AppError('Escrow already released', 409);
    if (![BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS, BookingStatus.DISPUTED].includes(booking.status)) {
      throw new AppError('Booking is not in a releasable state', 400);
    }

    await db.transaction(async (client) => {
      await BookingModel.updateStatus(
        booking.id, BookingStatus.COMPLETED,
        { escrow_released: true, confirmed_at: new Date() },
        client
      );
      await PaystackService.transferToProvider({
        bookingId: booking.id,
        providerQuoteKobo: booking.provider_quote_kobo,
        bookingReference: booking.reference,
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

  /** POST /payments/refund/:bookingId — admin issues refund to hirer */
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
      await PaystackService.refundHirer({ paystackRef: booking.paystack_ref!, amountKobo: refundAmount });
      await TransactionModel.create({
        booking_id: booking.id,
        type: TransactionType.REFUND,
        amount_kobo: refundAmount,
        paystack_ref: booking.paystack_ref,
        status: 'initiated',
        metadata: { refunded_by: req.user.id, full_amount: !amountKobo },
      }, client);
    });

    sendSuccess(res, null, 200, `Refund of ₦${(refundAmount / 100).toLocaleString('en-NG')} initiated`);
  }

  static resolveAccount = async (req: Request<object, object, object, { account_number: string; bank_code: string }>, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { account_number, bank_code } = req.query;
      if (!account_number || !bank_code) {
        res.status(400).json({ success: false, error: 'account_number and bank_code are required' });
        return;
      }

      const paystackRes = await fetch(
        `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
        { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
      );
      const data = await paystackRes.json() as any;

      if (!paystackRes.ok || !data.status) {
        res.status(422).json({ success: false, error: 'Could not resolve account' });
        return;
      }

      res.json({ success: true, data: { account_name: data.data.account_name, account_number: data.data.account_number } });
    } catch (err) {
      next(err);
    }
  };
}