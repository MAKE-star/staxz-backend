import { AuthService } from '../../src/services/auth.service';
import { redis } from '../../src/config/redis';
import { UserModel } from '../../src/models/user.model';
import { UserRole } from '../../src/types';

jest.mock('../../src/models/user.model');
jest.mock('../../src/services/sms.service');

const mockRedis = redis as jest.Mocked<typeof redis>;
const mockUserModel = UserModel as jest.Mocked<typeof UserModel>;

describe('AuthService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('requestOtp', () => {
    it('should send OTP and store in Redis', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.setex.mockResolvedValue('OK');

      await AuthService.requestOtp('+2348011111111');

      expect(mockRedis.incr).toHaveBeenCalledWith(expect.stringContaining('+2348011111111'));
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('+2348011111111'),
        expect.any(Number),
        expect.stringContaining('"code"')
      );
    });

    it('should throw 429 after 3 OTP requests', async () => {
      mockRedis.incr.mockResolvedValue(4);

      await expect(AuthService.requestOtp('+2348011111111')).rejects.toMatchObject({
        statusCode: 429,
        code: 'RATE_LIMITED',
      });
    });
  });

  describe('verifyOtp', () => {
    const phone = '+2348011111111';
    const code = '123456';

    it('should return tokens on valid OTP', async () => {
      const record = JSON.stringify({ code, attempts: 0, expiresAt: Date.now() + 300_000 });
      mockRedis.get.mockResolvedValue(record);
      mockRedis.del.mockResolvedValue(1);
      mockRedis.setex.mockResolvedValue('OK');

      const mockUser = {
        id: 'user-uuid-1', phone, role: UserRole.HIRER,
        full_name: null, avatar_url: null, is_active: true, is_flagged: false, flag_reason: null, created_at: new Date(),
      };
      mockUserModel.findByPhone.mockResolvedValue(mockUser);

      const result = await AuthService.verifyOtp(phone, code);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.isNewUser).toBe(false);
    });

    it('should throw on invalid OTP', async () => {
      const record = JSON.stringify({ code: '999999', attempts: 0, expiresAt: Date.now() + 300_000 });
      mockRedis.get.mockResolvedValue(record);
      mockRedis.setex.mockResolvedValue('OK');

      await expect(AuthService.verifyOtp(phone, '123456')).rejects.toMatchObject({
        statusCode: 401,
        message: 'Invalid OTP',
      });
    });

    it('should throw if OTP not found in Redis', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(AuthService.verifyOtp(phone, code)).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it('should throw if account is suspended', async () => {
      const record = JSON.stringify({ code, attempts: 0, expiresAt: Date.now() + 300_000 });
      mockRedis.get.mockResolvedValue(record);
      mockRedis.del.mockResolvedValue(1);

      const suspendedUser = {
        id: 'user-uuid-suspended', phone, role: UserRole.HIRER,
        full_name: null, avatar_url: null, is_active: false, is_flagged: false, flag_reason: null, created_at: new Date(),
      };
      mockUserModel.findByPhone.mockResolvedValue(suspendedUser);

      await expect(AuthService.verifyOtp(phone, code)).rejects.toMatchObject({
        statusCode: 401,
        message: 'Account suspended',
      });
    });
  });

  describe('verifyAccessToken', () => {
    it('should throw on invalid token', () => {
      expect(() => AuthService.verifyAccessToken('invalid.token.here')).toThrow();
    });

    it('should throw on tampered token', () => {
      // Sign with wrong secret
      const fakeToken = require('jsonwebtoken').sign(
        { sub: 'user-1', role: 'hirer', phone: '+234...' },
        'wrong-secret',
        { expiresIn: '15m' }
      );
      expect(() => AuthService.verifyAccessToken(fakeToken)).toThrow();
    });
  });
});
