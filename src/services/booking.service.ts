import { config } from '../config';
import { db } from '../config/database';
import { BookingModel } from '../models/booking.model';
import { EnquiryModel } from '../models/enquiry.model';
import { ProviderModel } from '../models/provider.model';
import { ReviewModel } from '../models/review.model';
import { DisputeModel, TransactionModel } from '../models/dispute.model';
import { UserModel } from '../models/user.model';
import { PaystackService } from './paystack.service';
import { WhatsAppService } from './whatsapp.service';
import { NotificationService } from './notification.service';
import {
  BookingStatus, EnquiryStatus, DisputeStatus,
  TransactionType, ServiceMode
} from '../types';
import {
  NotFoundError, ForbiddenError, AppError, ConflictError
} from '../utils/errors';
import { logger } from '../utils/logger';

export class BookingService {
  /** STEP 1 — Client creates an enquiry */
  static async createEnquiry(data: {
    hirerId: string;
    providerId: string;
    categoryId: string;
    serviceType: ServiceMode;
    inspirationPhotoUrl?: string;
    notes?: string;
  }) {
    const provider = await ProviderModel.findById(data.providerId);
    if (!provider) throw new NotFoundError('Provider');
    if (!provider.is_live) throw new AppError('Provider is not currently accepting bookings', 400);
    if (!provider.service_modes.includes(data.serviceType)) {
      throw new AppError(`This provider does not offer ${data.serviceType} service`, 400);
    }

    // Send to WhatsApp bot — get conversation ID back
    const conversationId = await WhatsAppService.sendEnquiryToProvider({
      enquiryId: 'pending',
      hirerId: data.hirerId,
      providerId: data.providerId,
      providerWhatsApp: provider.whatsapp_number,
      categoryId: data.categoryId,
      serviceType: data.serviceType,
      inspirationPhotoUrl: data.inspirationPhotoUrl,
      notes: data.notes,
    });

    const enquiry = await EnquiryModel.create({
      hirer_id: data.hirerId,
      provider_id: data.providerId,
      category_id: data.categoryId,
      service_type: data.serviceType,
      inspiration_photo_url: data.inspirationPhotoUrl,
      notes: data.notes,
      wati_conversation_id: conversationId,
    });

    // Now log the WhatsApp message with the actual enquiry id (fire-and-forget)
    if (conversationId && conversationId !== 'pending') {
      void WhatsAppService.sendEnquiryToProvider({
        enquiryId: enquiry.id,
        hirerId: data.hirerId,
        providerId: data.providerId,
        providerWhatsApp: provider.whatsapp_number,
        categoryId: data.categoryId,
        serviceType: data.serviceType,
        inspirationPhotoUrl: data.inspirationPhotoUrl,
        notes: data.notes,
      });
    }

    logger.info({ enquiryId: enquiry.id, providerId: data.providerId }, 'Enquiry created');
    return enquiry;
  }

  /** STEP 2 — Provider replies via WhatsApp with a price (webhook handler) */
  static async receiveQuote(enquiryId: string, rawPrice: string) {
    const enquiry = await EnquiryModel.findById(enquiryId);
    if (!enquiry) throw new NotFoundError('Enquiry');
    if (enquiry.status !== EnquiryStatus.PENDING) {
      throw new ConflictError('Enquiry is no longer pending');
    }

    // Parse naira value from provider's WhatsApp reply
    const priceNaira = parseFloat(rawPrice.replace(/[^0-9.]/g, ''));
    if (isNaN(priceNaira) || priceNaira <= 0) {
      throw new AppError('Invalid price received from provider', 400);
    }

    const quoteKobo = Math.round(priceNaira * 100);
    const platformFeeKobo = Math.round(quoteKobo * (config.paystack.platformFeePercent / 100));
    const totalKobo = quoteKobo + platformFeeKobo;

    await EnquiryModel.setQuote(enquiryId, quoteKobo);

    // Notify hirer of quote via push notification
    const hirer = await UserModel.findById(enquiry.hirer_id);
    if (hirer) {
      await NotificationService.sendToUser(enquiry.hirer_id, {
        title: 'Quote Received 💰',
        body: `Your provider quoted ₦${(priceNaira).toLocaleString()}. Platform fee: ₦${(platformFeeKobo / 100).toLocaleString()}. Tap to pay.`,
        data: { enquiryId, totalKobo: String(totalKobo) },
      });
    }

    return { quoteKobo, platformFeeKobo, totalKobo };
  }

