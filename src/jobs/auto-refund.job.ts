import { db } from '../config/database';
import { BookingModel } from '../models/booking.model';
import { DisputeModel } from '../models/dispute.model';
import { PaystackService } from '../services/paystack.service';
import { TransactionModel } from '../models/dispute.model';
import { NotificationService } from '../services/notification.service';
import { BookingStatus, DisputeStatus, TransactionType } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Runs every 30 minutes.
 * Auto-refunds hirers on disputes that have been open for
 * AUTO_REFUND_AFTER_HOURS (default 48h) with no admin action.
 */
export async function runAutoRefundJob(): Promise<void> {
  logger.debug('Running auto-refund job');

  const cutoff = new Date(
    Date.now() - config.booking.autoRefundAfterHours * 60 * 60 * 1000
  );

  const { rows: staleDisputes } = await db.query(
    `SELECT d.*, b.hirer_id, b.provider_id, b.total_charged_kobo, b.paystack_ref, b.reference
     FROM disputes d
     JOIN bookings b ON b.id = d.booking_id
     WHERE d.status = $1
       AND d.created_at < $2`,
    [DisputeStatus.OPEN, cutoff]
  );

  if (!staleDisputes.length) return;

  logger.warn({ count: staleDisputes.length }, '⚠️ Auto-refunding stale disputes');

  for (const dispute of staleDisputes) {
    try {
      await db.transaction(async (client) => {
        await BookingModel.updateStatus(dispute.booking_id, BookingStatus.REFUNDED, {}, client);
        await DisputeModel.resolve(
          dispute.id,
          DisputeStatus.RESOLVED_REFUND,
          'system',
          `Auto-refunded after ${config.booking.autoRefundAfterHours}h with no admin action`
        );
        await TransactionModel.create({
          booking_id: dispute.booking_id,
          type: TransactionType.REFUND,
          amount_kobo: dispute.total_charged_kobo,
          paystack_ref: null,
          status: 'initiated',
          metadata: { reason: 'auto_refund_dispute_timeout', dispute_id: dispute.id },
        }, client);

        // Spec §2.3: Flag the provider account after no-show auto-refund
        await client.query(
          `UPDATE providers SET
             is_flagged = true,
             flag_reason = $1
           WHERE id = $2`,
          [
            `Auto-flagged: no-show on booking ${dispute.reference}. Dispute unresolved after ${config.booking.autoRefundAfterHours}h.`,
            dispute.provider_id,
          ]
        );
      });

      await PaystackService.refundHirer({
        paystackRef: dispute.paystack_ref,
        amountKobo: dispute.total_charged_kobo,
      });

      // Spec §1.3: Flag the provider account after no-show auto-refund
      await db.query(
        `UPDATE providers SET is_live = false WHERE id = (
           SELECT provider_id FROM bookings WHERE id = $1
         )`,
        [dispute.booking_id]
      );

      await NotificationService.sendToUser(dispute.hirer_id, {
        title: 'Refund Issued ✅',
        body: `Your dispute for booking ${dispute.reference} was automatically resolved. Full refund issued.`,
        data: { bookingId: dispute.booking_id, type: 'auto_refund' },
      });

      logger.info({ disputeId: dispute.id, bookingId: dispute.booking_id }, 'Auto-refund issued');
    } catch (err) {
      logger.error({ err, disputeId: dispute.id }, 'Auto-refund failed');
    }
  }
}
