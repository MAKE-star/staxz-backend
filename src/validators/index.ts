import { z } from 'zod';

const phoneSchema = z
  .string()
  .regex(/^\+234[0-9]{10}$/, 'Phone must be E.164 Nigerian format: +234XXXXXXXXXX');

export const requestOtpSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    role: z.enum(['hirer', 'provider']).optional(),
  }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    code: z.string().length(6, 'OTP must be 6 digits').regex(/^\d+$/, 'OTP must be numeric'),
    role: z.enum(['hirer', 'provider']).optional(),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token required'),
  }),
});

export const onboardProviderSchema = z.object({
  body: z.object({
    // ── STEP 1: Business Info ───────────────────────────────────────────────
    business_name: z
      .string()
      .min(2, 'Business name must be at least 2 characters')
      .max(120)
      .refine((v) => !/^[0-9\s]+$/.test(v.trim()), 'Business name cannot be numbers only'),
    business_type: z.enum(['salon', 'independent'], {
      errorMap: () => ({ message: 'Business type must be salon or independent' }),
    }),
    cac_number: z
      .string()
      .regex(/^(RC|BN|IT|LP|LLP)-?\d{5,9}$/i, 'CAC format: RC-1234567 or BN-9515166'),
    state: z.string().min(2, 'State is required').max(50),
    location_text: z.string().min(3, 'Location area is required').max(200),
    full_address: z.string().min(5, 'Full address is required').max(500).optional(),
    location_lat: z.number().min(4.2).max(13.9).optional(),
    location_lng: z.number().min(2.7).max(14.7).optional(),

    // ── STEP 2: Services ────────────────────────────────────────────────────
    service_categories: z
      .array(z.enum([
        'barbing', 'haircut', 'coloring', 'braids', 'weaves',
        'locs', 'relaxer', 'makeup', 'bridal_makeup', 'facials',
        'lashes', 'nails', 'pedicure', 'manicure', 'spa',
        'waxing', 'eyebrows', 'hair_treatment', 'natural_hair',
        'natural', 'barber',
      ]))
      .min(1, 'Select at least one service category'),
    service_modes: z
      .array(z.enum(['home', 'walkin']))
      .min(1, 'Select at least one service mode'),
    base_fee_kobo: z
      .number()
      .int()
      .min(10_000, 'Minimum base fee is ₦100')
      .max(50_000_000, 'Base fee cannot exceed ₦500,000'),

    // ── STEP 4: WhatsApp ────────────────────────────────────────────────────
    whatsapp_number: phoneSchema,

    // ── STEP 5: Bank / Payout ───────────────────────────────────────────────
    bank_account_name: z.string().min(3, 'Account name is required').max(100),
    bank_account_number: z
      .string()
      .length(10, 'Account number must be exactly 10 digits')
      .regex(/^\d+$/, 'Account number must be digits only'),
    bank_code: z.string().min(3).max(10),

    // ── Optional fields ─────────────────────────────────────────────────────
    bio: z.string().max(500).optional(),
    years_experience: z.number().int().min(0).max(50).optional(),
  }),
});

export const acceptQuoteSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    scheduled_at: z.string().datetime({ message: 'scheduled_at must be ISO 8601 datetime' }).optional(),
    service_address: z.string().min(5).max(300).optional(),
  }),
});


export const createEnquirySchema = z.object({
  body: z.object({
    providerId: z.string().uuid(),
    categoryId: z.string().min(1),
    serviceType: z.enum(['home', 'walkin']),
    inspirationPhotoUrl: z.string().url().optional(),
    notes: z.string().max(500).optional(),
  }),
});

export const raiseDisputeSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    reason: z.enum([
      "Provider didn't show up",
      'Service was not as described',
      'Provider was unprofessional',
      'Wrong service performed',
      'Other',
    ]),
    details: z.string().max(1000).optional(),
  }),
});

export const leaveReviewSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    stars: z.number().int().min(1).max(5),
    body: z.string().max(1000).optional(),
  }),
});

export const resolveDisputeSchema = z.object({
  params: z.object({ bookingId: z.string().uuid() }),
  body: z.object({
    action: z.enum(['refund_hirer', 'release_escrow']),
    note: z.string().min(5, 'Please provide a resolution note'),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    full_name: z.string().min(2).max(100).optional(),
    avatar_url: z.string().url().optional(),
  }).refine(data => Object.keys(data).length > 0, {
    message: 'At least one field required',
  }),
});

export const pushTokenSchema = z.object({
  body: z.object({
    token: z.string().min(10, 'Invalid push token'),
    platform: z.enum(['ios', 'android']),
  }),
});