import { db } from '../config/database';
import { NotificationRow, NotificationType } from '../types';

export class NotificationModel {
  static async create(data: {
    user_id: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<NotificationRow> {
    const { rows } = await db.query<NotificationRow>(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.user_id, data.type, data.title, data.body, JSON.stringify(data.data ?? {})]
    );
    return rows[0];
  }

  static async listForUser(
    userId: string,
    page = 1,
    limit = 30
  ): Promise<{ rows: NotificationRow[]; total: number; unreadCount: number }> {
    const offset = (page - 1) * limit;

    const [countRes, unreadRes, dataRes] = await Promise.all([
      db.query<{ count: string }>(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1',
        [userId]
      ),
      db.query<{ count: string }>(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
        [userId]
      ),
      db.query<NotificationRow>(
        `SELECT * FROM notifications WHERE user_id = $1
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      ),
    ]);

    return {
      rows: dataRes.rows,
      total: parseInt(countRes.rows[0]?.count ?? '0', 10),
      unreadCount: parseInt(unreadRes.rows[0]?.count ?? '0', 10),
    };
  }

  static async markRead(id: string, userId: string): Promise<void> {
    await db.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
  }

  static async markAllRead(userId: string): Promise<void> {
    await db.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [userId]
    );
  }

  static async deleteOld(daysOld = 90): Promise<void> {
    await db.query(
      `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '${daysOld} days'`
    );
  }
}
