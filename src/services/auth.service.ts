import jwt from 'jsonwebtoken';
import { config } from '../config';
import { redis } from '../config/redis';
import { UserModel } from '../models/user.model';
import { UserRole, JwtPayload, OtpRecord } from '../types';
import { generateOtp, generateSecureToken, hashToken } from '../utils/crypto';
import { SmsService } from './sms.service';
import { UnauthorizedError, AppError } from '../utils/errors';
import { logger } from '../utils/logger';

const OTP_PREFIX      = 'otp:';
const PIN_ID_PREFIX   = 'pin:';
const REFRESH_TOKEN_PREFIX = 'rt:';
const OTP_RATE_PREFIX = 'otp_rate:';

export class AuthService {
  /** Send OTP — rate limited to 3/hour per phone number */
  static async requestOtp(phone: string): Promise<void> {
    const rateKey = `${OTP_RATE_PREFIX}${phone}`;
    const attempts = await redis.incr(rateKey);

    if (attempts === 1) {
      await redis.expire(rateKey, config.otp.rateLimitWindow);
    }

    if (attempts > 3) {
      throw new AppError('Too many OTP requests. Try again in an hour.', 429, 'RATE_LIMITED');
    }

    if (!config.termii.apiKey) {
      // Dev mode — generate and store our own OTP
      const code = generateOtp();
      const record: OtpRecord = {
        code,
        attempts: 0,
        expiresAt: Date.now() + config.otp.ttlSeconds * 1000,
      };
      await redis.setex(`${OTP_PREFIX}${phone}`, config.otp.ttlSeconds, JSON.stringify(record));
      logger.info({ phone, code }, '🔑 DEV OTP (Termii not configured)');
      return;
    }

    // Production — use Termii Token API
    try {
      const pinId = await SmsService.sendToken(phone);
      // Store pinId in Redis so we can verify later
      await redis.setex(`${PIN_ID_PREFIX}${phone}`, config.otp.ttlSeconds, pinId);
      logger.info({ phone, pinId }, '✅ Termii token sent');
    } catch (err) {
      logger.error({ phone, err }, '❌ Termii sendToken failed — falling back to dev OTP');
      // Fallback: store our own OTP in Redis
      const code = generateOtp();
      const record: OtpRecord = { code, attempts: 0, expiresAt: Date.now() + config.otp.ttlSeconds * 1000 };
      await redis.setex(`${OTP_PREFIX}${phone}`, config.otp.ttlSeconds, JSON.stringify(record));
      logger.info({ phone, code }, '🔑 Fallback OTP stored in Redis');
    }
  }

  /** Verify OTP and return JWT pair */
  static async verifyOtp(
    phone: string,
    code: string,
    role: UserRole = UserRole.HIRER
  ): Promise<{ accessToken: string; refreshToken: string; isNewUser: boolean }> {

    let verified = false;

    // Check if we have a Termii pinId for this phone
    const pinId = await redis.get(`${PIN_ID_PREFIX}${phone}`);

    if (pinId) {
      // Verify via Termii
      try {
        verified = await SmsService.verifyToken(pinId, code);
        if (verified) {
          await redis.del(`${PIN_ID_PREFIX}${phone}`);
        } else {
          throw new UnauthorizedError('Invalid OTP');
        }
      } catch (err: any) {
        if (err instanceof UnauthorizedError) throw err;
        logger.error({ phone, err }, 'Termii verify failed — trying Redis fallback');
        verified = false;
      }
    }

    // Fallback: check our own Redis OTP
    if (!verified) {
      const key = `${OTP_PREFIX}${phone}`;
      const raw = await redis.get(key);

      if (!raw) throw new UnauthorizedError('OTP expired or not found');

      const record: OtpRecord = JSON.parse(raw);

      if (record.attempts >= config.otp.maxAttempts) {
        await redis.del(key);
        throw new UnauthorizedError('Too many failed attempts');
      }

      if (record.code !== code) {
        record.attempts++;
        await redis.setex(key, config.otp.ttlSeconds, JSON.stringify(record));
        throw new UnauthorizedError('Invalid OTP');
      }

      await redis.del(key);
      verified = true;
    }

    // OTP verified — find or create user
    const existingUser = await UserModel.findByPhone(phone);
    const user = existingUser ?? await UserModel.upsertByPhone(phone, role);
    const isNewUser = !existingUser;

    if (!user.is_active) throw new UnauthorizedError('Account suspended');

    const { accessToken, refreshToken } = await this.generateTokenPair(user.id, user.role, user.phone);

    return { accessToken, refreshToken, isNewUser };
  }

  static async refresh(rawRefreshToken: string): Promise<{ accessToken: string }> {
    const tokenHash = hashToken(rawRefreshToken);
    const key = `${REFRESH_TOKEN_PREFIX}${tokenHash}`;
    const userId = await redis.get(key);

    if (!userId) throw new UnauthorizedError('Invalid or expired refresh token');

    const user = await UserModel.findById(userId);
    if (!user || !user.is_active) throw new UnauthorizedError('Account not found');

    const accessToken = this.signAccessToken(user.id, user.role, user.phone);
    return { accessToken };
  }

  static async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);
    await redis.del(`${REFRESH_TOKEN_PREFIX}${tokenHash}`);
  }

  static async generateTokenPair(userId: string, role: UserRole, phone: string) {
    const accessToken = this.signAccessToken(userId, role, phone);
    const refreshToken = generateSecureToken();
    const tokenHash = hashToken(refreshToken);
    const ttlSeconds = 30 * 24 * 60 * 60;
    await redis.setex(`${REFRESH_TOKEN_PREFIX}${tokenHash}`, ttlSeconds, userId);
    return { accessToken, refreshToken };
  }

  private static signAccessToken(userId: string, role: UserRole, phone: string): string {
    return jwt.sign(
      { sub: userId, role, phone },
      config.jwt.accessSecret,
      { expiresIn: config.jwt.accessExpiresIn } as jwt.SignOptions
    );
  }

  static verifyAccessToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }
}