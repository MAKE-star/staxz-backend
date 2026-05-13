import { db } from '../config/database';
import { NotificationService } from '../services/notification.service';
import { BookingStatus } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Runs every 5 minutes.
 * Cancels bookings that have been in pending_payment for
 * CLIENT_PAYMENT_TIMEOUT_MINS (default 30 mins) with no payment.
 */
export async function runPaymentExpiryJob(): Promise<void> {
  logger.debug('Running payment expiry job');

  const cutoff = new Date(
    Date.now() - config.booking.clientPaymentTimeoutMins * 60 * 1000
  );

  const { rows: expiredBookings } = await db.query(
    `UPDATE bookings
     SET status = $1, cancelled_at = NOW()
     WHERE status = $2
       AND created_at < $3
       AND paystack_ref IS NULL
     RETURNING id, hirer_id, provider_id, reference`,
    [BookingStatus.CANCELLED, BookingStatus.PENDING_PAYMENT, cutoff]
  );

  if (!expiredBookings.length) return;

  logger.info({ count: expiredBookings.length }, 'Expired unpaid bookings');

  for (const booking of expiredBookings) {
    // Notify hirer
    await NotificationService.sendToUser(booking.hirer_id, {
      title: 'Quote Expired',
      body: `Your booking ${booking.reference} was cancelled — payment not received within 30 minutes. Feel free to re-enquire.`,
      data: { bookingId: booking.id, type: 'payment_expired' },
    });

    // Notify provider
    const { rows } = await db.query(
      'SELECT user_id FROM providers WHERE id = $1',
      [booking.provider_id]
    );
    if (rows[0]) {
      await NotificationService.sendToUser(rows[0].user_id, {
        title: 'Booking Expired',
        body: `Client did not pay for booking ${booking.reference}. The slot is now free.`,
        data: { bookingId: booking.id, type: 'payment_expired' },
      });
    }
  }
}
