import { PoolClient } from 'pg';
import { db } from '../config/database';
import { DisputeRow, DisputeStatus, TransactionRow } from '../types';

export class DisputeModel {
  static async findByBookingId(bookingId: string): Promise<DisputeRow | null> {
    const { rows } = await db.query<DisputeRow>(
      'SELECT * FROM disputes WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1',
      [bookingId]
    );
    return rows[0] ?? null;
  }

  static async listOpen(): Promise<DisputeRow[]> {
    const { rows } = await db.query<DisputeRow>(
      `SELECT d.*, b.reference AS booking_reference,
              hu.full_name AS hirer_name, pu.full_name AS provider_name
       FROM disputes d
       JOIN bookings b ON b.id = d.booking_id
       JOIN users hu ON hu.id = b.hirer_id
       JOIN providers pr ON pr.id = b.provider_id
       JOIN users pu ON pu.id = pr.user_id
       WHERE d.status IN ($1, $2)
       ORDER BY d.created_at ASC`,
      [DisputeStatus.OPEN, DisputeStatus.REVIEWING]
    );
    return rows;
  }

  static async create(data: {
    booking_id: string;
    raised_by: string;
    reason: string;
    details?: string;
  }): Promise<DisputeRow> {
    const { rows } = await db.query<DisputeRow>(
      `INSERT INTO disputes (booking_id, raised_by, reason, details, status)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [data.booking_id, data.raised_by, data.reason, data.details ?? null, DisputeStatus.OPEN]
    );
    return rows[0];
  }

  static async resolve(
    id: string,
    status: DisputeStatus.RESOLVED_REFUND | DisputeStatus.RESOLVED_RELEASED,
    resolvedBy: string,
    note: string
  ): Promise<DisputeRow | null> {
    const { rows } = await db.query<DisputeRow>(
      `UPDATE disputes
       SET status = $1, resolved_by = $2, resolution_note = $3, resolved_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, resolvedBy, note, id]
    );
    return rows[0] ?? null;
  }
}

export class TransactionModel {
  static async create(
    data: Omit<TransactionRow, 'id' | 'created_at'>,
    client?: PoolClient
  ): Promise<TransactionRow> {
    const executor = client ?? db;
    const { rows } = await executor.query<TransactionRow>(
      `INSERT INTO transactions (booking_id, type, amount_kobo, paystack_ref, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        data.booking_id, data.type, data.amount_kobo,
        data.paystack_ref ?? null, data.status, JSON.stringify(data.metadata ?? {}),
      ]
    );
    return rows[0];
  }

  static async listByBooking(bookingId: string): Promise<TransactionRow[]> {
    const { rows } = await db.query<TransactionRow>(
      'SELECT * FROM transactions WHERE booking_id = $1 ORDER BY created_at ASC',
      [bookingId]
    );
    return rows;
  }
}
