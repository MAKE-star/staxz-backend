import { db } from '../config/database';
import { EnquiryRow, EnquiryStatus } from '../types';

export class EnquiryModel {
  static async findById(id: string): Promise<EnquiryRow | null> {
    const { rows } = await db.query<EnquiryRow>(
      'SELECT * FROM enquiries WHERE id = $1',
      [id]
    );
    return rows[0] ?? null;
  }

  static async findByWatiConversation(conversationId: string): Promise<EnquiryRow | null> {
    const { rows } = await db.query<EnquiryRow>(
      'SELECT * FROM enquiries WHERE wati_conversation_id = $1',
      [conversationId]
    );
    return rows[0] ?? null;
  }

  static async findPendingForProvider(providerId: string): Promise<EnquiryRow[]> {
    const { rows } = await db.query<EnquiryRow>(
      `SELECT * FROM enquiries
       WHERE provider_id = $1 AND status = $2
       AND quote_expires_at > NOW()
       ORDER BY created_at DESC`,
      [providerId, EnquiryStatus.PENDING]
    );
    return rows;
  }

  static async create(data: {
    hirer_id: string;
    provider_id: string;
    category_id: string;
    service_type: string;
    inspiration_photo_url?: string;
    notes?: string;
    wati_conversation_id?: string;
  }): Promise<EnquiryRow> {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 min

    const { rows } = await db.query<EnquiryRow>(
      `INSERT INTO enquiries (
        hirer_id, provider_id, category_id, service_type,
        inspiration_photo_url, notes, status, quote_expires_at, wati_conversation_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        data.hirer_id, data.provider_id, data.category_id, data.service_type,
        data.inspiration_photo_url ?? null, data.notes ?? null,
        EnquiryStatus.PENDING, expiresAt, data.wati_conversation_id ?? null,
      ]
    );
    return rows[0];
  }

  static async setQuote(
    id: string,
    quoteKobo: number
  ): Promise<EnquiryRow | null> {
    const quoteExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min to pay
    const { rows } = await db.query<EnquiryRow>(
      `UPDATE enquiries
       SET status = $1, quote_kobo = $2, quote_expires_at = $3
       WHERE id = $4
       RETURNING *`,
      [EnquiryStatus.QUOTED, quoteKobo, quoteExpiresAt, id]
    );
    return rows[0] ?? null;
  }

  static async updateStatus(id: string, status: EnquiryStatus): Promise<void> {
    await db.query(
      'UPDATE enquiries SET status = $1 WHERE id = $2',
      [status, id]
    );
  }

  /** Expire enquiries where provider did not respond within 60 mins */
  static async expireStale(): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>(
      `UPDATE enquiries SET status = $1
       WHERE status = $2 AND quote_expires_at < NOW()
       RETURNING id`,
      [EnquiryStatus.EXPIRED, EnquiryStatus.PENDING]
    );
    return rows.map((r) => r.id);
  }
}
