import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { DriverCaller } from '../common/auth/actor.decorators.js';
import type { Caller } from '../common/domain/caller.js';
import {
  ActiveRideExistsError,
  ConflictError,
  DriverUnavailableError,
  InvalidStateTransitionError,
  RideAlreadyAssignedError,
  RideNotFoundError,
  UnauthenticatedError,
} from '../common/errors/index.js';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { CONSTRAINT } from '../database/constraints.js';
import { isUniqueViolation } from '../database/pg-errors.js';
import { PG_POOL } from '../database/pg-pool.provider.js';
import type { Queryable } from '../database/queryable.js';
import { TransactionManager, type TxClient } from '../database/transaction-manager.js';
import { DriversRepository } from '../drivers/drivers.repository.js';
import { FareService } from '../fares/fare.service.js';
import { FaresRepository } from '../fares/fares.repository.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { assertDriverCanAccept } from '../matching/eligibility.js';
import { MatchingService } from '../matching/matching.service.js';
import type { CreateRideDto } from './dto/create-ride.dto.js';
import { canViewRide, resolveRideActor } from './ride-access.js';
import { RideAssignmentsRepository } from './ride-assignments.repository.js';
import { toRideResponse, type RideResponse } from './ride.mapper.js';
import { decideAccept, decideCancel, decideComplete, decideStart } from './ride-state-machine.js';
import type { RideDetails, RideRecord } from './ride.types.js';
import { RidesRepository } from './rides.repository.js';
import { validateTrip } from './trip-validation.js';

export interface CreateRideResult {
  ride: RideResponse;
  /** True when the Idempotency-Key was already used: `ride` is the original response. */
  replayed: boolean;
}

/**
 * Ride lifecycle. Every state change runs in one transaction that:
 *   1. locks the ride row (SELECT ... FOR UPDATE), serialising concurrent callers;
 *   2. asks the pure state machine what to do (apply, idempotent replay, or reject);
 *   3. locks the driver row, always after the ride (fixed order: no deadlocks);
 *   4. writes with compare-and-swap UPDATEs (`WHERE status = <expected>`);
 * with partial unique indexes on active assignments as the final backstop.
 */
@Injectable()
export class RidesService {
  constructor(
    @InjectConfig() private readonly config: AppConfig,
    @Inject(PG_POOL) private readonly db: Queryable,
    private readonly tx: TransactionManager,
    private readonly rides: RidesRepository,
    private readonly assignments: RideAssignmentsRepository,
    private readonly drivers: DriversRepository,
    private readonly fares: FaresRepository,
    private readonly fareService: FareService,
    private readonly matching: MatchingService,
    private readonly idempotency: IdempotencyService,
    @InjectPinoLogger(RidesService.name) private readonly logger: PinoLogger,
  ) {}

  async createRide(riderId: string, dto: CreateRideDto, key: string): Promise<CreateRideResult> {
    const pickup = { name: dto.pickup.name, lat: dto.pickup.lat, lng: dto.pickup.lng };
    const destination = {
      name: dto.destination.name,
      lat: dto.destination.lat,
      lng: dto.destination.lng,
    };
    validateTrip(pickup, destination, this.config.serviceArea);

    const requestHash = IdempotencyService.hashRequest({
      pickup,
      destination,
      category: dto.category,
    });
    // Pure computation and a read outside the transaction keep the locked section short.
    const quote = this.fareService.quote(pickup, destination, dto.category);
    const etaMinutes = await this.matching.estimatePickupEta(this.db, dto.category, pickup);

    try {
      const result = await this.tx.run(async (tx): Promise<CreateRideResult> => {
        const claim = await this.idempotency.claim(tx, riderId, key, requestHash);
        if (claim.kind === 'REPLAY') return { ride: claim.body as RideResponse, replayed: true };

        // The partial unique index uq_one_active_ride_per_rider rejects a second active ride.
        const ride = await this.rides.insert(tx, {
          riderId,
          category: dto.category,
          pickup,
          destination,
          distanceM: quote.distanceM,
          durationS: quote.durationS,
          etaMinutes,
        });
        await this.fares.insertQuote(tx, ride.id, quote);
        const response = toRideResponse(await this.loadDetails(tx, ride.id));
        await this.idempotency.complete(tx, riderId, key, {
          status: 201,
          body: response,
          rideId: ride.id,
        });
        return { ride: response, replayed: false };
      });

      this.logger.info(
        {
          event: result.replayed ? 'ride.request_replayed' : 'ride.requested',
          rideId: result.ride.id,
          riderId,
        },
        result.replayed ? 'Ride request replayed' : 'Ride requested',
      );
      return result;
    } catch (error) {
      if (isUniqueViolation(error, CONSTRAINT.ONE_ACTIVE_RIDE_PER_RIDER)) {
        const active = await this.rides.findActiveDetailsByRider(this.db, riderId);
        throw new ActiveRideExistsError(active?.ride.id ?? null);
      }
      throw error;
    }
  }

