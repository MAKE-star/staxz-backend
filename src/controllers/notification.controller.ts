import { Response } from 'express';
import { NotificationModel } from '../models/notification.model';
import { AuthenticatedRequest } from '../types';
import { sendSuccess, buildPagination } from '../utils/response';

export class NotificationController {
  static async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    const page  = parseInt((req.query.page  as string) ?? '1',  10);
    const limit = parseInt((req.query.limit as string) ?? '30', 10);

    const result = await NotificationModel.listForUser(req.user.id, page, limit);

    res.status(200).json({
      success: true,
      data: result.rows,
      unreadCount: result.unreadCount,
      pagination: buildPagination(page, limit, result.total),
    });
  }

  static async markRead(req: AuthenticatedRequest, res: Response): Promise<void> {
    await NotificationModel.markRead(req.params['id'] as string, req.user.id);
    sendSuccess(res, null, 200, 'Notification marked as read');
  }

  static async markAllRead(req: AuthenticatedRequest, res: Response): Promise<void> {
    await NotificationModel.markAllRead(req.user.id);
    sendSuccess(res, null, 200, 'All notifications marked as read');
  }
}
