import { db } from '../config/database';
import { ReviewRow } from '../types';

export class ReviewModel {
  static async findByBookingAndReviewer(
    bookingId: string,
    reviewerId: string
  ): Promise<ReviewRow | null> {
    const { rows } = await db.query<ReviewRow>(
      'SELECT * FROM reviews WHERE booking_id = $1 AND reviewer_id = $2',
      [bookingId, reviewerId]
    );
    return rows[0] ?? null;
  }

  static async listForProvider(
    providerId: string,
    page = 1,
    limit = 20
  ): Promise<{ rows: ReviewRow[]; total: number }> {
    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await Promise.all([
      db.query<{ count: string }>(
        `SELECT COUNT(*) FROM reviews r
         JOIN providers p ON p.user_id = r.reviewee_id
         WHERE p.id = $1`,
        [providerId]
      ),
      db.query<ReviewRow>(
        `SELECT r.*, u.full_name AS reviewer_name, u.avatar_url AS reviewer_avatar
         FROM reviews r
         JOIN users u ON u.id = r.reviewer_id
         JOIN providers p ON p.user_id = r.reviewee_id
         WHERE p.id = $1
         ORDER BY r.created_at DESC
         LIMIT $2 OFFSET $3`,
        [providerId, limit, offset]
      ),
    ]);

    return {
      rows: dataRes.rows,
      total: parseInt(countRes.rows[0]?.count ?? '0', 10),
    };
  }

  static async create(data: {
    booking_id: string;
    reviewer_id: string;
    reviewee_id: string;
    stars: number;
    body?: string;
  }): Promise<ReviewRow> {
    const { rows } = await db.query<ReviewRow>(
      `INSERT INTO reviews (booking_id, reviewer_id, reviewee_id, stars, body)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [data.booking_id, data.reviewer_id, data.reviewee_id, data.stars, data.body ?? null]
    );
    return rows[0];
  }
}
