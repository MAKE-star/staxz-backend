import { Router } from 'express';
import { SavedController } from '../controllers/saved.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate as never);

// Saved providers
router.get('/providers',                SavedController.listSavedProviders as never);
router.post('/providers/:id',           SavedController.toggleSaveProvider as never);
router.get('/providers/:id/status',     SavedController.checkSaved         as never);

// Saved cards (payment methods)
router.get('/cards',                    SavedController.listCards       as never);
router.patch('/cards/:cardId/default',  SavedController.setDefaultCard  as never);
router.delete('/cards/:cardId',         SavedController.deleteCard      as never);

export default router;
