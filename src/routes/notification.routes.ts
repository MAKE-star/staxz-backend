import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate as never);

router.get('/',              NotificationController.list    as never);
router.patch('/:id/read',   NotificationController.markRead as never);
router.patch('/read-all',   NotificationController.markAllRead as never);

export default router;
