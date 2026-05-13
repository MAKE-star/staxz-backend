import request from 'supertest';
import { app } from '../../src/app';
import { redis } from '../../src/config/redis';
import { UserModel } from '../../src/models/user.model';
import { AuthService } from '../../src/services/auth.service';

jest.mock('../../src/models/user.model');
jest.mock('../../src/services/sms.service');

const mockRedis   = redis      as jest.Mocked<typeof redis>;
const mockUser    = UserModel  as jest.Mocked<typeof UserModel>;

const BASE = '/api/v1/auth';

describe('Auth Routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /request-otp', () => {
    it('returns 200 on valid Nigerian phone', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.setex.mockResolvedValue('OK');

      const res = await request(app)
        .post(`${BASE}/request-otp`)
        .send({ phone: '+2348011111111' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 422 on invalid phone format', async () => {
      const res = await request(app)
        .post(`${BASE}/request-otp`)
        .send({ phone: '08011111111' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('returns 422 on missing phone', async () => {
      const res = await request(app)
        .post(`${BASE}/request-otp`)
        .send({});

      expect(res.status).toBe(422);
    });

    it('returns 429 after rate limit exceeded', async () => {
      mockRedis.incr.mockResolvedValue(4);

      const res = await request(app)
        .post(`${BASE}/request-otp`)
        .send({ phone: '+2348011111111' });

      expect(res.status).toBe(429);
    });
  });

  describe('POST /verify-otp', () => {
    it('returns 200 with tokens on valid OTP', async () => {
      const phone = '+2348011111111';
      const code = '654321';

      mockRedis.get.mockResolvedValue(
        JSON.stringify({ code, attempts: 0, expiresAt: Date.now() + 300_000 })
      );
      mockRedis.del.mockResolvedValue(1);
      mockRedis.setex.mockResolvedValue('OK');

      mockUser.findByPhone.mockResolvedValue({
        id: 'user-1', phone, role: 'hirer' as never,
        full_name: 'Test User', avatar_url: null,
        is_active: true, created_at: new Date(),
      });

      const res = await request(app)
        .post(`${BASE}/verify-otp`)
        .send({ phone, code });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
    });

    it('returns 401 on wrong OTP', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ code: '000000', attempts: 0, expiresAt: Date.now() + 300_000 })
      );
      mockRedis.setex.mockResolvedValue('OK');

      const res = await request(app)
        .post(`${BASE}/verify-otp`)
        .send({ phone: '+2348011111111', code: '123456' });

      expect(res.status).toBe(401);
    });

    it('returns 422 on OTP not 6 digits', async () => {
      const res = await request(app)
        .post(`${BASE}/verify-otp`)
        .send({ phone: '+2348011111111', code: '12345' });

      expect(res.status).toBe(422);
    });
  });

  describe('POST /refresh', () => {
    it('returns 400 on missing refreshToken', async () => {
      const res = await request(app)
        .post(`${BASE}/refresh`)
        .send({});

      expect(res.status).toBe(422);
    });

    it('returns 401 on invalid refreshToken', async () => {
      mockRedis.get.mockResolvedValue(null);

      const res = await request(app)
        .post(`${BASE}/refresh`)
        .send({ refreshToken: 'fake-token' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /me', () => {
    it('returns 401 without token', async () => {
      const res = await request(app).get(`${BASE}/me`);
      expect(res.status).toBe(401);
    });

    it('returns 401 with malformed token', async () => {
      const res = await request(app)
        .get(`${BASE}/me`)
        .set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });

    it('returns 200 with valid token', async () => {
      const { accessToken } = await AuthService.generateTokenPair(
        'user-uuid-1', 'hirer' as never, '+2348011111111'
      );

      const res = await request(app)
        .get(`${BASE}/me`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe('user-uuid-1');
    });
  });
});
