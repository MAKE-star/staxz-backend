import { Response } from 'express';
import { WithdrawalService } from '../services/withdrawal.service';
import { WithdrawalModel } from '../models/withdrawal.model';
import { ProviderModel } from '../models/provider.model';
import { AuthenticatedRequest } from '../types';
import { sendSuccess, sendCreated, buildPagination } from '../utils/response';
import { NotFoundError, AppError } from '../utils/errors';

export class WithdrawalController {
  static async getBalance(req: AuthenticatedRequest, res: Response): Promise<void> {
    const provider = await ProviderModel.findByUserId(req.user.id);
    if (!provider) throw new NotFoundError('Provider profile');

    const balance = await WithdrawalService.getAvailableBalance(provider.id);
    sendSuccess(res, balance);
  }

  static async initiate(req: AuthenticatedRequest, res: Response): Promise<void> {
    const provider = await ProviderModel.findByUserId(req.user.id);
    if (!provider) throw new NotFoundError('Provider profile');

    const { amount_kobo } = req.body as { amount_kobo: number };
    if (!amount_kobo || !Number.isInteger(amount_kobo) || amount_kobo <= 0) {
      throw new AppError('Invalid withdrawal amount', 400);
    }

    const result = await WithdrawalService.initiateWithdrawal(provider.id, amount_kobo);
    sendCreated(res, result, 'Withdrawal initiated');
  }

  static async listHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
    const provider = await ProviderModel.findByUserId(req.user.id);
    if (!provider) throw new NotFoundError('Provider profile');

    const page  = parseInt((req.query.page  as string) ?? '1',  10);
    const limit = parseInt((req.query.limit as string) ?? '20', 10);

    const result = await WithdrawalModel.listForProvider(provider.id, page, limit);
    sendSuccess(res, result.rows, 200, undefined, buildPagination(page, limit, result.total));
  }
}
