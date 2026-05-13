import { koboToNaira, nairaToKobo, buildPagination } from '../../src/utils/response';

describe('response utils', () => {
  describe('koboToNaira', () => {
    it('should convert kobo to formatted Naira string', () => {
      expect(koboToNaira(650000)).toBe('₦6,500');
      expect(koboToNaira(100)).toBe('₦1');
      expect(koboToNaira(0)).toBe('₦0');
      expect(koboToNaira(10000000)).toBe('₦100,000');
    });
  });

  describe('nairaToKobo', () => {
    it('should convert Naira to integer kobo', () => {
      expect(nairaToKobo(6500)).toBe(650000);
      expect(nairaToKobo(1)).toBe(100);
      expect(nairaToKobo(0)).toBe(0);
      expect(nairaToKobo(100000)).toBe(10000000);
    });

    it('should round to nearest kobo', () => {
      expect(nairaToKobo(0.999)).toBe(100);
      // IEEE 754: 1.005 * 100 = 100.49999... so rounds to 100
      expect(nairaToKobo(1.006)).toBe(101);
    });

    it('should be reversible', () => {
      const naira = 6500;
      expect(nairaToKobo(naira) / 100).toBe(naira);
    });
  });

  describe('buildPagination', () => {
    it('should calculate totalPages correctly', () => {
      expect(buildPagination(1, 20, 100)).toEqual({
        page: 1, limit: 20, total: 100, totalPages: 5,
      });
    });

    it('should round up totalPages', () => {
      expect(buildPagination(1, 20, 101).totalPages).toBe(6);
    });

    it('should handle empty results', () => {
      expect(buildPagination(1, 20, 0)).toEqual({
        page: 1, limit: 20, total: 0, totalPages: 0,
      });
    });
  });
});
