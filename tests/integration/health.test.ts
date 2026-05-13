import request from 'supertest';
import { app } from '../../src/app';
import { db } from '../../src/config/database';
import { redis } from '../../src/config/redis';

jest.mock('../../src/config/database', () => ({
  db: {
    query: jest.fn(),
    healthCheck: jest.fn(),
    transaction: jest.fn(),
  },
  pool: { query: jest.fn(), end: jest.fn() },
}));

const mockDb    = db    as jest.Mocked<typeof db>;
const mockRedis = redis as jest.Mocked<typeof redis>;

describe('Health Check', () => {
  it('returns 200 when all services are up', async () => {
    mockDb.healthCheck.mockResolvedValue(true);
    mockRedis.ping.mockResolvedValue('PONG');

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.db).toBe('up');
    expect(res.body.services.redis).toBe('up');
  });

  it('returns 503 when DB is down', async () => {
    mockDb.healthCheck.mockResolvedValue(false);
    mockRedis.ping.mockResolvedValue('PONG');

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.services.db).toBe('down');
  });

  it('returns 503 when Redis is down', async () => {
    mockDb.healthCheck.mockResolvedValue(true);
    mockRedis.ping.mockRejectedValue(new Error('Connection refused'));

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body.services.redis).toBe('down');
  });
});

describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 404 for wrong method', async () => {
    const res = await request(app).patch('/api/v1/health');
    expect(res.status).toBe(404);
  });
});
