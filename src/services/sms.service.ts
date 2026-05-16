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
  /**
   * Send OTP via Termii Token API.
   * Returns pinId which must be stored and used to verify later.
   */
  static async sendToken(phone: string): Promise<string> {
    if (!config.termii.apiKey) {
      // Dev mode — return a fake pinId, actual code handled by Redis
      logger.warn({ phone }, 'Termii not configured — using dev mode');
      return 'dev-pin-id';
    }

    // Strip + from phone for Termii (they want 234XXXXXXXXXX format)
    const termiiPhone = phone.startsWith('+') ? phone.slice(1) : phone;

    const res = await fetch(`${config.termii.baseUrl}/api/sms/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:          config.termii.apiKey,
        message_type:     'NUMERIC',
        to:               termiiPhone,
        from:             config.termii.senderId,
        channel:          'dnd',
        pin_attempts:     5,
        pin_time_to_live: 5,
        pin_length:       6,
        pin_placeholder:  '< 000000 >',
        message_text:     'Your Staxz verification code is < 000000 >. Valid for 5 minutes. Do not share.',
        pin_type:         'NUMERIC',
      }),
    });

    const data = await res.json() as SendTokenResponse;
    logger.info({ phone, data }, 'Termii send token response');

    if (!data.pinId) {
      throw new Error(`Termii failed to send token: ${JSON.stringify(data)}`);
    }

    return data.pinId;
  }

  /**
   * Verify OTP via Termii Verify Token API.
   * Returns true if verified, false if not.
   */
  static async verifyToken(pinId: string, pin: string): Promise<boolean> {
    if (!config.termii.apiKey || pinId === 'dev-pin-id') {
      // Dev mode — skip verification
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