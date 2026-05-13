import { z } from 'zod';
import {
  requestOtpSchema,
  verifyOtpSchema,
  createEnquirySchema,
  onboardProviderSchema,
  leaveReviewSchema,
} from '../../src/validators';

const parse = (schema: z.AnyZodObject, body: unknown) =>
  schema.safeParse({ body });

describe('Validators', () => {
  describe('requestOtpSchema', () => {
    it('accepts valid Nigerian phone', () => {
      expect(parse(requestOtpSchema, { phone: '+2348011111111' }).success).toBe(true);
    });

    it('rejects non-E164 format', () => {
      expect(parse(requestOtpSchema, { phone: '08011111111' }).success).toBe(false);
      expect(parse(requestOtpSchema, { phone: '+44123456789' }).success).toBe(false);
      expect(parse(requestOtpSchema, { phone: '' }).success).toBe(false);
    });
  });

  describe('verifyOtpSchema', () => {
    it('accepts valid OTP', () => {
      expect(parse(verifyOtpSchema, { phone: '+2348011111111', code: '123456' }).success).toBe(true);
    });

    it('rejects non-numeric OTP', () => {
      expect(parse(verifyOtpSchema, { phone: '+2348011111111', code: 'ABCDEF' }).success).toBe(false);
    });

    it('rejects OTP not 6 digits', () => {
      expect(parse(verifyOtpSchema, { phone: '+2348011111111', code: '12345' }).success).toBe(false);
      expect(parse(verifyOtpSchema, { phone: '+2348011111111', code: '1234567' }).success).toBe(false);
    });
  });

  describe('createEnquirySchema', () => {
    const valid = {
      providerId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      categoryId: 'barbing',
      serviceType: 'home',
    };

    it('accepts valid enquiry', () => {
      expect(parse(createEnquirySchema, valid).success).toBe(true);
    });

    it('rejects invalid serviceType', () => {
      expect(parse(createEnquirySchema, { ...valid, serviceType: 'delivery' }).success).toBe(false);
    });

    it('rejects invalid UUID for providerId', () => {
      expect(parse(createEnquirySchema, { ...valid, providerId: 'not-a-uuid' }).success).toBe(false);
    });

    it('accepts optional fields', () => {
      const result = parse(createEnquirySchema, {
        ...valid,
        inspirationPhotoUrl: 'https://cloudinary.com/photo.jpg',
        notes: 'Low fade please',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('onboardProviderSchema', () => {
    const valid = {
      business_name: 'Supreme Cuts',
      business_type: 'salon',
      whatsapp_number: '+2348011111111',
      service_modes: ['home'],
      base_fee_kobo: 350000,
      service_categories: ['barbing'],
      bank_account_name: 'Supreme Cuts',
      bank_account_number: '0123456789',
      bank_code: '058',
      location_text: 'Lekki Phase 1, Lagos',
    };

    it('accepts valid provider data', () => {
      expect(parse(onboardProviderSchema, valid).success).toBe(true);
    });

    it('rejects base_fee_kobo below minimum', () => {
      expect(parse(onboardProviderSchema, { ...valid, base_fee_kobo: 5000 }).success).toBe(false);
    });

    it('rejects empty service_categories', () => {
      expect(parse(onboardProviderSchema, { ...valid, service_categories: [] }).success).toBe(false);
    });

    it('rejects empty service_modes', () => {
      expect(parse(onboardProviderSchema, { ...valid, service_modes: [] }).success).toBe(false);
    });
  });

  describe('leaveReviewSchema', () => {
    const valid = {
      params: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      body: { stars: 5 },
    };

    it('accepts valid review', () => {
      expect(leaveReviewSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects stars out of range', () => {
      expect(leaveReviewSchema.safeParse({ ...valid, body: { stars: 0 } }).success).toBe(false);
      expect(leaveReviewSchema.safeParse({ ...valid, body: { stars: 6 } }).success).toBe(false);
    });
  });
});
