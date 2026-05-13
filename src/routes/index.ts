import { Router } from 'express';
import authRoutes from './auth.routes';
import providerRoutes from './provider.routes';
import bookingRoutes from './booking.routes';
import webhookRoutes from './webhook.routes';
import adminRoutes from './admin.routes';
import notificationRoutes from './notification.routes';
import withdrawalRoutes from './withdrawal.routes';
import savedRoutes from './saved.routes';
import { db } from '../config/database';
import { redis } from '../config/redis';

const router = Router();

router.get('/health', async (_req, res) => {
  const [dbOk, redisOk] = await Promise.all([
    db.healthCheck(),
    redis.ping().then(() => true).catch(() => false),
  ]);
  const status = dbOk && redisOk ? 200 : 503;
  res.status(status).json({
    status: dbOk && redisOk ? 'ok' : 'degraded',
    services: { db: dbOk ? 'up' : 'down', redis: redisOk ? 'up' : 'down' },
    timestamp: new Date().toISOString(),
  });
});

router.use('/auth',          authRoutes);
router.use('/providers',     providerRoutes);
router.use('/enquiries',     bookingRoutes);
router.use('/bookings',      bookingRoutes);
router.use('/webhooks',      webhookRoutes);
router.use('/admin',         adminRoutes);
router.use('/notifications', notificationRoutes);
router.use('/withdrawals',   withdrawalRoutes);
router.use('/saved',         savedRoutes);

export default router;
