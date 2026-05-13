import { Request, Response } from 'express';
import { db } from '../config/database';
import { BookingModel } from '../models/booking.model';
import { DisputeModel } from '../models/dispute.model';
import { UserModel } from '../models/user.model';
import { PaystackService } from '../services/paystack.service';
import { BookingStatus, DisputeStatus, AuthenticatedRequest } from '../types';
import { sendSuccess, buildPagination } from '../utils/response';
import { NotFoundError, ConflictError } from '../utils/errors';

export class AdminController {
  static async getDashboard(_req: Request, res: Response): Promise<void> {
    const [bookings, revenue, disputes, users] = await Promise.all([
      db.query<{ count: string; status: string }>(
        'SELECT status, COUNT(*) FROM bookings GROUP BY status'
      ),
      db.query<{ total: string }>(
        `SELECT COALESCE(SUM(platform_fee_kobo), 0) as total
         FROM bookings WHERE status = 'completed'`
      ),
      db.query<{ count: string }>(
        `SELECT COUNT(*) FROM disputes WHERE status IN ('open', 'reviewing')`
      ),
      db.query<{ count: string }>(
        'SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL \'30 days\''
      ),
    ]);

    sendSuccess(res, {
      bookingsByStatus: Object.fromEntries(
        bookings.rows.map((r) => [r.status, parseInt(r.count, 10)])
      ),
      platformRevenue: parseInt(revenue.rows[0]?.total ?? '0', 10),
      openDisputes: parseInt(disputes.rows[0]?.count ?? '0', 10),
      newUsers30d: parseInt(users.rows[0]?.count ?? '0', 10),
    });
  }

  static async listDisputes(_req: Request, res: Response): Promise<void> {
    const disputes = await DisputeModel.listOpen();
    sendSuccess(res, disputes);
  }

  static async resolveDispute(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { action, note } = req.body as {
      action: 'refund_hirer' | 'release_escrow';
      note: string;
    };

    const dispute = await DisputeModel.findByBookingId(String(req.params.bookingId));
    if (!dispute) throw new NotFoundError('Dispute');
    if (!['open', 'reviewing'].includes(dispute.status)) {
      throw new ConflictError('Dispute already resolved');
    }

    const booking = await BookingModel.findById(dispute.booking_id);
    if (!booking) throw new NotFoundError('Booking');

    if (action === 'refund_hirer') {
      await PaystackService.refundHirer({
        paystackRef: booking.paystack_ref!,
        amountKobo: booking.total_charged_kobo,
      });
      await BookingModel.updateStatus(booking.id, BookingStatus.REFUNDED);
      await DisputeModel.resolve(dispute.id, DisputeStatus.RESOLVED_REFUND, req.user.id, note);
    } else {
      await PaystackService.transferToProvider({
        bookingId: booking.id,
        providerQuoteKobo: booking.provider_quote_kobo,
        bookingReference: booking.reference,
      });
      await BookingModel.updateStatus(booking.id, BookingStatus.COMPLETED, { escrow_released: true });
      await DisputeModel.resolve(dispute.id, DisputeStatus.RESOLVED_RELEASED, req.user.id, note);
    }

    sendSuccess(res, null, 200, `Dispute resolved: ${action}`);
  }

  static async listUsers(req: Request, res: Response): Promise<void> {
    const page = parseInt((req.query.page as string) ?? '1', 10);
    const limit = parseInt((req.query.limit as string) ?? '50', 10);
    const role = req.query.role as string | undefined;
    const offset = (page - 1) * limit;

    const conditions = role ? `WHERE role = $3` : '';
    const values: unknown[] = [limit, offset];
    if (role) values.push(role);

    const [countRes, dataRes] = await Promise.all([
      db.query<{ count: string }>(
        `SELECT COUNT(*) FROM users ${role ? 'WHERE role = $1' : ''}`,
        role ? [role] : []
      ),
      db.query(
        `SELECT u.*, p.business_name, p.is_live, p.rating_avg
         FROM users u
         LEFT JOIN providers p ON p.user_id = u.id
         ${conditions}
         ORDER BY u.created_at DESC
         LIMIT $1 OFFSET $2`,
        values
      ),
    ]);

    sendSuccess(
      res, dataRes.rows, 200, undefined,
      buildPagination(page, limit, parseInt(countRes.rows[0]?.count ?? '0', 10))
    );
  }

