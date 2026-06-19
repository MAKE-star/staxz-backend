import { Request, Response } from 'express';
import { FlutterwaveService } from '../services/flutterwave.service';
import { BookingModel } from '../models/booking.model';
import { BookingStatus } from '../types';
import { db } from '../config/database';
import { logger } from '../utils/logger';

export class FlutterwaveWebhookController {
  static async handle(req: Request, res: Response): Promise<void> {
    const signature = req.headers['verif-hash'] as string;

    if (!signature || signature !== process.env.FLW_SECRET_HASH) {
      logger.warn('Invalid Flutterwave webhook signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const event = req.body;
    logger.info({ event: event.event, data: event.data }, 'FLW webhook received');

    // Payment successful
    if (event.event === 'charge.completed' && event.data.status === 'successful') {
      const reference = event.data.tx_ref;
      const amountNaira = event.data.amount;

      // Find booking by reference
      const { rows } = await db.query(
        'SELECT * FROM bookings WHERE reference = $1',
        [reference]
      );
      const booking = rows[0];

      if (booking && booking.status === BookingStatus.PENDING_PAYMENT) {
        await BookingModel.updateStatus(booking.id, BookingStatus.CONFIRMED, {
          paystack_ref: String(event.data.id), // store FLW transaction ID
          confirmed_at: new Date(),
        });
        logger.info({ bookingId: booking.id, reference }, '✅ Payment confirmed — booking activated');
      }
    }

    // Transfer completed (payout to provider)
    if (event.event === 'transfer.completed') {
      logger.info({ data: event.data }, 'Provider payout completed');
    }

    res.status(200).json({ status: 'ok' });
  }
}