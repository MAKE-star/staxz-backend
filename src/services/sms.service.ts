import { config } from '../config';
import { logger } from '../utils/logger';

interface SendTokenResponse {
  pinId: string;
  to: string;
  smsStatus: string;
}

interface VerifyTokenResponse {
  pinId: string;
  verified: string;
  msisdn: string;
}

export class SmsService {
  static async sendToken(phone: string): Promise<string> {
    if (!config.termii.apiKey) {
      logger.warn({ phone }, 'Termii not configured — using dev mode');
      return 'dev-pin-id';
    }

    // Strip + from phone (Termii wants 234XXXXXXXXXX)
    const termiiPhone = phone.startsWith('+') ? phone.slice(1) : phone;

    const channels = [
      { channel: 'generic', from: 'N-Alert' },
      { channel: 'dnd',     from: 'N-Alert' },
    ];

    for (const { channel, from } of channels) {
      try {
        const res = await fetch(`${config.termii.baseUrl}/api/sms/otp/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key:          config.termii.apiKey,
            message_type:     'NUMERIC',
            to:               termiiPhone,
            from,
            channel,
            pin_attempts:     5,
            pin_time_to_live: 5,
            pin_length:       6,
            pin_placeholder:  '< 000000 >',
            message_text:     'Your Staxz verification code is < 000000 >. Valid for 5 minutes. Do not share.',
            pin_type:         'NUMERIC',
          }),
        });

        const data = await res.json() as SendTokenResponse;
        logger.info({ phone, channel, data }, 'Termii send token response');

        if (data.pinId) {
          logger.info({ phone, channel }, '✅ OTP sent via Termii');
          return data.pinId;
        }

        logger.warn({ phone, channel, data }, `Channel ${channel} failed, trying next`);
      } catch (err) {
        logger.warn({ phone, channel, err }, `Channel ${channel} threw error`);
      }
    }

    throw new Error('All Termii channels failed');
  }

  static async verifyToken(pinId: string, pin: string): Promise<boolean> {
    if (!config.termii.apiKey || pinId === 'dev-pin-id') {
      return true;
    }

    const res = await fetch(`${config.termii.baseUrl}/api/sms/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.termii.apiKey,
        pin_id:  pinId,
        pin,
      }),
    });

    const data = await res.json() as VerifyTokenResponse;
    logger.info({ pinId, data }, 'Termii verify token response');

    return data.verified === 'True';
  }
}