  /** STEP 3 — Client accepts quote → create booking → return Paystack URL */
  static async acceptQuoteAndPay(
    enquiryId: string,
    hirerId: string,
    opts: { scheduledAt?: Date; serviceAddress?: string } = {}
  ) {
    const enquiry = await EnquiryModel.findById(enquiryId);
    if (!enquiry) throw new NotFoundError('Enquiry');
    if (enquiry.hirer_id !== hirerId) throw new ForbiddenError();
    if (enquiry.status !== EnquiryStatus.QUOTED) {
      throw new ConflictError('No active quote for this enquiry');
    }
    if (enquiry.quote_kobo === null) throw new AppError('Quote amount missing', 500);

    const platformFeeKobo = Math.round(
      enquiry.quote_kobo * (config.paystack.platformFeePercent / 100)
    );
    const totalKobo = enquiry.quote_kobo + platformFeeKobo;

    const hirer = await UserModel.findById(hirerId);
    if (!hirer) throw new NotFoundError('User');

    // Create booking in pending_payment state inside a transaction
    const booking = await db.transaction(async (client) => {
      const b = await BookingModel.create(
        {
          hirer_id: hirerId,
          provider_id: enquiry.provider_id,
          service_type: enquiry.service_type as ServiceMode,
          provider_quote_kobo: enquiry.quote_kobo!,
          platform_fee_kobo: platformFeeKobo,
          total_charged_kobo: totalKobo,
          status: BookingStatus.PENDING_PAYMENT,
          scheduled_at: opts.scheduledAt ?? null,
          service_address: opts.serviceAddress ?? null,
          notes: enquiry.notes,
          paystack_ref: null,
        },
        client
      );

      await EnquiryModel.updateStatus(enquiryId, EnquiryStatus.ACCEPTED);
      return b;
    });

    // Initiate Paystack payment
    const payment = await PaystackService.initiatePayment({
      email: `${hirer.phone.replace('+', '')}@staxz.app`, // phone-based email
      amountKobo: totalKobo,
      reference: booking.reference,
      metadata: {
        booking_id: booking.id,
        booking_reference: booking.reference,
        hirer_id: hirerId,
        provider_id: enquiry.provider_id,
      },
    });

    // Store Paystack reference on booking
    await BookingModel.updateStatus(booking.id, BookingStatus.PENDING_PAYMENT, {
      paystack_ref: payment.reference,
    });

    logger.info({ bookingId: booking.id, reference: booking.reference }, 'Booking created, awaiting payment');
    return { booking, paymentUrl: payment.authorizationUrl };
  }

  /** STEP 4 — Paystack webhook: payment confirmed → unlock contact */
  static async onPaymentConfirmed(paystackRef: string, amountKobo: number) {
    const booking = await BookingModel.findByPaystackRef(paystackRef);
    if (!booking) {
      logger.warn({ paystackRef }, 'No booking found for Paystack ref');
      return;
    }
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      logger.warn({ bookingId: booking.id }, 'Payment webhook received but booking not in pending_payment');
      return;
    }

    await db.transaction(async (client) => {
      await BookingModel.updateStatus(
        booking.id,
        BookingStatus.CONFIRMED,
        { paystack_ref: paystackRef },
        client
      );

      await TransactionModel.create({
        booking_id: booking.id,
        type: TransactionType.PAYMENT,
        amount_kobo: amountKobo,
        paystack_ref: paystackRef,
        status: 'success',
        metadata: {},
      }, client);
    });

