import { BookingService } from '../../src/services/booking.service';
import { BookingModel } from '../../src/models/booking.model';
import { ProviderModel } from '../../src/models/provider.model';
import { EnquiryModel } from '../../src/models/enquiry.model';
import { BookingStatus, BusinessType, EnquiryStatus, ServiceMode } from '../../src/types';
import { NotFoundError, ForbiddenError, ConflictError } from '../../src/utils/errors';

jest.mock('../../src/models/booking.model');
jest.mock('../../src/models/provider.model');
jest.mock('../../src/models/enquiry.model');
jest.mock('../../src/models/review.model');
jest.mock('../../src/models/dispute.model');
jest.mock('../../src/services/paystack.service');
jest.mock('../../src/services/whatsapp.service');
jest.mock('../../src/services/notification.service');
jest.mock('../../src/models/user.model');
jest.mock('../../src/config/database', () => ({
  db: {
    transaction: jest.fn().mockImplementation((fn) => fn({ query: jest.fn() })),
    query: jest.fn(),
  },
}));

const mockBookingModel  = BookingModel  as jest.Mocked<typeof BookingModel>;
const mockProviderModel = ProviderModel as jest.Mocked<typeof ProviderModel>;
const mockEnquiryModel  = EnquiryModel  as jest.Mocked<typeof EnquiryModel>;

const mockProvider = {
  id: 'provider-uuid-1',
  user_id: 'puser-uuid-1',
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
  is_flagged: false,
  flag_reason: null,
  paystack_recipient_code: null,
  bio: 'Lagos premier barbershop.',
  years_experience: 5,
  bank_account_name: 'Supreme Cuts',
  bank_account_number: '0123456789',
  bank_code: '058',
  created_at: new Date(),
};

const mockBooking = {
  id: 'booking-uuid-1',
  reference: 'SK-AA0001',
  hirer_id: 'hirer-uuid-1',
  provider_id: 'provider-uuid-1',
  service_type: ServiceMode.HOME,
  service_address: '14 Bode Thomas St',
  provider_quote_kobo: 650000,
  platform_fee_kobo: 97500,
  total_charged_kobo: 747500,
  status: BookingStatus.CONFIRMED,
  scheduled_at: new Date(Date.now() + 3 * 60 * 60 * 1000), // 3 hours from now
  completed_at: null,
  confirmed_at: null,
  cancelled_at: null,
  paystack_ref: 'PSK-001',
  escrow_released: false,
  notes: null,
  created_at: new Date(),
};

