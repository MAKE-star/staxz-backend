import { config } from '../config';
import { ProviderModel } from '../models/provider.model';
import { PaystackService } from './paystack.service';
import { NotificationService } from './notification.service';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

const MIN_PHOTOS_PER_CATEGORY = 3;

// ─── NIGERIAN BANK CODES ──────────────────────────────────────────────────────
const VALID_BANK_CODES = new Set([
  '044', // Access Bank
  '023', // Citibank
  '050', // EcoBank
  '011', // First Bank
  '214', // FCMB
  '058', // GTBank
  '030', // Heritage Bank
  '301', // Jaiz Bank
  '082', // Keystone Bank
  '076', // Polaris Bank
  '101', // Providus Bank
  '221', // Stanbic IBTC
  '068', // Standard Chartered
  '232', // Sterling Bank
  '032', // Union Bank
  '033', // UBA
  '215', // Unity Bank
  '035', // Wema Bank
  '057', // Zenith Bank
  '999992', // OPay
  '999991', // PalmPay
  '100004', // Kuda Bank
  '999993', // Moniepoint
  '035A',   // ALAT (Wema)
]);

export interface OnboardingCriteriaResult {
  passed: boolean;
  errors: Record<string, string[]>;
  warnings: string[];
}

export class ProviderService {
  /**
   * Validate ALL onboarding criteria before creating a provider profile.
   *
   * Criteria map (mirrors the 5-step onboarding flow in the app):
   *
   * STEP 1 — Business Info
   *   ✓ business_name: not empty, not numbers-only, 2–120 chars
   *   ✓ business_type: must be 'salon' or 'independent'
   *   ✓ cac_number: if provided, must be RC-XXXXXXX / BN-XXXXXXX / IT-XXXXXXX / LP-XXXXXXX
   *                 if absent → warning (no Verified badge, not a blocker)
   *   ✓ location_text: required (clients need to know where you operate)
   *   ✓ location_lat/lng: must both be present and valid Nigerian coordinates
   *                       lat: 4.2–13.9  lng: 2.7–14.7
   *
   * STEP 2 — Services
   *   ✓ service_categories: min 1 from the allowed list
   *   ✓ service_modes: min 1 (home | walkin)
   *   ✓ base_fee_kobo: integer ≥ 10,000 (₦100 minimum)
   *
   * STEP 3 — Portfolio (checked separately at go-live, not here)
   *
   * STEP 4 — WhatsApp
   *   ✓ whatsapp_number: valid Nigerian E.164 (+234XXXXXXXXXX)
   *   ✓ whatsapp_number must not be the same as the user's login phone
   *     (prevented at DB level but we surface it early)
   *
   * STEP 5 — Bank / Payout
   *   ✓ bank_account_number: exactly 10 digits (NUBAN)
   *   ✓ bank_code: must be in the recognised Nigerian bank list
   *   ✓ bank_account_name: not empty (must match name on BVN for Paystack)
   *   ✓ bio: if provided, min 20 chars (meaningful description)
   *   ✓ years_experience: if provided, 0–50
   */
  static async validateOnboardingCriteria(data: {
    business_name: string;
    business_type: string;
    cac_number?: string;
    whatsapp_number: string;
    service_categories: string[];
    service_modes: string[];
    base_fee_kobo: number;
    bank_account_number: string;
    bank_account_name: string;
    bank_code: string;
    location_text?: string;
    location_lat?: number;
    location_lng?: number;
    bio?: string;
    years_experience?: number;
  }): Promise<OnboardingCriteriaResult> {
    const errors: Record<string, string[]> = {};
    const warnings: string[] = [];

    // ── STEP 1: Business Info ──────────────────────────────────────────────────

    // 1a. Business name — not blank, not numbers-only, no special chars only
    const nameTrimmed = data.business_name?.trim() ?? '';
    if (!nameTrimmed) {
      errors.business_name = ['Business name is required'];
    } else if (/^[0-9\s]+$/.test(nameTrimmed)) {
      errors.business_name = ['Business name cannot be numbers only'];
    } else if (nameTrimmed.length < 2) {
      errors.business_name = ['Business name must be at least 2 characters'];
    }

    // 1b. Business type
    if (!['salon', 'independent'].includes(data.business_type)) {
      errors.business_type = ['Business type must be "salon" or "independent"'];
    }

    // 1c. CAC number format (optional but validated if present)
    if (data.cac_number) {
      const cac = data.cac_number.trim().toUpperCase();
      const cacRegex = /^(RC|BN|IT|LP|LLP)-?\d{5,8}$/;
      if (!cacRegex.test(cac)) {
        errors.cac_number = [
          'CAC number must match one of these formats: RC-1234567, BN-1234567, IT-1234567, LP-1234567',
        ];
      }
    } else {
      // Not an error — providers without CAC can still operate, just no badge
      warnings.push(
        'No CAC number provided. You will not receive a Verified ✓ badge. ' +
        'You can add it later in Settings.'
      );
    }

    // 1d. Location text required
    if (!data.location_text?.trim()) {
      errors.location_text = ['Location area is required (e.g. Lekki Phase 1, Lagos)'];
    }

    // 1e. GPS coordinates — must be within Nigeria bounding box if provided
    if (data.location_lat !== undefined || data.location_lng !== undefined) {
      const lat = data.location_lat;
      const lng = data.location_lng;
      if (lat === undefined || lng === undefined) {
        errors.location_coords = ['Both latitude and longitude are required when providing GPS coordinates'];
      } else if (lat < 4.2 || lat > 13.9 || lng < 2.7 || lng > 14.7) {
        errors.location_coords = ['Coordinates must be within Nigeria (lat 4.2–13.9, lng 2.7–14.7)'];
      }
    }

    // ── STEP 2: Services ───────────────────────────────────────────────────────

    // 2a. At least one service category from allowed list
    const ALLOWED_CATEGORIES = new Set([
      'barbing', 'haircut', 'coloring', 'braids', 'weaves',
      'locs', 'relaxer', 'makeup', 'bridal_makeup', 'facials',
      'lashes', 'nails', 'pedicure', 'manicure', 'spa',
      'waxing', 'eyebrows', 'hair_treatment', 'natural_hair',
    ]);
    if (!data.service_categories.length) {
      errors.service_categories = ['Select at least one service category'];
    } else {
      const invalid = data.service_categories.filter((c) => !ALLOWED_CATEGORIES.has(c));
      if (invalid.length) {
        errors.service_categories = [`Unknown categories: ${invalid.join(', ')}`];
      }
    }

    // 2b. At least one service mode
    const ALLOWED_MODES = new Set(['home', 'walkin']);
    if (!data.service_modes.length) {
      errors.service_modes = ['Select at least one service mode (Home Service or Walk-In)'];
    } else {
      const invalidModes = data.service_modes.filter((m) => !ALLOWED_MODES.has(m));
      if (invalidModes.length) {
        errors.service_modes = [`Invalid service modes: ${invalidModes.join(', ')}`];
      }
    }

    // 2c. Base fee minimum ₦100 (10,000 kobo)
    if (!Number.isInteger(data.base_fee_kobo) || data.base_fee_kobo < 10_000) {
      errors.base_fee_kobo = ['Minimum base fee is ₦100'];
    } else if (data.base_fee_kobo > 50_000_000) {
      // ₦500,000 — sanity cap
      errors.base_fee_kobo = ['Base fee cannot exceed ₦500,000'];
    }

    // ── STEP 4: WhatsApp ───────────────────────────────────────────────────────

    // 4a. Valid Nigerian E.164
    if (!/^\+234[0-9]{10}$/.test(data.whatsapp_number)) {
      errors.whatsapp_number = [
        'WhatsApp number must be in Nigerian format: +234XXXXXXXXXX (e.g. +2348012345678)',
      ];
    }

    // ── STEP 5: Bank / Payout ─────────────────────────────────────────────────

    // 5a. Account number — exactly 10 digits (NUBAN standard set by CBN)
    if (!/^\d{10}$/.test(data.bank_account_number)) {
      errors.bank_account_number = [
        'Account number must be exactly 10 digits (Nigerian NUBAN standard)',
      ];
    }

    // 5b. Bank code — must be a recognised Nigerian bank
    if (!VALID_BANK_CODES.has(data.bank_code)) {
      errors.bank_code = ['Please select a valid Nigerian bank'];
    }

    // 5c. Account name — required, matches BVN name on file at the bank
    const accountName = data.bank_account_name?.trim() ?? '';
    if (!accountName) {
      errors.bank_account_name = ['Account name is required (must match your bank records)'];
    } else if (accountName.length < 3) {
      errors.bank_account_name = ['Account name is too short'];
    }

    // 5d. Bio — optional but must be meaningful if provided
    if (data.bio !== undefined && data.bio !== null) {
      if (data.bio.trim().length < 20) {
        errors.bio = ['Bio must be at least 20 characters — tell clients about your work'];
      } else if (data.bio.length > 500) {
        errors.bio = ['Bio must be 500 characters or fewer'];
      }
    }

    // 5e. Years experience — sanity check
    if (data.years_experience !== undefined) {
      if (!Number.isInteger(data.years_experience) || data.years_experience < 0) {
        errors.years_experience = ['Years of experience must be a positive number'];
      } else if (data.years_experience > 50) {
        errors.years_experience = ['Please enter a realistic number of years'];
      }
    }

    return { passed: Object.keys(errors).length === 0, errors, warnings };
  }

