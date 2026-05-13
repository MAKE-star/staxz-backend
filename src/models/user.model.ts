import { db } from '../config/database';
import { UserRow, UserRole } from '../types';

export class UserModel {
  static async findById(id: string): Promise<UserRow | null> {
    const { rows } = await db.query<UserRow>(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    return rows[0] ?? null;
  }

  static async findByPhone(phone: string): Promise<UserRow | null> {
    const { rows } = await db.query<UserRow>(
      'SELECT * FROM users WHERE phone = $1',
      [phone]
    );
    return rows[0] ?? null;
  }

  static async upsertByPhone(
    phone: string,
    role: UserRole = UserRole.HIRER
  ): Promise<UserRow> {
    const { rows } = await db.query<UserRow>(
      `INSERT INTO users (phone, role)
       VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING *`,
      [phone, role]
    );
    return rows[0];
  }

  static async updateProfile(
    id: string,
    data: { full_name?: string; avatar_url?: string }
  ): Promise<UserRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.full_name !== undefined) {
      fields.push(`full_name = $${idx++}`);
      values.push(data.full_name);
    }
    if (data.avatar_url !== undefined) {
      fields.push(`avatar_url = $${idx++}`);
      values.push(data.avatar_url);
    }

    if (!fields.length) return this.findById(id);

    values.push(id);
    const { rows } = await db.query<UserRow>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0] ?? null;
  }

  static async setActive(id: string, active: boolean): Promise<void> {
    await db.query(
      'UPDATE users SET is_active = $1 WHERE id = $2',
      [active, id]
    );
  }
}