  static async suspendUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = await UserModel.findById(String(req.params.id));
    if (!user) throw new NotFoundError('User');
    await UserModel.setActive(user.id, false);
    sendSuccess(res, null, 200, 'User suspended');
  }

  static async reinstateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = await UserModel.findById(String(req.params.id));
    if (!user) throw new NotFoundError('User');
    await UserModel.setActive(user.id, true);
    sendSuccess(res, null, 200, 'User reinstated');
  }

  static async flagUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { reason } = req.body as { reason?: string };
    const user = await UserModel.findById(String(req.params.id));
    if (!user) throw new NotFoundError('User');
    await db.query(
      'UPDATE users SET is_flagged = true, flag_reason = $1 WHERE id = $2',
      [reason ?? 'Flagged by admin', user.id]
    );
    sendSuccess(res, null, 200, 'User flagged');
  }

  static async unflagUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = await UserModel.findById(String(req.params.id));
    if (!user) throw new NotFoundError('User');
    await db.query('UPDATE users SET is_flagged = false, flag_reason = NULL WHERE id = $1', [user.id]);
    sendSuccess(res, null, 200, 'User flag removed');
  }
}

// ─── APPENDED: conversations + analytics ──────────────────────────────────────

export class AdminConversationController {
  static async listConversations(req: Request, res: Response): Promise<void> {
    const { ConversationModel } = await import('../models/conversation.model');
    const page    = parseInt((req.query.page as string) ?? '1', 10);
    const limit   = parseInt((req.query.limit as string) ?? '30', 10);
    const dispute = req.query.dispute === 'true';

    const result = await ConversationModel.listAll(page, limit, { hasDispute: dispute });
    sendSuccess(res, result.rows, 200, undefined, buildPagination(page, limit, result.total));
  }

  static async getConversation(req: Request, res: Response): Promise<void> {
    const { ConversationModel } = await import('../models/conversation.model');
    const messages = await ConversationModel.findByBookingId(req.params.bookingId as string);
    sendSuccess(res, messages);
  }

  static async getAnalytics(_req: Request, res: Response): Promise<void> {
    const [completion, responseR, disputeR, escrowR, gmv, escrowBal, topProviders, revenue] =
      await Promise.all([
        db.query<{ rate: string }>(`SELECT ROUND(100.0*COUNT(CASE WHEN status='completed' THEN 1 END)/NULLIF(COUNT(CASE WHEN status NOT IN('pending_payment','cancelled') THEN 1 END),0),1) AS rate FROM bookings`),
        db.query<{ rate: string }>(`SELECT ROUND(100.0*COUNT(CASE WHEN status!='expired' THEN 1 END)/NULLIF(COUNT(*),0),1) AS rate FROM enquiries WHERE created_at>NOW()-INTERVAL'30 days'`),
        db.query<{ rate: string }>(`SELECT ROUND(100.0*COUNT(CASE WHEN status='disputed' THEN 1 END)/NULLIF(COUNT(CASE WHEN status NOT IN('pending_payment','cancelled') THEN 1 END),0),1) AS rate FROM bookings`),
        db.query<{ rate: string }>(`SELECT ROUND(100.0*COUNT(CASE WHEN escrow_released=true THEN 1 END)/NULLIF(COUNT(CASE WHEN status IN('completed','disputed') THEN 1 END),0),1) AS rate FROM bookings`),
        db.query<{ gmv: string }>(`SELECT COALESCE(SUM(total_charged_kobo),0) AS gmv FROM bookings WHERE status NOT IN('pending_payment','cancelled')`),
        db.query<{ balance: string }>(`SELECT COALESCE(SUM(total_charged_kobo),0) AS balance FROM bookings WHERE status IN('confirmed','in_progress','disputed')`),
        db.query(`SELECT p.business_name,p.id,COUNT(b.id) AS booking_count,SUM(b.provider_quote_kobo) AS revenue_kobo,p.rating_avg FROM bookings b JOIN providers p ON p.id=b.provider_id WHERE b.status='completed' AND b.confirmed_at>=DATE_TRUNC('month',NOW()) GROUP BY p.id,p.business_name,p.rating_avg ORDER BY revenue_kobo DESC LIMIT 5`),
        db.query(`SELECT COALESCE(SUM(platform_fee_kobo),0) AS platform_fees_kobo,COALESCE(SUM(provider_quote_kobo),0) AS provider_payouts_kobo FROM bookings WHERE status='completed'`),
      ]);

    sendSuccess(res, {
      rates: {
        bookingCompletion: parseFloat(completion.rows[0]?.rate ?? '0'),
        providerResponse:  parseFloat(responseR.rows[0]?.rate  ?? '0'),
        dispute:           parseFloat(disputeR.rows[0]?.rate   ?? '0'),
        escrowRelease:     parseFloat(escrowR.rows[0]?.rate    ?? '0'),
      },
      financials: {
        gmvKobo:            parseInt(gmv.rows[0]?.gmv       ?? '0', 10),
        escrowBalanceKobo:  parseInt(escrowBal.rows[0]?.balance ?? '0', 10),
        platformFeesKobo:   parseInt((revenue.rows[0] as { platform_fees_kobo: string })?.platform_fees_kobo ?? '0', 10),
        providerPayoutsKobo: parseInt((revenue.rows[0] as { provider_payouts_kobo: string })?.provider_payouts_kobo ?? '0', 10),
      },
      topProviders: topProviders.rows,
    });
  }
}