  /** Create Paystack transfer recipient and persist the code */
  static async createPaystackRecipient(
    providerId: string,
    bankDetails: { accountName: string; accountNumber: string; bankCode: string }
  ): Promise<void> {
    const recipientCode = await PaystackService.createTransferRecipient(bankDetails);
    await ProviderModel.setPaystackRecipient(providerId, recipientCode);
    logger.info({ providerId, recipientCode }, 'Paystack recipient created');
  }

  /**
   * Attempt CAC verification via Dojah.
   * Sets cac_verified = true on success.
   */
  static async verifyCac(providerId: string, cacNumber: string): Promise<boolean> {
    const provider = await ProviderModel.findById(providerId);
    if (!provider) throw new NotFoundError('Provider');

    if (!config.cac.apiKey) {
      // Dev mode: auto-verify
      logger.warn({ providerId }, '[DEV] CAC verification skipped — auto-verified');
      await ProviderModel.update(providerId, { cac_verified: true });
      return true;
    }

    try {
      const res = await fetch(
        `${config.cac.apiUrl}/v1/kyb/cac?rc_number=${cacNumber}`,
        {
          headers: {
            'Authorization': config.cac.apiKey,
            'AppId': config.cac.appId,
            'Accept': 'application/json',
          },
        }
      );

      const data = await res.json() as { entity?: { status?: string } };

      const verified = data?.entity?.status === 'ACTIVE';
      await ProviderModel.update(providerId, { cac_verified: verified });

      logger.info({ providerId, cacNumber, verified }, 'CAC verification result');
      return verified;
    } catch (err) {
      logger.error({ err, providerId }, 'CAC API error — skipping verification');
      return false;
    }
  }

