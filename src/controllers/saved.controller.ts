import { Response } from 'express';
import { SavedProviderModel, SavedCardModel } from '../models/saved.model';
import { AuthenticatedRequest } from '../types';
import { sendSuccess } from '../utils/response';

export class SavedController {
  // ── Saved Providers ──────────────────────────────────────────────────────────

  static async toggleSaveProvider(req: AuthenticatedRequest, res: Response): Promise<void> {
    const saved = await SavedProviderModel.toggle(req.user.id, req.params['id'] as string);
    sendSuccess(res, { saved }, 200, saved ? 'Provider saved' : 'Provider removed from saved');
  }

  static async listSavedProviders(req: AuthenticatedRequest, res: Response): Promise<void> {
    const providers = await SavedProviderModel.listForHirer(req.user.id);
    sendSuccess(res, providers);
  }

  static async checkSaved(req: AuthenticatedRequest, res: Response): Promise<void> {
    const saved = await SavedProviderModel.isSaved(req.user.id, req.params['id'] as string);
    sendSuccess(res, { saved });
  }

  // ── Saved Cards ──────────────────────────────────────────────────────────────

  static async listCards(req: AuthenticatedRequest, res: Response): Promise<void> {
    const cards = await SavedCardModel.listForUser(req.user.id);
    // Never return the full auth_code to the client
    const safe = cards.map(({ paystack_auth_code: _hidden, ...rest }) => rest);
    sendSuccess(res, safe);
  }

  static async setDefaultCard(req: AuthenticatedRequest, res: Response): Promise<void> {
    await SavedCardModel.setDefault(req.params['cardId'] as string, req.user.id);
    sendSuccess(res, null, 200, 'Default card updated');
  }

  static async deleteCard(req: AuthenticatedRequest, res: Response): Promise<void> {
    await SavedCardModel.delete(req.params['cardId'] as string, req.user.id);
    sendSuccess(res, null, 200, 'Card removed');
  }
}
