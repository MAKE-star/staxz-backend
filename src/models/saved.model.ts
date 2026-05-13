import { db } from '../config/database';
import { SavedProviderRow, SavedCardRow } from '../types';

export class SavedProviderModel {
  static async toggle(hirerId: string, providerId: string): Promise<boolean> {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM saved_providers WHERE hirer_id = $1 AND provider_id = $2',
      [hirerId, providerId]
    );

    if (rows.length) {
      await db.query(
        'DELETE FROM saved_providers WHERE hirer_id = $1 AND provider_id = $2',
        [hirerId, providerId]
      );
      return false; // removed
    } else {
      await db.query(
        'INSERT INTO saved_providers (hirer_id, provider_id) VALUES ($1, $2)',
        [hirerId, providerId]
      );
      return true; // saved
    }
  }

  static async isSaved(hirerId: string, providerId: string): Promise<boolean> {
    const { rows } = await db.query(
      'SELECT 1 FROM saved_providers WHERE hirer_id = $1 AND provider_id = $2',
      [hirerId, providerId]
    );
    return rows.length > 0;
  }

  static async listForHirer(hirerId: string): Promise<SavedProviderRow[]> {
    const { rows } = await db.query<SavedProviderRow>(
      `SELECT sp.*, p.business_name, p.location_text, p.rating_avg,
              p.rating_count, p.is_live, p.service_categories
       FROM saved_providers sp
       JOIN providers p ON p.id = sp.provider_id
       WHERE sp.hirer_id = $1
       ORDER BY sp.created_at DESC`,
      [hirerId]
    );
    return rows;
  }
}

export class SavedCardModel {
  static async listForUser(userId: string): Promise<SavedCardRow[]> {
    const { rows } = await db.query<SavedCardRow>(
      `SELECT * FROM saved_cards WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );
    return rows;
  }

  static async upsert(data: {
    user_id: string;
    paystack_auth_code: string;
    last4: string;
    card_type?: string;
    exp_month?: number;
    exp_year?: number;
    bank?: string;
  }): Promise<SavedCardRow> {
    const { rows } = await db.query<SavedCardRow>(
      `INSERT INTO saved_cards (user_id, paystack_auth_code, last4, card_type, exp_month, exp_year, bank)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, paystack_auth_code) DO UPDATE
         SET last4 = EXCLUDED.last4
       RETURNING *`,
      [data.user_id, data.paystack_auth_code, data.last4,
       data.card_type ?? null, data.exp_month ?? null,
       data.exp_year ?? null, data.bank ?? null]
    );
    return rows[0];
  }

  static async setDefault(id: string, userId: string): Promise<void> {
    await db.query('UPDATE saved_cards SET is_default = false WHERE user_id = $1', [userId]);
    await db.query('UPDATE saved_cards SET is_default = true WHERE id = $1 AND user_id = $2', [id, userId]);
  }

  static async delete(id: string, userId: string): Promise<void> {
    await db.query('DELETE FROM saved_cards WHERE id = $1 AND user_id = $2', [id, userId]);
  }
}
