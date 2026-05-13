-- ============================================================
-- Staxz Database Schema — Migration 002
-- Additional indexes, constraints, and helper functions
-- ============================================================

-- ─── FUNCTION: auto-expire pending enquiries ─────────────────────────────────
CREATE OR REPLACE FUNCTION expire_pending_enquiries()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE enquiries
  SET status = 'expired'
  WHERE status = 'pending'
    AND quote_expires_at < NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- ─── FUNCTION: recalculate provider rating ───────────────────────────────────
CREATE OR REPLACE FUNCTION recalculate_provider_rating(p_provider_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE providers SET
    rating_avg = (
      SELECT COALESCE(ROUND(AVG(r.stars)::NUMERIC, 2), 0)
      FROM reviews r
      WHERE r.reviewee_id = (SELECT user_id FROM providers WHERE id = p_provider_id)
    ),
    rating_count = (
      SELECT COUNT(*)
      FROM reviews r
      WHERE r.reviewee_id = (SELECT user_id FROM providers WHERE id = p_provider_id)
    )
  WHERE id = p_provider_id;
END;
$$ LANGUAGE plpgsql;

-- ─── TRIGGER: auto-recalculate rating after review insert ────────────────────
CREATE OR REPLACE FUNCTION trigger_recalculate_rating()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalculate_provider_rating(
    (SELECT id FROM providers WHERE user_id = NEW.reviewee_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_review_insert
AFTER INSERT ON reviews
FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_rating();

-- ─── VIEW: booking summary (useful for admin dashboard) ──────────────────────
CREATE OR REPLACE VIEW booking_summary AS
SELECT
  b.id,
  b.reference,
  b.status,
  b.total_charged_kobo,
  b.platform_fee_kobo,
  b.provider_quote_kobo,
  b.created_at,
  b.confirmed_at,
  b.escrow_released,
  u_hirer.full_name   AS hirer_name,
  u_hirer.phone       AS hirer_phone,
  pr.business_name    AS provider_name,
  u_prov.phone        AS provider_phone,
  d.status            AS dispute_status
FROM bookings b
JOIN users u_hirer       ON u_hirer.id   = b.hirer_id
JOIN providers pr        ON pr.id        = b.provider_id
JOIN users u_prov        ON u_prov.id    = pr.user_id
LEFT JOIN disputes d     ON d.booking_id = b.id
                        AND d.status IN ('open', 'reviewing');

-- ─── ADDITIONAL PERFORMANCE INDEXES ──────────────────────────────────────────

-- Fast lookup of live providers by category
CREATE INDEX idx_providers_cats_gin ON providers USING gin(service_categories);
CREATE INDEX idx_providers_modes_gin ON providers USING gin(service_modes);

-- Fast lookup of enquiries that need expiry processing
CREATE INDEX idx_enquiries_expiry ON enquiries(quote_expires_at)
  WHERE status = 'pending';

-- Fast lookup of bookings needing payment expiry
CREATE INDEX idx_bookings_payment_expiry ON bookings(created_at)
  WHERE status = 'pending_payment' AND paystack_ref IS NULL;

-- Dispute resolution queue
CREATE INDEX idx_disputes_open_age ON disputes(created_at)
  WHERE status IN ('open', 'reviewing');

-- Composite: find a user's active bookings quickly
CREATE INDEX idx_bookings_hirer_status ON bookings(hirer_id, status);
CREATE INDEX idx_bookings_provider_status ON bookings(provider_id, status);
