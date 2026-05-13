import { config } from '../config';
import { logger } from '../utils/logger';

export class SmsService {
  static async sendOtp(phone: string, code: string): Promise<void> {
    if (!config.termii.apiKey) {
      logger.warn({ phone, code }, 'Termii not configured — OTP not sent');
      return;
    }

    const res = await fetch(`${config.termii.baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.termii.apiKey,
        to: phone,
        from: config.termii.senderId,
        sms: `Your Staxz verification code is: ${code}. Valid for 5 minutes. Do not share.`,
        type: 'plain',
        channel: 'generic',
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      logger.error({ phone, error }, 'Termii SMS failed');
      throw new Error('SMS delivery failed');
    }

    logger.info({ phone }, 'OTP SMS sent via Termii');
  }
}