  async getRide(rideId: string, caller: Caller): Promise<RideResponse> {
    const details = await this.rides.findDetailsById(this.db, rideId);
    if (!details || !canViewRide(details.ride, caller)) throw new RideNotFoundError(rideId);
    return toRideResponse(details);
  }

  async findActiveRideForRider(riderId: string): Promise<RideResponse | null> {
    const details = await this.rides.findActiveDetailsByRider(this.db, riderId);
    return details ? toRideResponse(details) : null;
  }

  async accept(rideId: string, driver: DriverCaller): Promise<RideResponse> {
    try {
      const { details, applied } = await this.tx.run(async (tx) => {
        const ride = await this.lockRide(tx, rideId);
        if (decideAccept(ride, driver.id) === 'ALREADY_DONE') {
          return { details: await this.loadDetails(tx, ride.id), applied: false };
        }

        const current = await this.drivers.findByIdForUpdate(tx, driver.id);
        if (!current) throw new UnauthenticatedError('Unknown driver');
        assertDriverCanAccept(
          {
            vehicleCategory: current.vehicleCategory,
            availability: current.availability,
            hasLocation: current.lat !== null && current.lng !== null,
            locationUpdatedAt: current.locationUpdatedAt,
          },
          ride.category,
          { now: new Date(), locationTtlSeconds: this.config.matching.driverLocationTtlSeconds },
        );

        if (!(await this.rides.markAssigned(tx, ride.id, current.id))) {
          throw new RideAlreadyAssignedError(ride.id);
        }
        if (!(await this.drivers.markBusy(tx, current.id))) {
          throw new DriverUnavailableError('BUSY');
        }
        await this.assignments.insertActive(tx, ride.id, current.id);
        return { details: await this.loadDetails(tx, ride.id), applied: true };
      });

      if (applied) {
        this.logger.info({ event: 'ride.assigned', rideId, driverId: driver.id }, 'Ride assigned');
      }
      return toRideResponse(details);
    } catch (error) {
      throw this.translateAssignmentConflict(error, rideId);
    }
  }

  async start(rideId: string, driver: DriverCaller): Promise<RideResponse> {
    const { details, applied } = await this.tx.run(async (tx) => {
      const ride = await this.lockRide(tx, rideId);
      const actor = resolveRideActor(ride, driver);
      if (!actor) throw new RideNotFoundError(rideId);
      if (decideStart(ride, actor) === 'ALREADY_DONE') {
        return { details: await this.loadDetails(tx, ride.id), applied: false };
      }
      if (!(await this.rides.markStarted(tx, ride.id))) throw new ConflictError();
      return { details: await this.loadDetails(tx, ride.id), applied: true };
    });

    if (applied) {
      this.logger.info({ event: 'ride.started', rideId, driverId: driver.id }, 'Trip started');
    }
    return toRideResponse(details);
  }

  async cancel(rideId: string, caller: Caller, reason: string | undefined): Promise<RideResponse> {
    const { details, applied } = await this.tx.run(async (tx) => {
      const ride = await this.lockRide(tx, rideId);
      const actor = resolveRideActor(ride, caller);
      if (!actor) throw new RideNotFoundError(rideId);
      if (decideCancel(ride, actor) === 'ALREADY_DONE') {
        return { details: await this.loadDetails(tx, ride.id), applied: false };
      }
      const from = assertCancellableStatus(ride);

      const assignedDriverId = from === 'ASSIGNED' ? ride.driverId : null;
      if (assignedDriverId) await this.drivers.findByIdForUpdate(tx, assignedDriverId);

      const cancelled = await this.rides.markCancelled(
        tx,
        ride.id,
        from,
        actor === 'RIDER' ? 'RIDER' : 'DRIVER',
        reason || null,
      );
      if (!cancelled) throw new ConflictError();
      if (assignedDriverId) await this.endTrip(tx, ride.id, assignedDriverId, 'CANCELLED');
      return { details: await this.loadDetails(tx, ride.id), applied: true };
    });

    if (applied) {
      this.logger.info(
        { event: 'ride.cancelled', rideId, by: caller.kind, callerId: caller.id },
        'Ride cancelled',
      );
    }
    return toRideResponse(details);
  }

