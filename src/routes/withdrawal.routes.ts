import { Router } from 'express';
import { WithdrawalController } from '../controllers/withdrawal.controller';
import { authenticate, requireProvider } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate as never, requireProvider as never);

router.get('/balance',  WithdrawalController.getBalance    as never);
router.post('/',        WithdrawalController.initiate      as never);
router.get('/history',  WithdrawalController.listHistory   as never);

export default router;
