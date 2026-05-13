import {
  generateOtp,
  generateBookingRef,
  verifyWebhookSignature,
  hashToken,
  generateSecureToken,
} from '../../src/utils/crypto';
import crypto from 'crypto';

describe('crypto utils', () => {
  describe('generateOtp', () => {
    it('should return a 6-digit numeric string', () => {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('should generate different values on each call', () => {
      const otps = new Set(Array.from({ length: 20 }, generateOtp));
      expect(otps.size).toBeGreaterThan(1);
    });
  });

  describe('generateBookingRef', () => {
    it('should return SK- prefixed 9-char reference', () => {
      const ref = generateBookingRef();
      expect(ref).toMatch(/^SK-[A-Z0-9]{6}$/);
    });

    it('should generate unique references', () => {
      const refs = new Set(Array.from({ length: 100 }, generateBookingRef));
      expect(refs.size).toBeGreaterThan(90);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should return true for valid signature', () => {
      const secret = 'test-webhook-secret';
      const payload = JSON.stringify({ event: 'charge.success' });
      const signature = crypto
        .createHmac('sha512', secret)
        .update(payload)
        .digest('hex');

      expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
    });

    it('should return false for invalid signature', () => {
      expect(
        verifyWebhookSignature('payload', 'invalidsignature'.padEnd(128, '0'), 'secret')
      ).toBe(false);
    });
  });

  describe('hashToken', () => {
    it('should produce consistent SHA-256 hash', () => {
      const token = 'my-refresh-token';
      expect(hashToken(token)).toBe(hashToken(token));
    });

    it('should produce different hashes for different tokens', () => {
      expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
    });

    it('should return 64-char hex string', () => {
      expect(hashToken('any-token')).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('generateSecureToken', () => {
    it('should return a hex string of correct length', () => {
      const token = generateSecureToken(32);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set(Array.from({ length: 50 }, () => generateSecureToken()));
      expect(tokens.size).toBe(50);
    });
  });
});
