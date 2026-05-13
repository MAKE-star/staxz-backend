import jwt from 'jsonwebtoken';
import { config } from '../config';
import { redis } from '../config/redis';
import { UserModel } from '../models/user.model';
import { UserRole, JwtPayload, OtpRecord } from '../types';
import { generateOtp, generateSecureToken, hashToken } from '../utils/crypto';
import { SmsService } from './sms.service';
import { UnauthorizedError, AppError } from '../utils/errors';
import { logger } from '../utils/logger';

const OTP_PREFIX = 'otp:';
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

    const code = generateOtp();
    const record: OtpRecord = { code, attempts: 0, expiresAt: Date.now() + config.otp.ttlSeconds * 1000 };

    await redis.setex(
      `${OTP_PREFIX}${phone}`,
      config.otp.ttlSeconds,
      JSON.stringify(record)
    );

    // In production: send via Termii. In dev: log it.
    if (config.isProduction) {
      await SmsService.sendOtp(phone, code);
    } else {
      logger.info({ phone, code }, '🔑 DEV OTP (not sent in production)');
    }
  }

  /** Verify OTP and return JWT pair */
  static async verifyOtp(
    phone: string,
    code: string,
    role: UserRole = UserRole.HIRER
  ): Promise<{ accessToken: string; refreshToken: string; isNewUser: boolean }> {
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

    const existingUser = await UserModel.findByPhone(phone);
    const user = existingUser ?? await UserModel.upsertByPhone(phone, role);
    const isNewUser = !existingUser;

    if (!user.is_active) throw new UnauthorizedError('Account suspended');

    const { accessToken, refreshToken } = await this.generateTokenPair(user.id, user.role, user.phone);

    return { accessToken, refreshToken, isNewUser };
  }

  static async refresh(
    rawRefreshToken: string
  ): Promise<{ accessToken: string }> {
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

    // Store refresh token in Redis with TTL
    const ttlSeconds = 30 * 24 * 60 * 60; // 30 days
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
