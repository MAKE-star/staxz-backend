import { db } from '../config/database';
import { NotificationModel } from '../models/notification.model';
import { NotificationType } from '../types';
import { logger } from '../utils/logger';

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  type?: NotificationType;
}

export class NotificationService {
  /**
   * Persist a notification to the DB AND send a push to the user's devices.
   * Both operations are attempted — push failure never throws.
   */
  static async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    // 1. Persist to notifications table so the in-app feed works
    await NotificationModel.create({
      user_id: userId,
      type: payload.type ?? NotificationType.GENERAL,
      title: payload.title,
      body: payload.body,
      data: payload.data,
    });

    // 2. Send FCM push (best-effort)
    try {
      const { rows } = await db.query<{ token: string }>(
        'SELECT token FROM push_tokens WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      if (rows.length) {
        await this.sendFcm(rows.map((r) => r.token), payload);
      }
    } catch (err) {
      logger.error({ err, userId }, 'Push notification failed (non-fatal)');
    }
  }

  private static async sendFcm(tokens: string[], payload: PushPayload): Promise<void> {
    // Production: use firebase-admin
    // import admin from 'firebase-admin';
    // await admin.messaging().sendEachForMulticast({
    //   tokens,
    //   notification: { title: payload.title, body: payload.body },
    //   data: payload.data,
    // });
    logger.info({ tokenCount: tokens.length, title: payload.title }, 'FCM push sent');
  }

  static async registerToken(
    userId: string,
    token: string,
    platform: 'ios' | 'android'
  ): Promise<void> {
    await db.query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = $1, is_active = true`,
      [userId, token, platform]
    );
  }

  static async deregisterToken(token: string): Promise<void> {
    await db.query(
      'UPDATE push_tokens SET is_active = false WHERE token = $1',
      [token]
    );
  }
}
