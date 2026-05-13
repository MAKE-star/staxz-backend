-- ============================================================
-- Staxz Database Schema — Migration 001
-- Run: psql $DATABASE_URL -f database/migrations/001_initial_schema.sql
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ENUMS ───────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('hirer', 'provider', 'admin');
CREATE TYPE business_type AS ENUM ('salon', 'independent');
CREATE TYPE service_mode AS ENUM ('home', 'walkin');
CREATE TYPE booking_status AS ENUM (
  'pending_payment', 'confirmed', 'in_progress',
  'completed', 'disputed', 'cancelled', 'refunded'
);
CREATE TYPE enquiry_status AS ENUM ('pending', 'quoted', 'accepted', 'expired', 'declined');
CREATE TYPE dispute_status AS ENUM (
  'open', 'reviewing', 'resolved_refund', 'resolved_released'
);
CREATE TYPE transaction_type AS ENUM (
  'payment', 'escrow_release', 'refund', 'cancellation_fee'
);

-- ─── USERS ───────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       VARCHAR(20)  UNIQUE NOT NULL,
  role        user_role    NOT NULL DEFAULT 'hirer',
  full_name   VARCHAR(100),
  avatar_url  TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_role  ON users(role);

-- ─── PROVIDERS ───────────────────────────────────────────────────────────────

CREATE TABLE providers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name       VARCHAR(120)  NOT NULL,
  business_type       business_type NOT NULL,
  cac_number          VARCHAR(30)   UNIQUE,
  cac_verified        BOOLEAN       NOT NULL DEFAULT false,
  whatsapp_number     VARCHAR(20)   NOT NULL,
  location_text       VARCHAR(200),
  location_lat        NUMERIC(10,7),
  location_lng        NUMERIC(10,7),
  service_modes       service_mode[] NOT NULL DEFAULT '{}',
  base_fee_kobo       INTEGER       NOT NULL,
  service_categories  TEXT[]        NOT NULL DEFAULT '{}',
  rating_avg          NUMERIC(3,2)  NOT NULL DEFAULT 0,
  rating_count        INTEGER       NOT NULL DEFAULT 0,
  is_live             BOOLEAN       NOT NULL DEFAULT false,
  is_flagged          BOOLEAN       NOT NULL DEFAULT false,
  flag_reason         TEXT,
  paystack_recipient_code  VARCHAR(50),
  bio                 VARCHAR(500),
  years_experience    SMALLINT      CHECK (years_experience >= 0),
  bank_account_name   VARCHAR(100),
  bank_account_number VARCHAR(10),
  bank_code           VARCHAR(10),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_providers_user_id     ON providers(user_id);
CREATE INDEX idx_providers_is_live     ON providers(is_live);
CREATE INDEX idx_providers_whatsapp    ON providers(whatsapp_number);
CREATE INDEX idx_providers_location    ON providers(location_lat, location_lng)
  WHERE location_lat IS NOT NULL;

-- ─── PORTFOLIO PHOTOS ────────────────────────────────────────────────────────

