import { Router } from 'express';
import { AdminController, AdminConversationController } from '../controllers/admin.controller';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { resolveDisputeSchema } from '../validators';

const router = Router();

router.use(authenticate as never, requireAdmin as never);

// Dashboard
router.get('/dashboard', AdminController.getDashboard);

// Analytics
router.get('/analytics', AdminConversationController.getAnalytics);

// Disputes
router.get('/disputes', AdminController.listDisputes);
router.post('/disputes/:bookingId/resolve', validate(resolveDisputeSchema), AdminController.resolveDispute as never);

// Conversations (WhatsApp logs)
router.get('/conversations', AdminConversationController.listConversations);
router.get('/conversations/:bookingId', AdminConversationController.getConversation);

// Users
router.get('/users', AdminController.listUsers);
router.put('/users/:id/suspend',   AdminController.suspendUser   as never);
router.put('/users/:id/reinstate', AdminController.reinstateUser as never);
router.put('/users/:id/flag',      AdminController.flagUser      as never);
router.put('/users/:id/unflag',    AdminController.unflagUser    as never);

export default router;