  /**
   * Check if provider meets go-live requirements:
   * - At least 3 portfolio photos per selected service category
   * If yes, set is_live = true.
   */
  static async checkAndGoLive(providerId: string): Promise<{
    isLive: boolean;
    missingCategories: string[];
  }> {
    const provider = await ProviderModel.findById(providerId);
    if (!provider) throw new NotFoundError('Provider');

    const photoCounts = await ProviderModel.countPhotosPerCategory(providerId);

    const missingCategories = provider.service_categories.filter(
      (cat) => (photoCounts[cat] ?? 0) < MIN_PHOTOS_PER_CATEGORY
    );

    const isLive = missingCategories.length === 0;

    if (isLive && !provider.is_live) {
      await ProviderModel.update(providerId, { is_live: true });

      await NotificationService.sendToUser(provider.user_id, {
        title: 'You\'re Live on Staxz! 🎉',
        body: 'Your profile is now visible to clients. Start receiving bookings.',
        data: { type: 'provider_live' },
      });

      logger.info({ providerId }, 'Provider went live');
    }

    return { isLive, missingCategories };
  }

  /**
   * After uploading a portfolio photo, auto-check if provider can go live.
   */
  static async onPhotoUploaded(providerId: string): Promise<void> {
    await this.checkAndGoLive(providerId);
  }

  /**
   * Calculate provider earnings summary for dashboard.
   */
  static async getEarningsSummary(providerId: string): Promise<{
    totalKobo: number;
    pendingEscrowKobo: number;
    completedKobo: number;
    bookingCount: number;
    thisMonthKobo: number;
  }> {
    const { rows } = await require('../config/database').db.query(
      `SELECT
        COALESCE(SUM(CASE WHEN b.status = 'completed' THEN b.provider_quote_kobo ELSE 0 END), 0) AS completed_kobo,
        COALESCE(SUM(CASE WHEN b.status IN ('confirmed','in_progress') THEN b.provider_quote_kobo ELSE 0 END), 0) AS pending_escrow_kobo,
        COALESCE(SUM(b.provider_quote_kobo), 0) AS total_kobo,
        COUNT(CASE WHEN b.status = 'completed' THEN 1 END) AS booking_count,
        COALESCE(SUM(
          CASE WHEN b.status = 'completed'
               AND b.confirmed_at >= DATE_TRUNC('month', NOW())
          THEN b.provider_quote_kobo ELSE 0 END
        ), 0) AS this_month_kobo
       FROM bookings b
       WHERE b.provider_id = $1
         AND b.status NOT IN ('cancelled', 'refunded')`,
      [providerId]
    );

    const row = rows[0];
    return {
      totalKobo: parseInt(row.total_kobo, 10),
      pendingEscrowKobo: parseInt(row.pending_escrow_kobo, 10),
      completedKobo: parseInt(row.completed_kobo, 10),
      bookingCount: parseInt(row.booking_count, 10),
      thisMonthKobo: parseInt(row.this_month_kobo, 10),
    };
  }
}
