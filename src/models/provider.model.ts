import { PoolClient } from 'pg';
import { db } from '../config/database';
import { ProviderRow, ProvidersQueryParams } from '../types';

export class ProviderModel {
  static async findById(id: string): Promise<ProviderRow | null> {
    const { rows } = await db.query<ProviderRow>(
      'SELECT * FROM providers WHERE id = $1',
      [id]
    );
    return rows[0] ?? null;
  }

  static async findByUserId(userId: string): Promise<ProviderRow | null> {
    const { rows } = await db.query<ProviderRow>(
      'SELECT * FROM providers WHERE user_id = $1',
      [userId]
    );
    return rows[0] ?? null;
  }

  static async findByWhatsApp(number: string): Promise<ProviderRow | null> {
    const { rows } = await db.query<ProviderRow>(
      'SELECT * FROM providers WHERE whatsapp_number = $1',
      [number]
    );
    return rows[0] ?? null;
  }

  static async list(
    params: ProvidersQueryParams
  ): Promise<{ rows: ProviderRow[]; total: number }> {
    const {
      lat, lng, radius = 20, category, mode,
      sort = 'rating', page = 1, limit = 20,
    } = params;

    const conditions: string[] = ['p.is_live = true'];
    const values: unknown[] = [];
    let idx = 1;

    if (category) {
      conditions.push(`$${idx++} = ANY(p.service_categories)`);
      values.push(category);
    }
    if (mode) {
      conditions.push(`$${idx++} = ANY(p.service_modes)`);
      values.push(mode);
    }

    // GPS radius filter (using simple lat/lng distance — upgrade to PostGIS later)
    let distanceExpr = 'NULL::float AS distance_km';
    if (lat && lng) {
      distanceExpr = `
        (6371 * acos(
          cos(radians($${idx++})) * cos(radians(p.location_lat)) *
          cos(radians(p.location_lng) - radians($${idx++})) +
          sin(radians($${idx - 2})) * sin(radians(p.location_lat))
        )) AS distance_km`;
      values.push(lat, lng);
      conditions.push(
        `(6371 * acos(
          cos(radians($${idx - 2})) * cos(radians(p.location_lat)) *
          cos(radians(p.location_lng) - radians($${idx - 1})) +
          sin(radians($${idx - 2})) * sin(radians(p.location_lat))
        )) <= $${idx++}`
      );
      values.push(radius);
    }

    const orderMap: Record<string, string> = {
      rating: 'p.rating_avg DESC, p.rating_count DESC',
      distance: lat && lng ? 'distance_km ASC' : 'p.rating_avg DESC',
      price: 'p.base_fee_kobo ASC',
    };

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*) FROM providers p
      JOIN users u ON u.id = p.user_id
      ${where}
    `;

    const dataQuery = `
      SELECT p.*, u.full_name AS owner_name, u.phone AS owner_phone,
             ${distanceExpr}
      FROM providers p
      JOIN users u ON u.id = p.user_id
      ${where}
      ORDER BY ${orderMap[sort]}
      LIMIT $${idx++} OFFSET $${idx}
    `;

    const [countResult, dataResult] = await Promise.all([
      db.query<{ count: string }>(countQuery, values),
      db.query<ProviderRow>(dataQuery, [...values, limit, offset]),
    ]);

    return {
      rows: dataResult.rows,
      total: parseInt(countResult.rows[0]?.count ?? '0', 10),
    };
  }

  static async create(
    data: Omit<ProviderRow, 'id' | 'rating_avg' | 'rating_count' | 'cac_verified' | 'is_live' | 'is_flagged' | 'flag_reason' | 'paystack_recipient_code' | 'created_at'>,
    client?: PoolClient
  ): Promise<ProviderRow> {
    const executor = client ?? db;
    const { rows } = await executor.query<ProviderRow>(
      `INSERT INTO providers (
        user_id, business_name, business_type, cac_number,
        whatsapp_number, location_text, location_lat, location_lng,
        service_modes, base_fee_kobo, service_categories,
        bio, years_experience, bank_account_name, bank_account_number, bank_code
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        data.user_id, data.business_name, data.business_type, data.cac_number,
        data.whatsapp_number, data.location_text, data.location_lat, data.location_lng,
        data.service_modes, data.base_fee_kobo, data.service_categories,
        data.bio, data.years_experience, data.bank_account_name,
        data.bank_account_number, data.bank_code,
      ]
    );
    return rows[0];
  }

  static async update(
    id: string,
    data: Partial<Omit<ProviderRow, 'id' | 'user_id' | 'created_at'>>
  ): Promise<ProviderRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const allowed: (keyof typeof data)[] = [
      'business_name', 'whatsapp_number', 'location_text', 'location_lat',
      'location_lng', 'service_modes', 'base_fee_kobo', 'service_categories',
      'cac_verified', 'is_live',
    ];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(data[key]);
      }
    }

    if (!fields.length) return this.findById(id);

    values.push(id);
    const { rows } = await db.query<ProviderRow>(
      `UPDATE providers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0] ?? null;
  }

  static async setPaystackRecipient(id: string, recipientCode: string): Promise<void> {
    await db.query(
      'UPDATE providers SET paystack_recipient_code = $1 WHERE id = $2',
      [recipientCode, id]
    );
  }

  static async setFlagged(id: string, reason: string): Promise<void> {
    await db.query(
      'UPDATE providers SET is_flagged = true, flag_reason = $1 WHERE id = $2',
      [reason, id]
    );
  }

  static async recalculateRating(providerId: string): Promise<void> {
    await db.query(
      `UPDATE providers SET
        rating_avg = (
          SELECT COALESCE(AVG(stars), 0) FROM reviews
          WHERE reviewee_id = (SELECT user_id FROM providers WHERE id = $1)
        ),
        rating_count = (
          SELECT COUNT(*) FROM reviews
          WHERE reviewee_id = (SELECT user_id FROM providers WHERE id = $1)
        )
       WHERE id = $1`,
      [providerId]
    );
  }

  static async getPortfolioPhotos(
    providerId: string,
    categoryId?: string
  ) {
    const conditions = ['provider_id = $1'];
    const values: unknown[] = [providerId];

    if (categoryId) {
      conditions.push('category_id = $2');
      values.push(categoryId);
    }

    const { rows } = await db.query(
      `SELECT * FROM portfolio_photos WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      values
    );
    return rows;
  }

  static async countPhotosPerCategory(
    providerId: string
  ): Promise<Record<string, number>> {
    const { rows } = await db.query<{ category_id: string; count: string }>(
      `SELECT category_id, COUNT(*) as count
       FROM portfolio_photos WHERE provider_id = $1
       GROUP BY category_id`,
      [providerId]
    );
    return Object.fromEntries(rows.map((r) => [r.category_id, parseInt(r.count, 10)]));
  }
}
