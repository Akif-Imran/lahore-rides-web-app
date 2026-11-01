import { Injectable } from '@nestjs/common';
import type { Queryable } from '../database/queryable.js';

export interface RiderRecord {
  id: string;
  name: string;
}

@Injectable()
export class RidersRepository {
  async findById(db: Queryable, id: string): Promise<RiderRecord | null> {
    const { rows } = await db.query<RiderRecord>('SELECT id, name FROM riders WHERE id = $1', [id]);
    return rows[0] ?? null;
  }
}
