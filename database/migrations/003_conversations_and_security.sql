-- ============================================================
-- Migration 003: conversations table + security columns
-- ============================================================

-- ─── CONVERSATIONS (WhatsApp message log) ────────────────────────────────────
-- Every message in/out of the WhatsApp bot is logged here.
-- Admin portal reads this. Bot writes on every event.
-- wati_message_id is the idempotency key — prevents duplicate processing.

CREATE TABLE IF NOT EXISTS conversations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id       UUID        REFERENCES enquiries(id) ON DELETE SET NULL,
  booking_id       UUID        REFERENCES bookings(id)  ON DELETE SET NULL,
  provider_wa_id   VARCHAR(20) NOT NULL,
  hirer_id         UUID        NOT NULL REFERENCES users(id),
  provider_id      UUID        NOT NULL REFERENCES providers(id),
  direction        VARCHAR(10) NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_role        VARCHAR(10) NOT NULL CHECK (from_role IN ('bot','hirer','provider','system')),
  message_text     TEXT        NOT NULL,
  media_url        TEXT,
  wati_message_id  TEXT        UNIQUE,
  raw_payload      JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_enquiry  ON conversations(enquiry_id);
CREATE INDEX IF NOT EXISTS idx_conversations_booking  ON conversations(booking_id);
CREATE INDEX IF NOT EXISTS idx_conversations_provider ON conversations(provider_id);
CREATE INDEX IF NOT EXISTS idx_conversations_wati_id  ON conversations(wati_message_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created  ON conversations(created_at DESC);

-- ─── PROVIDER CONTACT ENCRYPTION COLUMNS ─────────────────────────────────────
-- Per §8.1: provider phone/address encrypted at rest.
-- Actual encryption handled in application layer (AES-256-GCM).
-- Raw whatsapp_number kept for bot routing; encrypted copy is what client sees.

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS contact_encrypted   TEXT,    -- AES-encrypted JSON {phone, address}
  ADD COLUMN IF NOT EXISTS contact_iv          TEXT;    -- IV for AES-GCM decryption

-- ─── USER ACTIVITY ───────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- ─── BOOKINGS: flag for provider no-show ─────────────────────────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS provider_no_show BOOLEAN NOT NULL DEFAULT false;

-- ─── EXTRA PERFORMANCE INDEXES ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_status_created
  ON bookings(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_enquiries_expires
  ON enquiries(quote_expires_at)
  WHERE status = 'pending';
