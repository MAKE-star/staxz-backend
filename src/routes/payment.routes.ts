import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

router.get('/resolve-account', authenticate as never, PaymentController.resolveAccount as never);

router.post('/initiate',           authenticate as never, PaymentController.initiate as never);
router.post('/release/:bookingId', authenticate as never, requireAdmin as never, PaymentController.release as never);
router.post('/refund/:bookingId',  authenticate as never, requireAdmin as never, PaymentController.refund as never);

export default router;