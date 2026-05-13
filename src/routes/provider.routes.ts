import { Router } from 'express';
import { ProviderController } from '../controllers/provider.controller';
import { authenticate, requireProvider } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { onboardProviderSchema } from '../validators';
import { upload } from '../config/cloudinary';

const router = Router();

router.get('/', ProviderController.list as never);
router.get('/:id', ProviderController.getById as never);
router.get('/:id/reviews', ProviderController.getReviews as never);

router.post('/onboard', authenticate as never, validate(onboardProviderSchema), ProviderController.onboard as never);
router.put('/:id', authenticate as never, ProviderController.update as never);

router.post(
  '/:id/portfolio',
  authenticate as never,
  requireProvider as never,
  upload.single('photo'),
  ProviderController.uploadPortfolioPhoto as never
);

router.delete(
  '/:id/portfolio/:photoId',
  authenticate as never,
  requireProvider as never,
  ProviderController.deletePortfolioPhoto as never
);

router.get('/me/earnings', authenticate as never, requireProvider as never, ProviderController.getEarnings as never);
router.get('/me/live-status', authenticate as never, requireProvider as never, ProviderController.getGoLiveStatus as never);

export default router;