CREATE TABLE portfolio_photos (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id            UUID        NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  category_id            TEXT        NOT NULL,
  cloudinary_public_id   TEXT        NOT NULL,
  url                    TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_portfolio_provider ON portfolio_photos(provider_id);
CREATE INDEX idx_portfolio_category ON portfolio_photos(provider_id, category_id);

-- ─── ENQUIRIES ───────────────────────────────────────────────────────────────

CREATE TABLE enquiries (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  hirer_id              UUID          NOT NULL REFERENCES users(id),
  provider_id           UUID          NOT NULL REFERENCES providers(id),
  category_id           TEXT          NOT NULL,
  service_type          service_mode  NOT NULL,
  inspiration_photo_url TEXT,
  notes                 TEXT,
  status                enquiry_status NOT NULL DEFAULT 'pending',
  quote_kobo            INTEGER,
  quote_expires_at      TIMESTAMPTZ,
  wati_conversation_id  TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_enquiries_hirer      ON enquiries(hirer_id);
CREATE INDEX idx_enquiries_provider   ON enquiries(provider_id);
CREATE INDEX idx_enquiries_status     ON enquiries(status);
CREATE INDEX idx_enquiries_wati       ON enquiries(wati_conversation_id);

-- ─── BOOKINGS ────────────────────────────────────────────────────────────────

CREATE TABLE bookings (
  id                    UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             VARCHAR(12)    UNIQUE NOT NULL,
  hirer_id              UUID           NOT NULL REFERENCES users(id),
  provider_id           UUID           NOT NULL REFERENCES providers(id),
  service_type          service_mode   NOT NULL,
  service_address       TEXT,
  provider_quote_kobo   INTEGER        NOT NULL,
  platform_fee_kobo     INTEGER        NOT NULL,
  total_charged_kobo    INTEGER        NOT NULL,
  status                booking_status NOT NULL DEFAULT 'pending_payment',
  scheduled_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  confirmed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  paystack_ref          VARCHAR(100),
  escrow_released       BOOLEAN        NOT NULL DEFAULT false,
  notes                 TEXT,
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_fee_positive CHECK (platform_fee_kobo >= 0),
  CONSTRAINT chk_total_correct CHECK (total_charged_kobo = provider_quote_kobo + platform_fee_kobo)
);

CREATE INDEX idx_bookings_hirer       ON bookings(hirer_id);
CREATE INDEX idx_bookings_provider    ON bookings(provider_id);
CREATE INDEX idx_bookings_status      ON bookings(status);
CREATE INDEX idx_bookings_reference   ON bookings(reference);
CREATE INDEX idx_bookings_paystack    ON bookings(paystack_ref);
CREATE INDEX idx_bookings_created     ON bookings(created_at DESC);

-- ─── REVIEWS ─────────────────────────────────────────────────────────────────

CREATE TABLE reviews (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID        NOT NULL REFERENCES bookings(id),
  reviewer_id  UUID        NOT NULL REFERENCES users(id),
  reviewee_id  UUID        NOT NULL REFERENCES users(id),
  stars        SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  body         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (booking_id, reviewer_id)
);

CREATE INDEX idx_reviews_reviewee ON reviews(reviewee_id);
CREATE INDEX idx_reviews_booking  ON reviews(booking_id);

-- ─── TRANSACTIONS ────────────────────────────────────────────────────────────

CREATE TABLE transactions (
  id            UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID             NOT NULL REFERENCES bookings(id),
  type          transaction_type NOT NULL,
  amount_kobo   INTEGER          NOT NULL,
  paystack_ref  VARCHAR(100),
  status        VARCHAR(20)      NOT NULL DEFAULT 'pending',
  metadata      JSONB            NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_booking ON transactions(booking_id);
CREATE INDEX idx_transactions_type    ON transactions(type);

-- ─── DISPUTES ────────────────────────────────────────────────────────────────

CREATE TABLE disputes (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID           NOT NULL REFERENCES bookings(id),
  raised_by        UUID           NOT NULL REFERENCES users(id),
  reason           TEXT           NOT NULL,
  details          TEXT,
  status           dispute_status NOT NULL DEFAULT 'open',
  resolved_by      UUID           REFERENCES users(id),
  resolution_note  TEXT,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_disputes_booking ON disputes(booking_id);
CREATE INDEX idx_disputes_status  ON disputes(status);

-- ─── CONVERSATIONS (WhatsApp message log) ───────────────────────────────────

CREATE TABLE conversations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id        UUID        REFERENCES enquiries(id) ON DELETE SET NULL,
  booking_id        UUID        REFERENCES bookings(id)  ON DELETE SET NULL,
  provider_wa_id    VARCHAR(20) NOT NULL,
  hirer_id          UUID        NOT NULL REFERENCES users(id),
  provider_id       UUID        NOT NULL REFERENCES providers(id),
  direction         VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_role         VARCHAR(10) NOT NULL CHECK (from_role IN ('bot', 'hirer', 'provider', 'system')),
  message_text      TEXT        NOT NULL,
  media_url         TEXT,
  wati_message_id   TEXT        UNIQUE,          -- idempotency key
  raw_payload       JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conv_booking    ON conversations(booking_id);
CREATE INDEX idx_conv_enquiry    ON conversations(enquiry_id);
CREATE INDEX idx_conv_provider   ON conversations(provider_id);
CREATE INDEX idx_conv_wati_msg   ON conversations(wati_message_id) WHERE wati_message_id IS NOT NULL;
CREATE INDEX idx_conv_created    ON conversations(created_at DESC);

-- ─── PUSH TOKENS ─────────────────────────────────────────────────────────────

CREATE TABLE push_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT        UNIQUE NOT NULL,
  platform    VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android')),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_push_tokens_user ON push_tokens(user_id) WHERE is_active = true;

-- ─── SAVED PROVIDERS ─────────────────────────────────────────────────────────

CREATE TABLE saved_providers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hirer_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id UUID        NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hirer_id, provider_id)
);

CREATE INDEX idx_saved_hirer    ON saved_providers(hirer_id);
CREATE INDEX idx_saved_provider ON saved_providers(provider_id);

-- ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

CREATE TYPE notification_type AS ENUM (
  'booking_confirmed', 'booking_completed', 'booking_cancelled',
  'quote_received', 'payment_released', 'refund_issued',
  'dispute_raised', 'dispute_resolved',
  'review_received', 'provider_live', 'enquiry_expired',
  'general'
);

CREATE TABLE notifications (
  id          UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL DEFAULT 'general',
  title       VARCHAR(100)      NOT NULL,
  body        TEXT              NOT NULL,
  data        JSONB             NOT NULL DEFAULT '{}',
  is_read     BOOLEAN           NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifs_user       ON notifications(user_id);
CREATE INDEX idx_notifs_unread     ON notifications(user_id) WHERE is_read = false;
CREATE INDEX idx_notifs_created    ON notifications(created_at DESC);

-- ─── WITHDRAWALS ──────────────────────────────────────────────────────────────

CREATE TYPE withdrawal_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE withdrawals (
  id                   UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id          UUID              NOT NULL REFERENCES providers(id),
  amount_kobo          INTEGER           NOT NULL CHECK (amount_kobo > 0),
  status               withdrawal_status NOT NULL DEFAULT 'pending',
  paystack_transfer_ref VARCHAR(100),
  paystack_transfer_code VARCHAR(100),
  failure_reason       TEXT,
  initiated_at         TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);

CREATE INDEX idx_withdrawals_provider ON withdrawals(provider_id);
CREATE INDEX idx_withdrawals_status   ON withdrawals(status);

-- ─── SAVED CARD TOKENS (Paystack) ────────────────────────────────────────────

CREATE TABLE saved_cards (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paystack_auth_code    TEXT        NOT NULL,
  last4                 CHAR(4)     NOT NULL,
  card_type             VARCHAR(20),                   -- visa, mastercard etc.
  exp_month             SMALLINT,
  exp_year              SMALLINT,
  bank                  VARCHAR(60),
  is_default            BOOLEAN     NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, paystack_auth_code)
);

CREATE INDEX idx_saved_cards_user ON saved_cards(user_id);

-- ─── is_flagged on users table ────────────────────────────────────────────────
-- Admins can flag hirer accounts (not just providers)

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_flagged   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flag_reason  TEXT;

-- ─── SEED: ADMIN USER ────────────────────────────────────────────────────────

INSERT INTO users (phone, role, full_name)
VALUES ('+2348000000000', 'admin', 'Staxz Admin')
ON CONFLICT (phone) DO NOTHING;
