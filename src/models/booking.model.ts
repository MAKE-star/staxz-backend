import { PoolClient } from 'pg';
import { db } from '../config/database';
import { BookingRow, BookingStatus } from '../types';
import { generateBookingRef } from '../utils/crypto';

export class BookingModel {
  static async findById(id: string): Promise<BookingRow | null> {
    const { rows } = await db.query<BookingRow>(
      'SELECT * FROM bookings WHERE id = $1',
      [id]
    );
    return rows[0] ?? null;
  }

  static async findByReference(ref: string): Promise<BookingRow | null> {
    const { rows } = await db.query<BookingRow>(
      'SELECT * FROM bookings WHERE reference = $1',
      [ref]
    );
    return rows[0] ?? null;
  }

  static async findByPaystackRef(paystackRef: string): Promise<BookingRow | null> {
    const { rows } = await db.query<BookingRow>(
      'SELECT * FROM bookings WHERE paystack_ref = $1',
      [paystackRef]
    );
    return rows[0] ?? null;
  }

  static async listForUser(
    userId: string,
    role: 'hirer' | 'provider',
    page = 1,
    limit = 20
  ): Promise<{ rows: BookingRow[]; total: number }> {
    const column = role === 'hirer' ? 'hirer_id' : 'provider_id';
    const offset = (page - 1) * limit;

    // For provider, we need to resolve provider.id → user.id mapping
    const whereClause = role === 'provider'
      ? `b.provider_id = (SELECT id FROM providers WHERE user_id = $1)`
      : `b.${column} = $1`;

    const [countRes, dataRes] = await Promise.all([
      db.query<{ count: string }>(
        `SELECT COUNT(*) FROM bookings b WHERE ${whereClause}`,
        [userId]
      ),
      db.query<BookingRow>(
        `SELECT b.*,
                u.full_name AS hirer_name,
                pr.business_name AS provider_name
         FROM bookings b
         JOIN users u ON u.id = b.hirer_id
         JOIN providers pr ON pr.id = b.provider_id
         WHERE ${whereClause}
         ORDER BY b.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      ),
    ]);

    return {
      rows: dataRes.rows,
      total: parseInt(countRes.rows[0]?.count ?? '0', 10),
    };
  }

  static async create(
    data: Omit<BookingRow, 'id' | 'reference' | 'completed_at' | 'confirmed_at' | 'cancelled_at' | 'escrow_released' | 'created_at'>,
    client?: PoolClient
  ): Promise<BookingRow> {
    const executor = client ?? db;
    let reference = generateBookingRef();

    // Ensure reference uniqueness
    let attempts = 0;
    while (attempts < 5) {
      const existing = await this.findByReference(reference);
      if (!existing) break;
      reference = generateBookingRef();
      attempts++;
    }

    const { rows } = await executor.query<BookingRow>(
      `INSERT INTO bookings (
        reference, hirer_id, provider_id, service_type,
        provider_quote_kobo, platform_fee_kobo, total_charged_kobo,
        status, scheduled_at, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        reference, data.hirer_id, data.provider_id, data.service_type,
        data.provider_quote_kobo, data.platform_fee_kobo, data.total_charged_kobo,
        BookingStatus.PENDING_PAYMENT, data.scheduled_at, data.notes,
      ]
    );
    return rows[0];
  }

  static async updateStatus(
    id: string,
    status: BookingStatus,
    extra: Partial<BookingRow> = {},
    client?: PoolClient
  ): Promise<BookingRow | null> {
    const executor = client ?? db;
    const fields = ['status = $1'];
    const values: unknown[] = [status];
    let idx = 2;

    if (extra.paystack_ref) { fields.push(`paystack_ref = $${idx++}`); values.push(extra.paystack_ref); }
    if (extra.service_address) { fields.push(`service_address = $${idx++}`); values.push(extra.service_address); }
    if (extra.completed_at) { fields.push(`completed_at = $${idx++}`); values.push(extra.completed_at); }
    if (extra.confirmed_at) { fields.push(`confirmed_at = $${idx++}`); values.push(extra.confirmed_at); }
    if (extra.cancelled_at) { fields.push(`cancelled_at = $${idx++}`); values.push(extra.cancelled_at); }
    if (extra.escrow_released !== undefined) { fields.push(`escrow_released = $${idx++}`); values.push(extra.escrow_released); }

    values.push(id);
    const { rows } = await executor.query<BookingRow>(
      `UPDATE bookings SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0] ?? null;
  }
}
