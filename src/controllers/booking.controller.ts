import { Response } from 'express';
import { BookingService } from '../services/booking.service';
import { BookingModel } from '../models/booking.model';
import { AuthenticatedRequest, UserRole, BookingStatus } from '../types';
import { sendSuccess, sendCreated, buildPagination, param } from '../utils/response';
import { NotFoundError, ForbiddenError } from '../utils/errors';

export class BookingController {
  static async createEnquiry(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { providerId, categoryId, serviceType, inspirationPhotoUrl, notes } = req.body;

    const enquiry = await BookingService.createEnquiry({
      hirerId: req.user.id,
      providerId,
      categoryId,
      serviceType,
      inspirationPhotoUrl,
      notes,
    });

    sendCreated(res, enquiry, 'Enquiry sent to provider');
  }

  static async getEnquiry(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { rows } = await require('../config/database').db.query(
      'SELECT * FROM enquiries WHERE id = $1',
      [param(req.params.id)]
    );
    const enquiry = rows[0];
    if (!enquiry) throw new NotFoundError('Enquiry');
    if (enquiry.hirer_id !== req.user.id && req.user.role !== UserRole.ADMIN) {
      throw new ForbiddenError();
    }
    sendSuccess(res, enquiry);
  }

  static async acceptQuote(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { scheduled_at, service_address } = req.body as { scheduled_at?: string; service_address?: string };
    const result = await BookingService.acceptQuoteAndPay(
      req.params['id'] as string,
      req.user.id,
      {
        scheduledAt: scheduled_at ? new Date(scheduled_at) : undefined,
        serviceAddress: service_address,
      }
    );
    sendCreated(res, result, 'Booking created. Proceed to payment.');
  }

  static async listBookings(req: AuthenticatedRequest, res: Response): Promise<void> {
    const page = parseInt((req.query.page as string) ?? '1', 10);
    const limit = parseInt((req.query.limit as string) ?? '20', 10);
    const role = req.user.role === UserRole.PROVIDER ? 'provider' : 'hirer';

    const result = await BookingModel.listForUser(req.user.id, role, page, limit);
    sendSuccess(res, result.rows, 200, undefined, buildPagination(page, limit, result.total));
  }

  static async getBooking(req: AuthenticatedRequest, res: Response): Promise<void> {
    const booking = await BookingModel.findById(param(req.params.id));
    if (!booking) throw new NotFoundError('Booking');

    const isHirer = booking.hirer_id === req.user.id;
    const isAdmin = req.user.role === UserRole.ADMIN;

    // Provider check (resolve provider.user_id)
    if (!isHirer && !isAdmin) {
      const { rows } = await require('../config/database').db.query(
        'SELECT user_id FROM providers WHERE id = $1',
        [booking.provider_id]
      );
      if (!rows[0] || rows[0].user_id !== req.user.id) throw new ForbiddenError();
    }

    // Spec §8.1: Provider contact details (address) masked until payment confirmed.
    // pending_payment state = address null for everyone except admin.
    const paymentConfirmed = ![BookingStatus.PENDING_PAYMENT].includes(booking.status);
    const safeBooking = isAdmin || paymentConfirmed
      ? booking
      : { ...booking, service_address: null };

    sendSuccess(res, safeBooking);
  }

  static async markComplete(req: AuthenticatedRequest, res: Response): Promise<void> {
    await BookingService.markComplete(param(req.params.id), req.user.id);
    sendSuccess(res, null, 200, 'Service marked as complete. Awaiting client confirmation.');
  }

  static async confirmComplete(req: AuthenticatedRequest, res: Response): Promise<void> {
    await BookingService.confirmComplete(param(req.params.id), req.user.id);
    sendSuccess(res, null, 200, 'Service confirmed. Payment released to provider.');
  }

  static async cancel(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await BookingService.cancel(param(req.params.id), req.user.id);
    const message = result.isLateCancellation
      ? 'Booking cancelled. A 20% cancellation fee was applied.'
      : 'Booking cancelled. Full refund issued.';
    sendSuccess(res, result, 200, message);
  }

  static async raiseDispute(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { reason, details } = req.body;
    const dispute = await BookingService.raiseDispute(param(req.params.id), req.user.id, reason, details);
    sendCreated(res, dispute, 'Dispute raised. Funds frozen pending review.');
  }

  static async leaveReview(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { stars, body } = req.body;
    const reviewerRole = req.user.role === UserRole.PROVIDER ? 'provider' : 'hirer';
    const review = await BookingService.leaveReview(req.params['id'] as string, req.user.id, reviewerRole, stars, body);
    sendCreated(res, review, 'Review submitted');
  }
}
