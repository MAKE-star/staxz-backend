import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import {
  requestOtpSchema,
  verifyOtpSchema,
  refreshSchema,
  updateProfileSchema,
  pushTokenSchema,
} from '../validators';
import rateLimit from 'express-rate-limit';

const router = Router();

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many OTP requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/request-otp', otpLimiter, validate(requestOtpSchema), AuthController.requestOtp);
router.post('/verify-otp', validate(verifyOtpSchema), AuthController.verifyOtp);
router.post('/refresh', validate(refreshSchema), AuthController.refresh);
router.post('/logout', validate(refreshSchema), AuthController.logout);

// Protected
router.get('/me', authenticate as never, AuthController.me as never);
router.put('/me', authenticate as never, validate(updateProfileSchema), AuthController.updateMe as never);

// Push notification token registration
router.post('/push-token', authenticate as never, validate(pushTokenSchema), AuthController.registerPushToken as never);
router.delete('/push-token', authenticate as never, validate(pushTokenSchema), AuthController.deregisterPushToken as never);

export default router;
