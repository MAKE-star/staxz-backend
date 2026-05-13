import { db } from '../config/database';

export interface ConversationRow {
  id: string;
  enquiry_id: string | null;
  booking_id: string | null;
  provider_wa_id: string;
  hirer_id: string;
  provider_id: string;
  direction: 'inbound' | 'outbound';
  from_role: 'bot' | 'hirer' | 'provider' | 'system';
  message_text: string;
  media_url: string | null;
  wati_message_id: string | null;
  raw_payload: Record<string, unknown>;
  created_at: Date;
}

export class ConversationModel {
  /** Log any message — inbound or outbound */
  static async log(data: {
    enquiry_id?: string;
    booking_id?: string;
    provider_wa_id: string;
    hirer_id: string;
    provider_id: string;
    direction: 'inbound' | 'outbound';
    from_role: 'bot' | 'hirer' | 'provider' | 'system';
    message_text: string;
    media_url?: string;
    wati_message_id?: string;
    raw_payload?: Record<string, unknown>;
  }): Promise<ConversationRow | null> {
    // Idempotency: skip if message_id already processed
    if (data.wati_message_id) {
      const { rows: existing } = await db.query<{ id: string }>(
        'SELECT id FROM conversations WHERE wati_message_id = $1',
        [data.wati_message_id]
      );
      if (existing.length) return null; // already logged — duplicate webhook
    }

    const { rows } = await db.query<ConversationRow>(
      `INSERT INTO conversations (
        enquiry_id, booking_id, provider_wa_id, hirer_id, provider_id,
        direction, from_role, message_text, media_url, wati_message_id, raw_payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        data.enquiry_id ?? null,
        data.booking_id ?? null,
        data.provider_wa_id,
        data.hirer_id,
        data.provider_id,
        data.direction,
        data.from_role,
        data.message_text,
        data.media_url ?? null,
        data.wati_message_id ?? null,
        JSON.stringify(data.raw_payload ?? {}),
      ]
    );
    return rows[0] ?? null;
  }

  /** Get full thread for a booking (admin view) */
  static async findByBookingId(bookingId: string): Promise<ConversationRow[]> {
    const { rows } = await db.query<ConversationRow>(
      `SELECT c.*,
              u.full_name AS hirer_name,
              p.business_name AS provider_name
       FROM conversations c
       JOIN users u ON u.id = c.hirer_id
       JOIN providers p ON p.id = c.provider_id
       WHERE c.booking_id = $1 OR c.enquiry_id IN (
         SELECT id FROM enquiries WHERE hirer_id = (
           SELECT hirer_id FROM bookings WHERE id = $1
         )
       )
       ORDER BY c.created_at ASC`,
      [bookingId]
    );
    return rows;
  }

  /** Get full thread for an enquiry */
  static async findByEnquiryId(enquiryId: string): Promise<ConversationRow[]> {
    const { rows } = await db.query<ConversationRow>(
      'SELECT * FROM conversations WHERE enquiry_id = $1 ORDER BY created_at ASC',
      [enquiryId]
    );
    return rows;
  }

  /** List all conversations for admin — paginated */
  static async listAll(
    page = 1,
    limit = 30,
    filter?: { providerId?: string; hasDispute?: boolean }
  ): Promise<{ rows: ConversationRow[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filter?.providerId) {
      conditions.push(`c.provider_id = $${idx++}`);
      values.push(filter.providerId);
    }
    if (filter?.hasDispute) {
      conditions.push(`EXISTS (
        SELECT 1 FROM disputes d
        WHERE d.booking_id = c.booking_id AND d.status IN ('open','reviewing')
      )`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    // Group by booking/enquiry thread, show last message + count
    const [countRes, dataRes] = await Promise.all([
      db.query<{ count: string }>(
        `SELECT COUNT(DISTINCT COALESCE(booking_id::text, enquiry_id::text))
         FROM conversations c ${where}`,
        values
      ),
      db.query<ConversationRow>(
        `SELECT DISTINCT ON (COALESCE(c.booking_id::text, c.enquiry_id::text))
                c.*,
                u.full_name  AS hirer_name,
                p.business_name AS provider_name
         FROM conversations c
         JOIN users u ON u.id = c.hirer_id
         JOIN providers p ON p.id = c.provider_id
         ${where}
         ORDER BY COALESCE(c.booking_id::text, c.enquiry_id::text), c.created_at DESC
         LIMIT $${idx++} OFFSET $${idx}`,
        [...values, limit, offset]
      ),
    ]);

    return {
      rows: dataRes.rows,
      total: parseInt(countRes.rows[0]?.count ?? '0', 10),
    };
  }
}