describe('BookingService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createEnquiry', () => {
    it('should throw NotFoundError if provider does not exist', async () => {
      mockProviderModel.findById.mockResolvedValue(null);

      await expect(
        BookingService.createEnquiry({
          hirerId: 'hirer-uuid-1',
          providerId: 'non-existent',
          categoryId: 'barbing',
          serviceType: ServiceMode.HOME,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw if provider is not live', async () => {
      mockProviderModel.findById.mockResolvedValue({ ...mockProvider, is_live: false });

      await expect(
        BookingService.createEnquiry({
          hirerId: 'hirer-uuid-1',
          providerId: 'provider-uuid-1',
          categoryId: 'barbing',
          serviceType: ServiceMode.HOME,
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('should throw if service mode not supported', async () => {
      mockProviderModel.findById.mockResolvedValue({
        ...mockProvider,
        service_modes: [ServiceMode.WALKIN],
      });

      await expect(
        BookingService.createEnquiry({
          hirerId: 'hirer-uuid-1',
          providerId: 'provider-uuid-1',
          categoryId: 'barbing',
          serviceType: ServiceMode.HOME, // HOME not supported
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('receiveQuote', () => {
    it('should parse raw price string and calculate fee', async () => {
      const mockEnquiry = {
        id: 'enquiry-uuid-1',
        hirer_id: 'hirer-uuid-1',
        provider_id: 'provider-uuid-1',
        category_id: 'barbing',
        service_type: ServiceMode.HOME,
        status: EnquiryStatus.PENDING,
        quote_kobo: null,
        quote_expires_at: new Date(Date.now() + 3600000),
        inspiration_photo_url: null,
        notes: null,
        wati_conversation_id: null,
        created_at: new Date(),
      };

      mockEnquiryModel.findById.mockResolvedValue(mockEnquiry);
      mockEnquiryModel.setQuote.mockResolvedValue({ ...mockEnquiry, quote_kobo: 650000 });

      const result = await BookingService.receiveQuote('enquiry-uuid-1', '6500');

      expect(result.quoteKobo).toBe(650000);
      expect(result.platformFeeKobo).toBe(97500); // 15%
      expect(result.totalKobo).toBe(747500);
    });

    it('should throw ConflictError if enquiry is not pending', async () => {
      const mockEnquiry = {
        id: 'enquiry-uuid-1',
        hirer_id: 'hirer-uuid-1',
        provider_id: 'provider-uuid-1',
        category_id: 'barbing',
        service_type: ServiceMode.HOME,
        status: EnquiryStatus.ACCEPTED,
        quote_kobo: 650000,
        quote_expires_at: new Date(),
        inspiration_photo_url: null,
        notes: null,
        wati_conversation_id: null,
        created_at: new Date(),
      };

      mockEnquiryModel.findById.mockResolvedValue(mockEnquiry);

      await expect(
        BookingService.receiveQuote('enquiry-uuid-1', '6500')
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('markComplete', () => {
    it('should throw ForbiddenError if wrong provider', async () => {
      mockBookingModel.findById.mockResolvedValue(mockBooking);
      mockProviderModel.findByUserId.mockResolvedValue({
        ...mockProvider,
        id: 'different-provider-uuid',
      });

      await expect(
        BookingService.markComplete('booking-uuid-1', 'wrong-provider-user')
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ConflictError if booking not in confirmed state', async () => {
      mockBookingModel.findById.mockResolvedValue({
        ...mockBooking,
        status: BookingStatus.COMPLETED,
      });
      mockProviderModel.findByUserId.mockResolvedValue(mockProvider);

      await expect(
        BookingService.markComplete('booking-uuid-1', 'puser-uuid-1')
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('confirmComplete', () => {
    it('should throw ForbiddenError if wrong hirer', async () => {
      mockBookingModel.findById.mockResolvedValue({
        ...mockBooking,
        status: BookingStatus.IN_PROGRESS,
      });

      await expect(
        BookingService.confirmComplete('booking-uuid-1', 'wrong-hirer-uuid')
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('cancel', () => {
    it('should apply cancellation fee when within 2 hours', async () => {
      const soonBooking = {
        ...mockBooking,
        scheduled_at: new Date(Date.now() + 30 * 60 * 1000), // 30 mins away
      };
      mockBookingModel.findById.mockResolvedValue(soonBooking);
      mockBookingModel.updateStatus.mockResolvedValue(soonBooking);

      const result = await BookingService.cancel('booking-uuid-1', 'hirer-uuid-1');

      expect(result.isLateCancellation).toBe(true);
    });

    it('should not apply fee when more than 2 hours away', async () => {
      const futureBooking = {
        ...mockBooking,
        scheduled_at: new Date(Date.now() + 5 * 60 * 60 * 1000), // 5 hours away
      };
      mockBookingModel.findById.mockResolvedValue(futureBooking);
      mockBookingModel.updateStatus.mockResolvedValue(futureBooking);

      const result = await BookingService.cancel('booking-uuid-1', 'hirer-uuid-1');

      expect(result.isLateCancellation).toBe(false);
    });
  });

  describe('raiseDispute', () => {
    it('should throw if booking is not in a disputable state', async () => {
      mockBookingModel.findById.mockResolvedValue({
        ...mockBooking,
        status: BookingStatus.COMPLETED,
        hirer_id: 'hirer-uuid-1',
      });

      await expect(
        BookingService.raiseDispute('booking-uuid-1', 'hirer-uuid-1', 'Provider no-show')
      ).rejects.toThrow(ConflictError);
    });
  });
});