  async complete(rideId: string, driver: DriverCaller): Promise<RideResponse> {
    const { details, applied } = await this.tx.run(async (tx) => {
      const ride = await this.lockRide(tx, rideId);
      const actor = resolveRideActor(ride, driver);
      if (!actor) throw new RideNotFoundError(rideId);
      if (decideComplete(ride, actor) === 'ALREADY_DONE') {
        return { details: await this.loadDetails(tx, ride.id), applied: false };
      }
      // decideComplete only applies for the assigned driver, so the caller is that driver.
      const driverId = driver.id;
      await this.drivers.findByIdForUpdate(tx, driverId);

      if (!(await this.rides.markCompleted(tx, ride.id))) throw new ConflictError();
      await this.fares.finalizeAtEstimate(tx, ride.id);
      await this.endTrip(tx, ride.id, driverId, 'COMPLETED');
      return { details: await this.loadDetails(tx, ride.id), applied: true };
    });

    if (applied) {
      this.logger.info(
        {
          event: 'ride.completed',
          rideId,
          driverId: driver.id,
          finalTotal: details.fare.finalTotal,
        },
        'Ride completed',
      );
    }
    return toRideResponse(details);
  }

  /** Called by the expiry sweeper. Returns the ids of the rides it expired. */
  async expireStaleRequests(): Promise<string[]> {
    const expired = await this.rides.expireRequestedBefore(
      this.db,
      this.config.rides.requestTtlSeconds,
    );
    for (const rideId of expired) {
      this.logger.info({ event: 'ride.expired', rideId }, 'Ride request expired without a driver');
    }
    return expired;
  }

  private async lockRide(tx: TxClient, rideId: string): Promise<RideRecord> {
    const ride = await this.rides.findByIdForUpdate(tx, rideId);
    if (!ride) throw new RideNotFoundError(rideId);
    return ride;
  }

  private async loadDetails(db: Queryable, rideId: string): Promise<RideDetails> {
    const details = await this.rides.findDetailsById(db, rideId);
    if (!details) throw new Error(`Ride ${rideId} vanished inside its own transaction`);
    return details;
  }

  /**
   * Ends the active assignment and frees the driver. Both must change exactly one row; if
   * not, the active-assignment <-> BUSY invariant is broken, so fail (500) and roll back.
   */
  private async endTrip(
    tx: TxClient,
    rideId: string,
    driverId: string,
    outcome: 'COMPLETED' | 'CANCELLED',
  ): Promise<void> {
    if (!(await this.assignments.endActive(tx, rideId, outcome))) {
      throw new Error(`Invariant violated: ride ${rideId} has no active assignment`);
    }
    if (!(await this.drivers.releaseFromTrip(tx, driverId))) {
      throw new Error(`Invariant violated: driver ${driverId} was not BUSY`);
    }
  }

  /** The unique-index backstops, if they ever fire, mean the same as the normal checks. */
  private translateAssignmentConflict(error: unknown, rideId: string): unknown {
    if (isUniqueViolation(error, CONSTRAINT.ACTIVE_ASSIGNMENT_PER_RIDE)) {
      return new RideAlreadyAssignedError(rideId);
    }
    if (isUniqueViolation(error, CONSTRAINT.ACTIVE_ASSIGNMENT_PER_DRIVER)) {
      return new DriverUnavailableError('BUSY');
    }
    return error;
  }
}

function assertCancellableStatus(ride: RideRecord): 'REQUESTED' | 'ASSIGNED' {
  if (ride.status === 'REQUESTED' || ride.status === 'ASSIGNED') return ride.status;
  // decideCancel already rejected every other status; this narrows the type.
  throw new InvalidStateTransitionError(ride.status, 'CANCELLED');
}
