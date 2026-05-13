import { ProviderService } from '../../src/services/provider.service';

jest.mock('../../src/models/provider.model');
jest.mock('../../src/services/paystack.service');
jest.mock('../../src/services/notification.service');

const VALID = {
  business_name: 'Supreme Cuts',
  business_type: 'salon',
  whatsapp_number: '+2348055555555',
  service_categories: ['barbing', 'haircut'],
  service_modes: ['home', 'walkin'],
  base_fee_kobo: 350_000,
  bank_account_number: '0123456789',
  bank_account_name: 'Supreme Cuts Ltd',
  bank_code: '058',
  location_text: 'Lekki Phase 1, Lagos',
  location_lat: 6.4281,
  location_lng: 3.4219,
};

async function check(overrides: Partial<typeof VALID> & Record<string, unknown>) {
  return ProviderService.validateOnboardingCriteria({ ...VALID, ...overrides });
}

describe('ProviderService.validateOnboardingCriteria', () => {

  describe('STEP 1 — Business Info', () => {
    it('passes with fully valid data', async () => {
      const result = await check({});
      expect(result.passed).toBe(true);
      expect(result.errors).toEqual({});
    });

    it('rejects numbers-only business name', async () => {
      const r = await check({ business_name: '12345' });
      expect(r.passed).toBe(false);
      expect(r.errors.business_name).toBeDefined();
    });

    it('rejects empty business name', async () => {
      const r = await check({ business_name: '' });
      expect(r.passed).toBe(false);
      expect(r.errors.business_name).toBeDefined();
    });

    it('accepts valid RC CAC number', async () => {
      const r = await check({ cac_number: 'RC-1234567' });
      expect(r.errors.cac_number).toBeUndefined();
    });

    it('accepts valid BN CAC number', async () => {
      const r = await check({ cac_number: 'BN-9876543' });
      expect(r.errors.cac_number).toBeUndefined();
    });

    it('rejects malformed CAC number', async () => {
      const r = await check({ cac_number: 'CAC12345' });
      expect(r.passed).toBe(false);
      expect(r.errors.cac_number).toBeDefined();
    });

    it('issues warning (not error) when CAC is absent', async () => {
      const r = await check({ cac_number: undefined });
      expect(r.passed).toBe(true);
      expect(r.warnings.length).toBeGreaterThan(0);
      expect(r.warnings[0]).toContain('CAC');
    });

    it('rejects missing location_text', async () => {
      const r = await check({ location_text: '' });
      expect(r.passed).toBe(false);
      expect(r.errors.location_text).toBeDefined();
    });

    it('rejects coordinates outside Nigeria', async () => {
      const r = await check({ location_lat: 51.5, location_lng: -0.1 }); // London
      expect(r.passed).toBe(false);
      expect(r.errors.location_coords).toBeDefined();
    });

    it('rejects partial coordinates (lat without lng)', async () => {
      const r = await check({ location_lat: 6.4, location_lng: undefined });
      expect(r.passed).toBe(false);
      expect(r.errors.location_coords).toBeDefined();
    });

    it('accepts valid Nigerian coordinates', async () => {
      const r = await check({ location_lat: 6.5244, location_lng: 3.3792 }); // Lagos
      expect(r.errors.location_coords).toBeUndefined();
    });
  });

  describe('STEP 2 — Services', () => {
    it('rejects empty service_categories', async () => {
      const r = await check({ service_categories: [] });
      expect(r.passed).toBe(false);
      expect(r.errors.service_categories).toBeDefined();
    });

    it('rejects unknown category', async () => {
      const r = await check({ service_categories: ['flying_trapeze'] });
      expect(r.passed).toBe(false);
      expect(r.errors.service_categories[0]).toContain('Unknown');
    });

    it('accepts all valid categories', async () => {
      const allCats = [
        'barbing', 'makeup', 'braids', 'nails', 'lashes',
        'facials', 'spa', 'weaves', 'coloring',
      ];
      const r = await check({ service_categories: allCats });
      expect(r.errors.service_categories).toBeUndefined();
    });

    it('rejects empty service_modes', async () => {
      const r = await check({ service_modes: [] });
      expect(r.passed).toBe(false);
      expect(r.errors.service_modes).toBeDefined();
    });

    it('rejects base_fee_kobo below ₦100', async () => {
      const r = await check({ base_fee_kobo: 5_000 });
      expect(r.passed).toBe(false);
      expect(r.errors.base_fee_kobo).toBeDefined();
    });

    it('rejects base_fee_kobo above ₦500,000', async () => {
      const r = await check({ base_fee_kobo: 60_000_000 });
      expect(r.passed).toBe(false);
      expect(r.errors.base_fee_kobo).toBeDefined();
    });

    it('accepts ₦3,500 base fee', async () => {
      const r = await check({ base_fee_kobo: 350_000 });
      expect(r.errors.base_fee_kobo).toBeUndefined();
    });
  });

  describe('STEP 4 — WhatsApp', () => {
    it('rejects non-Nigerian number', async () => {
      const r = await check({ whatsapp_number: '+447911123456' });
      expect(r.passed).toBe(false);
      expect(r.errors.whatsapp_number).toBeDefined();
    });

    it('rejects number without +234 prefix', async () => {
      const r = await check({ whatsapp_number: '08011111111' });
      expect(r.passed).toBe(false);
      expect(r.errors.whatsapp_number).toBeDefined();
    });

    it('accepts valid Nigerian E.164', async () => {
      const r = await check({ whatsapp_number: '+2348055555555' });
      expect(r.errors.whatsapp_number).toBeUndefined();
    });
  });

  describe('STEP 5 — Bank / Payout', () => {
    it('rejects 9-digit account number', async () => {
      const r = await check({ bank_account_number: '012345678' });
      expect(r.passed).toBe(false);
      expect(r.errors.bank_account_number).toBeDefined();
    });

    it('rejects 11-digit account number', async () => {
      const r = await check({ bank_account_number: '01234567890' });
      expect(r.passed).toBe(false);
      expect(r.errors.bank_account_number).toBeDefined();
    });

    it('rejects non-numeric account number', async () => {
      const r = await check({ bank_account_number: '012ABC6789' });
      expect(r.passed).toBe(false);
      expect(r.errors.bank_account_number).toBeDefined();
    });

    it('accepts valid 10-digit NUBAN', async () => {
      const r = await check({ bank_account_number: '0123456789' });
      expect(r.errors.bank_account_number).toBeUndefined();
    });

    it('rejects unrecognised bank code', async () => {
      const r = await check({ bank_code: '999' });
      expect(r.passed).toBe(false);
      expect(r.errors.bank_code).toBeDefined();
    });

    it('accepts GTBank code 058', async () => {
      const r = await check({ bank_code: '058' });
      expect(r.errors.bank_code).toBeUndefined();
    });

    it('accepts OPay code 999992', async () => {
      const r = await check({ bank_code: '999992' });
      expect(r.errors.bank_code).toBeUndefined();
    });

    it('accepts Kuda code 100004', async () => {
      const r = await check({ bank_code: '100004' });
      expect(r.errors.bank_code).toBeUndefined();
    });

    it('rejects missing account name', async () => {
      const r = await check({ bank_account_name: '' });
      expect(r.passed).toBe(false);
      expect(r.errors.bank_account_name).toBeDefined();
    });

    it('rejects bio shorter than 20 chars', async () => {
      const r = await check({ bio: 'Too short' });
      expect(r.passed).toBe(false);
      expect(r.errors.bio).toBeDefined();
    });

    it('accepts bio of 20+ chars', async () => {
      const r = await check({ bio: 'Top barber in Lagos with 5 years experience.' });
      expect(r.errors.bio).toBeUndefined();
    });

    it('accepts undefined bio (optional)', async () => {
      const r = await check({ bio: undefined });
      expect(r.errors.bio).toBeUndefined();
    });

    it('rejects negative years_experience', async () => {
      const r = await check({ years_experience: -1 });
      expect(r.passed).toBe(false);
      expect(r.errors.years_experience).toBeDefined();
    });

    it('rejects years_experience > 50', async () => {
      const r = await check({ years_experience: 51 });
      expect(r.passed).toBe(false);
      expect(r.errors.years_experience).toBeDefined();
    });
  });

  describe('Multiple errors', () => {
    it('returns all errors at once, not just the first', async () => {
      const r = await check({
        business_name: '123',
        service_categories: [],
        bank_account_number: '123',
        bank_code: '999',
        whatsapp_number: '+447911123456',
        location_text: '',
      });
      expect(r.passed).toBe(false);
      // Should surface all 6 problems simultaneously
      expect(Object.keys(r.errors).length).toBeGreaterThanOrEqual(5);
    });
  });
});