    // Now reveal provider contact to hirer (set service_address if home)
    const provider = await ProviderModel.findById(booking.provider_id);
    if (provider) {
      await NotificationService.sendToUser(booking.hirer_id, {
        title: 'Booking Confirmed ✓',
        body: `Your booking ${booking.reference} is confirmed. Provider contact: ${provider.whatsapp_number}`,
        data: { bookingId: booking.id, type: 'booking_confirmed' },
      });
      // Notify provider too
      await NotificationService.sendToUser(provider.user_id, {
        title: 'New Booking 💰',
        body: `Booking ${booking.reference} confirmed. Funds in escrow. Check your WhatsApp for details.`,
        data: { bookingId: booking.id, type: 'booking_confirmed' },
      });
    }

    logger.info({ bookingId: booking.id }, 'Payment confirmed, booking active');
  }

  /** STEP 5a — Provider marks service as complete */
  static async markComplete(bookingId: string, providerId: string) {
    const booking = await BookingModel.findById(bookingId);
    if (!booking) throw new NotFoundError('Booking');

    const provider = await ProviderModel.findByUserId(providerId);
    if (!provider || provider.id !== booking.provider_id) throw new ForbiddenError();
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictError('Booking cannot be marked complete in current state');
    }

    await BookingModel.updateStatus(bookingId, BookingStatus.IN_PROGRESS, {
      completed_at: new Date(),
    });

    await NotificationService.sendToUser(booking.hirer_id, {
      title: 'Service Complete — Confirm? ✨',
      body: 'Your provider marked the service as done. Tap to confirm and release payment.',
      data: { bookingId, type: 'service_complete' },
    });

    return booking;
  }

  /** STEP 5b — Client confirms completion → release escrow */
  static async confirmComplete(bookingId: string, hirerId: string) {
    const booking = await BookingModel.findById(bookingId);
    if (!booking) throw new NotFoundError('Booking');
    if (booking.hirer_id !== hirerId) throw new ForbiddenError();
    if (booking.status !== BookingStatus.IN_PROGRESS) {
      throw new ConflictError('Booking is not awaiting confirmation');
    }

    await db.transaction(async (client) => {
      await BookingModel.updateStatus(
        bookingId,
        BookingStatus.COMPLETED,
        { confirmed_at: new Date(), escrow_released: true },
        client
      );

      // Release 85% to provider via Paystack transfer
      await PaystackService.transferToProvider({
        bookingId,
        providerQuoteKobo: booking.provider_quote_kobo,
        bookingReference: booking.reference,
        recipientCode: provider?.paystack_recipient_code ?? undefined,
      });

      await TransactionModel.create({
        booking_id: bookingId,
        type: TransactionType.ESCROW_RELEASE,
        amount_kobo: booking.provider_quote_kobo,
        paystack_ref: null,
        status: 'success',
        metadata: { booking_reference: booking.reference },
      }, client);
    });

    const provider = await ProviderModel.findById(booking.provider_id);
    if (provider) {
      await NotificationService.sendToUser(provider.user_id, {
        title: 'Payment Released 💸',
        body: `₦${(booking.provider_quote_kobo / 100).toLocaleString()} has been transferred to your account.`,
        data: { bookingId, type: 'escrow_released' },
      });
    }

    logger.info({ bookingId }, 'Escrow released, booking completed');
    return booking;
  }

  /** Cancel booking with fee logic */
  static async cancel(bookingId: string, hirerId: string) {
    const booking = await BookingModel.findById(bookingId);
    if (!booking) throw new NotFoundError('Booking');
    if (booking.hirer_id !== hirerId) throw new ForbiddenError();
    if (![BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT].includes(booking.status)) {
      throw new ConflictError('Booking cannot be cancelled in current state');
    }

    const now = new Date();
    const lateWindowMs = config.booking.lateCancelWindowMins * 60 * 1000;
    const isLateCancellation = booking.scheduled_at
      ? (booking.scheduled_at.getTime() - now.getTime()) < lateWindowMs
      : false;

    await db.transaction(async (client) => {
      await BookingModel.updateStatus(
        bookingId,
        BookingStatus.CANCELLED,
        { cancelled_at: now },
        client
      );

      if (booking.status === BookingStatus.CONFIRMED) {
        const cancellationFeeKobo = isLateCancellation
          ? Math.round(booking.total_charged_kobo * (config.booking.lateCancelFeePercent / 100))
          : 0;
        const refundKobo = booking.total_charged_kobo - cancellationFeeKobo;

        await PaystackService.refundHirer({
          paystackRef: booking.paystack_ref!,
          amountKobo: refundKobo,
        });

        await TransactionModel.create({
          booking_id: bookingId,
          type: TransactionType.REFUND,
          amount_kobo: refundKobo,
          paystack_ref: null,
          status: 'initiated',
          metadata: { cancellation_fee_kobo: cancellationFeeKobo, late: isLateCancellation },
        }, client);
      }
    });

    return { isLateCancellation };
  }

  /** Raise a dispute — freeze escrow */
  static async raiseDispute(
    bookingId: string,
    hirerId: string,
    reason: string,
    details?: string
  ) {
    const booking = await BookingModel.findById(bookingId);
    if (!booking) throw new NotFoundError('Booking');
    if (booking.hirer_id !== hirerId) throw new ForbiddenError();
    if (![BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS].includes(booking.status)) {
      throw new ConflictError('Dispute cannot be raised in current booking state');
    }

    const existing = await DisputeModel.findByBookingId(bookingId);
    if (existing && existing.status === DisputeStatus.OPEN) {
      throw new ConflictError('A dispute is already open for this booking');
    }

    await db.transaction(async (client) => {
      await BookingModel.updateStatus(bookingId, BookingStatus.DISPUTED, {}, client);
      await DisputeModel.create({ booking_id: bookingId, raised_by: hirerId, reason, details });
    });

    // Notify admin team
    logger.warn({ bookingId, reason }, '🚨 Dispute raised');
    return DisputeModel.findByBookingId(bookingId);
  }

  /** Leave a review after completed booking — both parties can review each other */
  static async leaveReview(
    bookingId: string,
    reviewerId: string,
    reviewerRole: 'hirer' | 'provider',
    stars: number,
    body?: string
  ) {
    const booking = await BookingModel.findById(bookingId);
    if (!booking) throw new NotFoundError('Booking');
    if (booking.status !== BookingStatus.COMPLETED) {
      throw new ConflictError('Can only review completed bookings');
    }

    const provider = await ProviderModel.findById(booking.provider_id);
    if (!provider) throw new NotFoundError('Provider');

    let revieweeId: string;

    if (reviewerRole === 'hirer') {
      // Hirer reviews provider
      if (booking.hirer_id !== reviewerId) throw new ForbiddenError();
      revieweeId = provider.user_id;
    } else {
      // Provider reviews hirer
      if (provider.user_id !== reviewerId) throw new ForbiddenError();
      revieweeId = booking.hirer_id;
    }

    const existing = await ReviewModel.findByBookingAndReviewer(bookingId, reviewerId);
    if (existing) throw new ConflictError('You have already reviewed this booking');

    const review = await db.transaction(async (_client) => {
      const r = await ReviewModel.create({
        booking_id: bookingId,
        reviewer_id: reviewerId,
        reviewee_id: revieweeId,
        stars,
        body,
      });
      // Only recalculate provider rating when hirer is the reviewer
      if (reviewerRole === 'hirer') {
        await ProviderModel.recalculateRating(booking.provider_id);
      }
      return r;
    });

    return review;
  }
}
