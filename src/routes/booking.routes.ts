import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { BookingController } from '../controllers/booking.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import {
  createEnquirySchema,
  raiseDisputeSchema,
  leaveReviewSchema,
  acceptQuoteSchema,
} from '../validators';

const router = Router();

// All booking routes require auth
router.use(authenticate as never);

// Spec §8.4: max 10 enquiries per hirer per hour
const enquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req as typeof req & { user: { id: string } }).user.id,
  message: { success: false, error: 'Too many enquiries — max 10 per hour', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Enquiries
router.post('/enquiries', enquiryLimiter, validate(createEnquirySchema), BookingController.createEnquiry as never);
router.get('/enquiries/:id', BookingController.getEnquiry as never);
router.post('/enquiries/:id/accept', validate(acceptQuoteSchema), BookingController.acceptQuote as never);

// Bookings
router.get('/bookings', BookingController.listBookings as never);
router.get('/bookings/:id', BookingController.getBooking as never);
router.post('/bookings/:id/complete', BookingController.markComplete as never);
router.post('/bookings/:id/confirm', BookingController.confirmComplete as never);
router.post('/bookings/:id/cancel', BookingController.cancel as never);
router.post('/bookings/:id/dispute', validate(raiseDisputeSchema), BookingController.raiseDispute as never);
router.post('/bookings/:id/review', validate(leaveReviewSchema), BookingController.leaveReview as never);

export default router;
