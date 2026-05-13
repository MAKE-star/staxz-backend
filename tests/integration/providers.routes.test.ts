import request from 'supertest';
import { app } from '../../src/app';
import { BusinessType } from '../../src/types';
import { ProviderModel } from '../../src/models/provider.model';
import { AuthService } from '../../src/services/auth.service';
import { UserRole, ServiceMode } from '../../src/types';
import { redis } from '../../src/config/redis';

jest.mock('../../src/models/provider.model');
jest.mock('../../src/models/review.model');
jest.mock('../../src/models/user.model');

const mockRedis    = redis         as jest.Mocked<typeof redis>;
const mockProvider = ProviderModel as jest.Mocked<typeof ProviderModel>;

const BASE = '/api/v1/providers';

const sampleProvider = {
  id: 'provider-uuid-1',
  user_id: 'user-uuid-1',
  business_name: 'Supreme Cuts',
  business_type: BusinessType.SALON,
  cac_number: 'RC-123',
  cac_verified: true,
  whatsapp_number: '+2348055555555',
  location_text: 'Lekki Phase 1, Lagos',
  location_lat: 6.4281,
  location_lng: 3.4219,
  service_modes: [ServiceMode.HOME, ServiceMode.WALKIN],
  base_fee_kobo: 350000,
  service_categories: ['barbing', 'haircut'],
  rating_avg: 4.9,
  rating_count: 214,
  is_live: true,
  created_at: new Date(),
};

let hirerToken: string;

beforeAll(async () => {
  mockRedis.setex.mockResolvedValue('OK');
  const { accessToken: ht } = await AuthService.generateTokenPair(
    'hirer-uuid-1', UserRole.HIRER, '+2348011111111'
  );
    'user-uuid-1', UserRole.PROVIDER, '+2348055555555'
  );
  hirerToken = ht;
});

describe('Provider Routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /providers', () => {
    it('returns 200 with list of providers', async () => {
      mockProvider.list.mockResolvedValue({ rows: [sampleProvider], total: 1 });

      const res = await request(app).get(BASE);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination.total).toBe(1);
    });

    it('passes query params to model', async () => {
      mockProvider.list.mockResolvedValue({ rows: [], total: 0 });

      await request(app).get(`${BASE}?category=barbing&mode=home&sort=rating`);

      expect(mockProvider.list).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'barbing', mode: 'home', sort: 'rating' })
      );
    });

    it('caps limit at 50', async () => {
      mockProvider.list.mockResolvedValue({ rows: [], total: 0 });

      await request(app).get(`${BASE}?limit=200`);

      expect(mockProvider.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 })
      );
    });
  });

  describe('GET /providers/:id', () => {
    it('returns 200 with provider and portfolio', async () => {
      mockProvider.findById.mockResolvedValue(sampleProvider);
      mockProvider.getPortfolioPhotos.mockResolvedValue([]);

      const res = await request(app).get(`${BASE}/provider-uuid-1`);

      expect(res.status).toBe(200);
      expect(res.body.data.business_name).toBe('Supreme Cuts');
      expect(res.body.data.portfolioPhotos).toEqual([]);
    });

    it('returns 404 for unknown provider', async () => {
      mockProvider.findById.mockResolvedValue(null);

      const res = await request(app).get(`${BASE}/non-existent-uuid`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /providers/onboard', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).post(`${BASE}/onboard`).send({});
      expect(res.status).toBe(401);
    });

    it('returns 422 with invalid data', async () => {
      const res = await request(app)
        .post(`${BASE}/onboard`)
        .set('Authorization', `Bearer ${hirerToken}`)
        .send({ business_name: 'X' }); // missing required fields

      expect(res.status).toBe(422);
    });

    it('returns 201 with valid provider data', async () => {
      const { UserModel } = require('../../src/models/user.model');
      jest.spyOn(UserModel, 'updateProfile').mockResolvedValue({});
      mockProvider.findByUserId.mockResolvedValue(null);
      mockProvider.create.mockResolvedValue(sampleProvider);

      const res = await request(app)
        .post(`${BASE}/onboard`)
        .set('Authorization', `Bearer ${hirerToken}`)
        .send({
          business_name: 'Supreme Cuts',
          business_type: 'salon',
          whatsapp_number: '+2348055555555',
          service_modes: ['home', 'walkin'],
          base_fee_kobo: 350000,
          service_categories: ['barbing'],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.business_name).toBe('Supreme Cuts');
    });

    it('returns 409 if provider already exists', async () => {
      mockProvider.findByUserId.mockResolvedValue(sampleProvider);

      const res = await request(app)
        .post(`${BASE}/onboard`)
        .set('Authorization', `Bearer ${hirerToken}`)
        .send({
          business_name: 'Supreme Cuts',
          business_type: 'salon',
          whatsapp_number: '+2348055555555',
          service_modes: ['home'],
          base_fee_kobo: 350000,
          service_categories: ['barbing'],
        });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /providers/:id/reviews', () => {
    it('returns 404 for unknown provider', async () => {
      mockProvider.findById.mockResolvedValue(null);
      const { ReviewModel } = require('../../src/models/review.model');
      jest.spyOn(ReviewModel, 'listForProvider').mockResolvedValue({ rows: [], total: 0 });

      const res = await request(app).get(`${BASE}/bad-uuid/reviews`);
      expect(res.status).toBe(404);
    });
  });
});
