import { Router } from 'express';
import { CACController } from '../controllers/cac.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/verify', authenticate as never, CACController.verify as never);

export default router;