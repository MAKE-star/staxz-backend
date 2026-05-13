import { Router } from 'express';
import { WebhookController } from '../controllers/webhook.controller';
import express from 'express';

const router = Router();

// Paystack needs the raw body for signature verification
router.post(
  '/paystack',
  express.raw({ type: 'application/json' }),
  (req, _res, next) => {
    (req as typeof req & { rawBody: string }).rawBody = req.body.toString();
    next();
  },
  WebhookController.paystackWebhook
);

router.get('/wati', WebhookController.watiVerify);
router.post('/wati', WebhookController.watiWebhook);

export default router;
