import { db } from '../config/database';
import { ProviderModel } from '../models/provider.model';
import { WithdrawalModel } from '../models/withdrawal.model';
import { NotificationService } from './notification.service';
import { PaystackService } from './paystack.service';
import { WithdrawalStatus, NotificationType } from '../types';
import { AppError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

const MIN_WITHDRAWAL_KOBO = 100_000; // ₦1,000 minimum

export class WithdrawalService {
  /**
   * Calculate how much a provider can currently withdraw.
   * Available = total completed earnings - total completed withdrawals - pending withdrawals
   */
  static async getAvailableBalance(providerId: string): Promise<{
    availableKobo: number;
    pendingEscrowKobo: number;
    totalEarnedKobo: number;
    totalWithdrawnKobo: number;
  }> {
    const [earningsRes, pendingWithdrawalsRes] = await Promise.all([
      db.query<{
        total_earned: string;
        pending_escrow: string;
      }>(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'completed' AND escrow_released = true
                       THEN provider_quote_kobo ELSE 0 END), 0) AS total_earned,
          COALESCE(SUM(CASE WHEN status IN ('confirmed','in_progress')
                       THEN provider_quote_kobo ELSE 0 END), 0) AS pending_escrow
         FROM bookings WHERE provider_id = $1`,
        [providerId]
      ),
      db.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_kobo), 0) AS total
         FROM withdrawals
         WHERE provider_id = $1 AND status IN ('pending', 'processing', 'completed')`,
        [providerId]
      ),
    ]);

    const totalEarned  = parseInt(earningsRes.rows[0]?.total_earned  ?? '0', 10);
    const pendingEscrow = parseInt(earningsRes.rows[0]?.pending_escrow ?? '0', 10);
    const totalWithdrawn = parseInt(pendingWithdrawalsRes.rows[0]?.total ?? '0', 10);
    const available = Math.max(0, totalEarned - totalWithdrawn);

    return {
      availableKobo: available,
      pendingEscrowKobo: pendingEscrow,
      totalEarnedKobo: totalEarned,
      totalWithdrawnKobo: totalWithdrawn,
    };
  }

  /**
   * Initiate a withdrawal for a provider.
   * Validates balance, creates a withdrawal record, triggers Paystack transfer.
   */
  static async initiateWithdrawal(
    providerId: string,
    amountKobo: number
  ): Promise<{ withdrawalId: string; amountKobo: number; status: WithdrawalStatus }> {
    const provider = await ProviderModel.findById(providerId);
    if (!provider) throw new NotFoundError('Provider');

    if (!provider.paystack_recipient_code) {
      throw new AppError(
        'Bank account not linked. Please update your bank details in settings.',
        400,
        'NO_RECIPIENT_CODE'
      );
    }

    if (amountKobo < MIN_WITHDRAWAL_KOBO) {
      throw new AppError(
        `Minimum withdrawal is ₦${(MIN_WITHDRAWAL_KOBO / 100).toLocaleString()}`,
        400
      );
    }

    const balance = await this.getAvailableBalance(providerId);
    if (amountKobo > balance.availableKobo) {
      throw new AppError(
        `Insufficient balance. Available: ₦${(balance.availableKobo / 100).toLocaleString()}`,
        400,
        'INSUFFICIENT_BALANCE'
      );
    }

    const withdrawal = await WithdrawalModel.create({ provider_id: providerId, amount_kobo: amountKobo });

    // Initiate Paystack transfer
    try {
      const transfer = await PaystackService.initiateTransfer({
        amountKobo,
        recipientCode: provider.paystack_recipient_code,
        reference: `WD-${withdrawal.id.slice(0, 8).toUpperCase()}`,
        reason: `Staxz withdrawal — ${new Date().toLocaleDateString('en-NG')}`,
      });

      await WithdrawalModel.update(withdrawal.id, {
        status: WithdrawalStatus.PROCESSING,
        paystack_transfer_code: transfer.transferCode,
        paystack_transfer_ref: transfer.reference,
      });

      await NotificationService.sendToUser(provider.user_id, {
        title: 'Withdrawal Initiated 💸',
        body: `₦${(amountKobo / 100).toLocaleString()} is being transferred to your bank account.`,
        type: NotificationType.PAYMENT_RELEASED,
        data: { withdrawalId: withdrawal.id },
      });

      logger.info({ providerId, amountKobo, withdrawalId: withdrawal.id }, 'Withdrawal initiated');
      return { withdrawalId: withdrawal.id, amountKobo, status: WithdrawalStatus.PROCESSING };
    } catch (err) {
      // Mark as failed so provider knows and can retry
      await WithdrawalModel.update(withdrawal.id, {
        status: WithdrawalStatus.FAILED,
        failure_reason: err instanceof Error ? err.message : 'Transfer failed',
      });
      throw err;
    }
  }

  /** Called by Paystack transfer webhook on success/failure */
  static async handleTransferWebhook(
    transferCode: string,
    status: 'success' | 'failed',
    failureReason?: string
  ): Promise<void> {
    const { rows } = await db.query<{ id: string; provider_id: string; amount_kobo: number }>(
      `SELECT id, provider_id, amount_kobo FROM withdrawals WHERE paystack_transfer_code = $1`,
      [transferCode]
    );
    const withdrawal = rows[0];
    if (!withdrawal) return;

    if (status === 'success') {
      await WithdrawalModel.update(withdrawal.id, {
        status: WithdrawalStatus.COMPLETED,
        completed_at: new Date(),
      });

      const provider = await ProviderModel.findById(withdrawal.provider_id);
      if (provider) {
        await NotificationService.sendToUser(provider.user_id, {
          title: 'Withdrawal Successful ✅',
          body: `₦${(withdrawal.amount_kobo / 100).toLocaleString()} has landed in your bank account.`,
          type: NotificationType.PAYMENT_RELEASED,
          data: { withdrawalId: withdrawal.id },
        });
      }
    } else {
      await WithdrawalModel.update(withdrawal.id, {
        status: WithdrawalStatus.FAILED,
        failure_reason: failureReason ?? 'Transfer failed',
      });

      const provider = await ProviderModel.findById(withdrawal.provider_id);
      if (provider) {
        await NotificationService.sendToUser(provider.user_id, {
          title: 'Withdrawal Failed ⚠️',
          body: `Your withdrawal of ₦${(withdrawal.amount_kobo / 100).toLocaleString()} failed. Please try again or contact support.`,
          type: NotificationType.GENERAL,
          data: { withdrawalId: withdrawal.id },
        });
      }
    }
  }
}
