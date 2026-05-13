import { db } from '../config/database';
import { WithdrawalRow, WithdrawalStatus } from '../types';

export class WithdrawalModel {
  static async create(data: {
    provider_id: string;
    amount_kobo: number;
  }): Promise<WithdrawalRow> {
    const { rows } = await db.query<WithdrawalRow>(
      `INSERT INTO withdrawals (provider_id, amount_kobo, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [data.provider_id, data.amount_kobo]
    );
    return rows[0];
  }

  static async update(
    id: string,
    data: {
      status: WithdrawalStatus;
      paystack_transfer_ref?: string;
      paystack_transfer_code?: string;
      failure_reason?: string;
      completed_at?: Date;
    }
  ): Promise<WithdrawalRow | null> {
    const fields: string[] = ['status = $1'];
    const values: unknown[] = [data.status];
    let idx = 2;

    if (data.paystack_transfer_ref) { fields.push(`paystack_transfer_ref = $${idx++}`); values.push(data.paystack_transfer_ref); }
    if (data.paystack_transfer_code) { fields.push(`paystack_transfer_code = $${idx++}`); values.push(data.paystack_transfer_code); }
    if (data.failure_reason) { fields.push(`failure_reason = $${idx++}`); values.push(data.failure_reason); }
    if (data.completed_at) { fields.push(`completed_at = $${idx++}`); values.push(data.completed_at); }

    values.push(id);
    const { rows } = await db.query<WithdrawalRow>(
      `UPDATE withdrawals SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0] ?? null;
  }

  static async listForProvider(
    providerId: string,
    page = 1,
    limit = 20
  ): Promise<{ rows: WithdrawalRow[]; total: number }> {
    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await Promise.all([
      db.query<{ count: string }>(
        'SELECT COUNT(*) FROM withdrawals WHERE provider_id = $1',
        [providerId]
      ),
      db.query<WithdrawalRow>(
        `SELECT * FROM withdrawals WHERE provider_id = $1
         ORDER BY initiated_at DESC LIMIT $2 OFFSET $3`,
        [providerId, limit, offset]
      ),
    ]);

    return {
      rows: dataRes.rows,
      total: parseInt(countRes.rows[0]?.count ?? '0', 10),
    };
  }

  /** Sum of completed withdrawals for a provider — used to calc available balance */
  static async totalWithdrawnKobo(providerId: string): Promise<number> {
    const { rows } = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_kobo), 0) AS total
       FROM withdrawals
       WHERE provider_id = $1 AND status = 'completed'`,
      [providerId]
    );
    return parseInt(rows[0]?.total ?? '0', 10);
  }
}
