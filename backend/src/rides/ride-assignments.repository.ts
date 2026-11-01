import { Injectable } from '@nestjs/common';
import type { Queryable } from '../database/queryable.js';

@Injectable()
export class RideAssignmentsRepository {
  /**
   * Partial unique indexes make this the last line of defence: a second ACTIVE assignment
   * for the same ride or the same driver fails with 23505 even if a lock were missed.
   */
  async insertActive(tx: Queryable, rideId: string, driverId: string): Promise<void> {
    await tx.query(`INSERT INTO ride_assignments (ride_id, driver_id) VALUES ($1, $2)`, [
      rideId,
      driverId,
    ]);
  }

  async endActive(
    tx: Queryable,
    rideId: string,
    outcome: 'COMPLETED' | 'CANCELLED',
  ): Promise<boolean> {
    const result = await tx.query(
      `UPDATE ride_assignments SET status = $2, ended_at = now()
        WHERE ride_id = $1 AND status = 'ACTIVE'`,
      [rideId, outcome],
    );
    return result.rowCount === 1;
  }
}
