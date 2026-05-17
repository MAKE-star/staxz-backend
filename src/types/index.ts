import { Request } from 'express';

// ─── ENUMS ────────────────────────────────────────────────────────────────────

export enum UserRole {
  HIRER = 'hirer',
  PROVIDER = 'provider',
  ADMIN = 'admin',
}

export enum BusinessType {
  SALON = 'salon',
  INDEPENDENT = 'independent',
}

export enum ServiceMode {
  HOME = 'home',
  WALKIN = 'walkin',
}

export enum BookingStatus {
  PENDING_PAYMENT = 'pending_payment',
  CONFIRMED = 'confirmed',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  DISPUTED = 'disputed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum EnquiryStatus {
  PENDING = 'pending',
  QUOTED = 'quoted',
  ACCEPTED = 'accepted',
  EXPIRED = 'expired',
  DECLINED = 'declined',
}

export enum DisputeStatus {
  OPEN = 'open',
  REVIEWING = 'reviewing',
  RESOLVED_REFUND = 'resolved_refund',
  RESOLVED_RELEASED = 'resolved_released',
}

export enum TransactionType {
  PAYMENT = 'payment',
  ESCROW_RELEASE = 'escrow_release',
  REFUND = 'refund',
  CANCELLATION_FEE = 'cancellation_fee',
}

export enum NotificationType {
  BOOKING_CONFIRMED  = 'booking_confirmed',
  BOOKING_COMPLETED  = 'booking_completed',
  BOOKING_CANCELLED  = 'booking_cancelled',
  QUOTE_RECEIVED     = 'quote_received',
  PAYMENT_RELEASED   = 'payment_released',
  REFUND_ISSUED      = 'refund_issued',
  DISPUTE_RAISED     = 'dispute_raised',
  DISPUTE_RESOLVED   = 'dispute_resolved',
  REVIEW_RECEIVED    = 'review_received',
  PROVIDER_LIVE      = 'provider_live',
  ENQUIRY_EXPIRED    = 'enquiry_expired',
  GENERAL            = 'general',
}

export enum WithdrawalStatus {
  PENDING    = 'pending',
  PROCESSING = 'processing',
  COMPLETED  = 'completed',
  FAILED     = 'failed',
}

// ─── DATABASE ROW TYPES ───────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  phone: string;
  role: UserRole;
  full_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  is_flagged: boolean;
  flag_reason: string | null;
  created_at: Date;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
  is_read: boolean;
  created_at: Date;
}

export interface WithdrawalRow {
  id: string;
  provider_id: string;
  amount_kobo: number;
  status: WithdrawalStatus;
  paystack_transfer_ref: string | null;
  paystack_transfer_code: string | null;
  failure_reason: string | null;
  initiated_at: Date;
  completed_at: Date | null;
}

export interface SavedCardRow {
  id: string;
  user_id: string;
  paystack_auth_code: string;
  last4: string;
  card_type: string | null;
  exp_month: number | null;
  exp_year: number | null;
  bank: string | null;
  is_default: boolean;
  created_at: Date;
}

export interface SavedProviderRow {
  id: string;
  hirer_id: string;
  provider_id: string;
  created_at: Date;
}

export interface ProviderRow {
  id: string;
  user_id: string;
  business_name: string;
  business_type: BusinessType;
  cac_number: string | null;
  cac_verified: boolean;
  whatsapp_number: string;
  state: string | null;
  location_text: string | null;
  full_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  service_modes: ServiceMode[];
  base_fee_kobo: number;
  service_categories: string[];
  rating_avg: number;
  rating_count: number;
  is_live: boolean;
  is_flagged: boolean;
  flag_reason: string | null;
  paystack_recipient_code: string | null;
  bio: string | null;
  years_experience: number | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_code: string | null;
  created_at: Date;
}

export interface BookingRow {
  id: string;
  reference: string;
  hirer_id: string;
  provider_id: string;
  service_type: ServiceMode;
  service_address: string | null;
  provider_quote_kobo: number;
  platform_fee_kobo: number;
  total_charged_kobo: number;
  status: BookingStatus;
  scheduled_at: Date | null;
  completed_at: Date | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  paystack_ref: string | null;
  escrow_released: boolean;
  notes: string | null;
  created_at: Date;
}

export interface EnquiryRow {
  id: string;
  hirer_id: string;
  provider_id: string;
  category_id: string;
  service_type: ServiceMode;
  inspiration_photo_url: string | null;
  notes: string | null;
  status: EnquiryStatus;
  quote_kobo: number | null;
  quote_expires_at: Date | null;
  wati_conversation_id: string | null;
  created_at: Date;
}

export interface ReviewRow {
  id: string;
  booking_id: string;
  reviewer_id: string;
  reviewee_id: string;
  stars: number;
  body: string | null;
  created_at: Date;
}

export interface TransactionRow {
  id: string;
  booking_id: string;
  type: TransactionType;
  amount_kobo: number;
  paystack_ref: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface DisputeRow {
  id: string;
  booking_id: string;
  raised_by: string;
  reason: string;
  details: string | null;
  status: DisputeStatus;
  resolved_by: string | null;
  resolution_note: string | null;
  resolved_at: Date | null;
  created_at: Date;
}

export interface PortfolioPhotoRow {
  id: string;
  provider_id: string;
  category_id: string;
  cloudinary_public_id: string;
  url: string;
  created_at: Date;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
}

// ─── REQUEST EXTENSIONS ───────────────────────────────────────────────────────

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  phone: string;
}

// Extend Request directly so params/body/query are available
export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

// ─── SERVICE LAYER TYPES ─────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface ProvidersQueryParams {
  lat?: number;
  lng?: number;
  radius?: number; // km
  category?: string;
  mode?: ServiceMode;
  state?: string;
  sort?: 'rating' | 'distance' | 'price';
  page?: number;
  limit?: number;
}

export interface JwtPayload {
  sub: string;       // user id
  role: UserRole;
  phone: string;
  iat: number;
  exp: number;
}

export interface OtpRecord {
  code: string;
  attempts: number;
  expiresAt: number;
}

export interface PaystackWebhookEvent {
  event: string;
  data: {
    id: number;
    reference: string;
    amount: number;
    status: string;
    metadata: Record<string, unknown>;
  };
}

export interface WatiWebhookPayload {
  waId: string;          // WhatsApp number
  text: string;
  messageId: string;
  timestamp: string;
  conversationId?: string;
}

// ─── API RESPONSE TYPES ───────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, string[]>;
}